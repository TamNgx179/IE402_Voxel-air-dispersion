"""Compare road corridors in two seasons, using independent NetCDF integration."""
import argparse
import csv
import io
import json
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
import xarray as xr
from shapely import wkt
from shapely.ops import unary_union

from src.analysis.corridor_reference import integrate
from src.solver import sha256, solid_mask

RADII = [10, 25, 50]
HEIGHTS = [(1, 15), (15, 31)]
DIAGNOSTIC_THRESHOLD = 0.15


def select_roads(scene, domain):
    with (scene / "buildings.csv").open(encoding="utf-8", newline="") as handle:
        buildings = unary_union([wkt.loads(row["wkt"]) for row in csv.DictReader(handle)])
    roads = defaultdict(list)
    with (scene / "roads.csv").open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            roads[row["source_feature_id"]].append(wkt.loads(row["wkt"]))
    ranking = []
    for road_id, lines in roads.items():
        route = unary_union(lines)
        if route.length < 40:
            continue
        area = route.buffer(25, quad_segs=8).intersection(domain)
        margin = route.interpolate(0.5, normalized=True).distance(domain.boundary)
        ranking.append((buildings.intersection(area).area / area.area, margin, road_id))
    inner = sorted(row for row in ranking if row[1] >= 45)
    if len(inner) < 3:
        raise ValueError("Too few eligible interior roads")
    edge = min((row for row in ranking if row[1] < 45), key=lambda row: (row[1], row[2]))
    selected = zip(("least_built", "median_built", "most_built", "near_boundary"),
                   (inner[0], inner[len(inner) // 2], inner[-1], edge), strict=True)
    return roads, [dict(group=group, footprint_fraction=cover, midpoint_margin_m=margin, road_id=road_id)
                   for group, (cover, margin, road_id) in selected]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True)
    parser.add_argument("--dry-run", required=True)
    parser.add_argument("--wet-run", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    origin = urlparse(args.base)
    if origin.scheme != "http" or origin.hostname not in ("127.0.0.1", "localhost") or origin.username:
        parser.error("Use a local HTTP app")
    if args.dry_run == args.wet_run:
        parser.error("Supply two distinct runs")

    def api(run, endpoint, payload=None):
        request = Request(f"{args.base.rstrip('/')}/api/runs/{run}{endpoint}",
                          data=None if payload is None else json.dumps(payload).encode(),
                          headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=90) as response:
            return response.read()

    scene = Path("db/seeds/scene")
    manifest = json.loads((scene / "scene_manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["files"].items():
        if sha256(scene / name) != expected:
            raise ValueError(f"Scene checksum mismatch for {name}")
    grid = manifest["grid"]
    domain = wkt.loads(manifest["study_area"]["wkt"])
    solid = solid_mask(scene / "grid_cells.csv", grid)
    roads, selected = select_roads(scene, domain)
    args.out.mkdir(parents=True, exist_ok=True)
    comparisons = []
    cases = (("dry", args.dry_run, "dry_nov_apr"), ("wet", args.wet_run, "wet_may_oct"))
    for season, run, scenario in cases:
        details = json.loads(api(run, ""))
        if (details["scenario"]["id"] != scenario or details["model"] != "fv"
                or details["emission_multiplier"] != 1 or details["status"] != "succeeded"):
            raise ValueError(f"Expected a successful original-source FV run for {scenario}")
        summary = json.loads(api(run, "/summary"))
        if any(summary["grid"][key] != value for key, value in grid.items()):
            raise ValueError(f"Grid mismatch for {run}")
        artifacts = json.loads(api(run, "/artifacts"))["artifacts"]
        concentration = args.out / f"{season}.nc"
        concentration.write_bytes(api(run, "/artifacts/concentration/download"))
        digest = sha256(concentration)
        if not any(a["kind"] == "concentration" and a["sha256"] == digest for a in artifacts):
            raise ValueError(f"NetCDF checksum mismatch for {run}")
        with xr.open_dataset(concentration) as dataset:
            if dataset.C.dims != ("z", "y", "x") or dataset.C.attrs["units"] != "ug m-3":
                raise ValueError("Unexpected NetCDF axis order or units")
            field = dataset.C.values
        for road in selected:
            road_id = road["road_id"]
            bands_by_height = []
            for low, high in HEIGHTS:
                payload = dict(road_ids=[road_id], distances_m=RADII, z_min_m=low,
                               z_max_m=high, threshold_ug_m3=DIAGNOSTIC_THRESHOLD)
                actual = json.loads(api(run, "/road-corridor", payload))
                rows = csv.DictReader(io.StringIO(api(run, "/road-corridor/csv", payload).decode()))
                reference = integrate(roads[road_id], domain, grid, field, solid, RADII, low, high,
                                      DIAGNOSTIC_THRESHOLD)
                if actual["run_id"] != run or actual["input_hash"] != summary["input_hash"]:
                    raise ValueError("API run identity differs from summary")
                for band, row, ref in zip(actual["bands"], rows, reference, strict=True):
                    if row["run_id"] != run or row["input_hash"] != actual["input_hash"]:
                        raise ValueError("CSV run identity differs from API")
                    for key, value in ref.items():
                        exported = float(row[key]) if row[key] else None
                        if band[key] != exported:
                            raise ValueError(f"CSV mismatch for {key}")
                        if value is None or exported is None:
                            if value != exported:
                                raise ValueError(f"Missing data mismatch for {key}")
                        else:
                            np.testing.assert_allclose(exported, value, rtol=1e-7, atol=1e-7, err_msg=key)
                bands_by_height.append(actual["bands"])
            for inner, outer, lower, upper in zip([0, *RADII[:-1]], RADII, *bands_by_height, strict=True):
                low_mean, high_mean = lower["mean_ug_m3"], upper["mean_ug_m3"]
                comparisons.append(dict(season=season, run_id=run, input_hash=summary["input_hash"],
                                        concentration_sha256=digest, **road,
                                        inner_radius_m=inner, outer_radius_m=outer,
                                        lower_mean_ug_m3=low_mean, upper_mean_ug_m3=high_mean,
                                        lower_coverage=lower["coverage"], upper_coverage=upper["coverage"],
                                        lower_minus_upper_ug_m3=None if None in (low_mean, high_mean)
                                        else low_mean - high_mean))
    with (args.out / "comparisons.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(comparisons[0]))
        writer.writeheader()
        writer.writerows(comparisons)
    print(f"NetCDF, API and CSV match for {2 * len(comparisons)} season/road/distance/height combinations")


if __name__ == "__main__":
    main()
