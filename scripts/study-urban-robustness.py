"""Test fixed-height road statistics under input and grid perturbations."""
import argparse
import csv
import json
import runpy
from pathlib import Path

import numpy as np
import shapely
import xarray as xr
import yaml
from shapely.geometry import MultiLineString

from scripts.fv_study_support import stable_dt, transport
from src.demo_bundle import inspect_bundle
from src.solver import _coords, initial_wind, sha256, solid_mask
from src.wind import project_mass_consistent

SECONDS = 90
SEASONS = ("dry_nov_apr", "wet_may_oct")


def project(config, scenario, grid, solid):
    options = config["wind"]
    return project_mass_consistent(
        *initial_wind(dict(config=config, scenario=scenario, grid=grid), solid), solid,
        dx=grid["dx_m"], dy=grid["dy_m"], dz=grid["dz_m"],
        alpha1=options["alpha1"], alpha2=options["alpha2"], omega=options["omega"],
        tolerance=options["sor_tolerance"], max_iter=options["max_iter"],
        method=options["poisson_method"],
    )


def spacing(grid):
    return tuple(grid[f"d{axis}_m"] for axis in "zyx")


def diffusivity(config, factor=1):
    section = config["transport"]
    return (section["vertical_diffusivity_m2_s"] * factor,
            section["horizontal_diffusivity_m2_s"] * factor,
            section["horizontal_diffusivity_m2_s"] * factor)


def corridor_weights(grid, domain, roads, selected):
    dz, dy, dx = spacing(grid)
    j, i = np.indices((grid["ny"], grid["nx"]))
    x = grid["origin_x_m"] + i * dx
    y = grid["origin_y_m"] + j * dy
    cells = shapely.box(x, y, x + dx, y + dy)
    layer_bottom = dz * np.arange(grid["nz"])
    weights = {}
    for road in selected:
        road_id = road["road_id"]
        line = MultiLineString(roads[road_id])
        previous = domain.difference(domain)
        for radius in (10, 25, 50):
            outer = line.buffer(radius, quad_segs=8).intersection(domain)
            area = shapely.area(shapely.intersection(cells, outer.difference(previous)))
            previous = outer
            for low, high in ((1, 15), (15, 31)):
                depth = np.maximum(0, np.minimum(high, layer_bottom + dz) - np.maximum(low, layer_bottom))
                weights[road_id, radius, low, high] = (depth, area)
    return weights


def read_statistics(field, solid, weights, name):
    rows = []
    for (road, radius, low, high), (depth, area) in weights.items():
        volume = depth[:, None, None] * area * (~solid)
        mean = np.sum(field * volume) / volume.sum()
        rows.append(dict(case=name, road_id=road, outer_radius_m=radius, z_low_m=low, z_high_m=high,
                         air_volume_m3=float(volume.sum()), mean_ug_m3=float(mean * 1e9)))
    return rows


def simulate(name, wind, source, solid, k, grid, dt, weights):
    print(f"Running {name}", flush=True)
    field, metrics = transport(wind, source, solid, k, spacing(grid), SECONDS, dt)
    return read_statistics(field[-1], solid, weights, name), dict(case=name, **metrics)


def robustness(config, source, grid, solid, weights):
    rows, stats = [], []
    for season in SEASONS:
        baseline = config["meteorology"]["scenarios"][season]
        cases = (("base", 0, 1), ("wind_minus15", -15, 1), ("wind_plus15", 15, 1),
                 ("k_half", 0, .5), ("k_plus50pct", 0, 1.5))
        # Use a common time step for all one-factor changes. Angles and K are
        # sensitivity bounds and do not represent probabilistic weather intervals.
        winds = {angle: project(config, {**baseline, "direction_from_deg":
                 (baseline["direction_from_deg"] + angle) % 360}, grid, solid)
                 for angle in (-15, 0, 15)}
        dt = min(stable_dt(winds[angle], diffusivity(config, factor), spacing(grid))
                 for _, angle, factor in cases)
        for case, angle, factor in cases:
            case_rows, result = simulate(f"{season}:{case}", winds[angle], source, solid,
                                         diffusivity(config, factor), grid, dt, weights)
            rows.extend(case_rows)
            stats.append(dict(**result, direction_from_deg=(baseline["direction_from_deg"] + angle) % 360,
                              diffusivity_factor=factor, emission_multiplier=1))
            if case == "base":
                # With fixed wind and K, the advection-diffusion problem is linear in its source.
                for multiplier in (.6, .8):
                    label = f"{season}:source_{int(multiplier * 100)}pct"
                    scaled, scaled_stats = simulate(label, winds[angle], source * multiplier,
                                                    solid, diffusivity(config), grid, dt, weights)
                    np.testing.assert_allclose([row["mean_ug_m3"] for row in scaled],
                                               [row["mean_ug_m3"] * multiplier for row in case_rows],
                                               rtol=1e-10, atol=1e-12)
                    rows.extend(scaled)
                    stats.append(dict(**scaled_stats, direction_from_deg=baseline["direction_from_deg"],
                                      diffusivity_factor=1, emission_multiplier=multiplier))
    return rows, dict(runs=stats)


def compare_rows(rows):
    cases = {}
    for row in rows:
        key = (row["road_id"], int(row["outer_radius_m"]), int(row["z_low_m"]))
        cases.setdefault(row["case"], {})[key] = float(row["mean_ug_m3"])

    def compare(case, reference):
        values, original = cases[case], cases[reference]
        pairs = [(v, values[road, ring, 15]) for (road, ring, low), v in values.items() if low == 1]
        # Compare rankings within each physical ring and height band.
        rank_changes = 0
        for radius in (10, 25, 50):
            for low in (1, 15):
                keys = [key for key in values if key[1:] == (radius, low)]
                rank_changes += sorted(keys, key=values.__getitem__) != sorted(keys, key=original.__getitem__)
        errors = np.array([value - original[key] for key, value in values.items()])
        targets = np.array([original[key] for key in values])
        return dict(reference=reference, low_higher=sum(a > b for a, b in pairs),
                    height_pairs=len(pairs), rank_changes_out_of_six=rank_changes,
                    maximum_absolute_delta_ug_m3=float(np.abs(errors).max()),
                    relative_l2=float(np.linalg.norm(errors) / np.linalg.norm(targets)))

    return {case: compare(case, case.split(":")[0] + ":base") for case in cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    args.out.mkdir(exist_ok=False, parents=True)
    config_path = Path("config/project.yaml")
    config = yaml.safe_load(config_path.read_text(encoding="utf8"))
    scene = Path(config["paths"]["scene_package_dir"])
    manifest = json.loads((scene / "scene_manifest.json").read_text(encoding="utf8"))
    for name, digest in manifest["files"].items():
        if sha256(scene / name) != digest:
            raise ValueError(f"Scene checksum mismatch for {name}")
    base = manifest["grid"]
    domain = shapely.from_wkt(manifest["study_area"]["wkt"])
    solid = solid_mask(scene / "grid_cells.csv", base)
    _, inputs = inspect_bundle(Path("deploy/demo-inputs"))
    source_path = args.out / "source.nc"
    source_path.write_bytes(inputs["emission_source_transport.nc"])
    with xr.open_dataset(source_path) as ds:
        if ds.S.dims != ("z", "y", "x") or ds.S.attrs.get("units") != "kg m-3 s-1":
            raise ValueError("Unexpected emission axes or units")
        for axis, centres in _coords(base).items():
            # The manifest rounds its projected origin to millimetres.
            np.testing.assert_allclose(ds[axis], centres, rtol=0, atol=1e-3)
        source = ds.S.to_numpy().astype(np.float64)
    if (source.shape != solid.shape or not np.isfinite(source).all()
            or source.min() < 0 or not np.any(source) or np.any(source[solid])):
        raise ValueError("Packaged emission does not align with the source grid")
    # Reuse the same road selection policy as the previous seasonal API audit.
    select_roads = runpy.run_path(str(Path(__file__).with_name("study-road-corridors.py")))["select_roads"]
    roads, selected = select_roads(scene, domain)
    rows, summary = robustness(config, source, base, solid, corridor_weights(base, domain, roads, selected))
    with (args.out / "corridors.csv").open("w", encoding="utf8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    summary.update(study="robustness", roads=selected, comparisons=compare_rows(rows),
                   baseline_source_sha256=sha256(source_path),
                   configuration_sha256=sha256(config_path), scene_files=manifest["files"])
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
