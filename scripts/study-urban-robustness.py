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
from src.production_study import raster_height
from src.solver import _coords, initial_wind, sha256, solid_mask
from src.wind import project_mass_consistent

SECONDS = 90
SEASONS = ("dry_nov_apr", "wet_may_oct")


def grid_for(base, h):
    return {**base, "dx_m": h, "dy_m": h, "nx": round(base["nx"] * base["dx_m"] / h),
            "ny": round(base["ny"] * base["dy_m"] / h)}


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


def source_at_grids(source, masks):
    """Conserve source rate using only 10 m footprints with air on all three grids."""
    coarse, medium, fine = (masks[h][0] for h in (10, 5, 2.5))
    ny, nx = coarse.shape
    air = ~(coarse | medium.reshape(ny, 2, nx, 2).any(axis=(1, 3))
                  | fine.reshape(ny, 4, nx, 4).any(axis=(1, 3)))
    column = source[0]
    if np.any(source[1:]):
        raise ValueError("Expected source confined to the first layer")
    reduced = column.reshape(ny, 2, nx, 2).mean(axis=(1, 3)) * air
    retained = 4 * reduced.sum() / column.sum()
    if not (0 < retained <= 1 + 1e-12):
        raise ValueError("Invalid common-air emission coverage")
    reduced /= retained
    fields = {}
    for h, factor in ((10, 1), (5, 2), (2.5, 4)):
        field = np.zeros(masks[h].shape)
        field[0] = reduced.repeat(factor, axis=0).repeat(factor, axis=1)
        np.testing.assert_allclose((field * h**2).sum(), (source * 5**2).sum(), rtol=1e-12)
        if np.any(field[masks[h]]):
            raise ValueError("Remapped source intersects a building")
        fields[h] = field
    return fields, float(retained)


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


def numerics(config, scene, source, base, solid, domain, roads, selected):
    grids = {h: grid_for(base, h) for h in (10, 5, 2.5)}
    masks = {5: solid}
    for h in (10, 2.5):
        grid = grids[h]
        heights = raster_height(scene, grid, config["voxelization"]["rasterization"]["all_touched"])
        z = (np.arange(grid["nz"]) + .5) * grid["dz_m"]
        masks[h] = z[:, None, None] < heights
    fields, retained = source_at_grids(source, masks)
    scenario = config["meteorology"]["scenarios"][SEASONS[0]]
    k = diffusivity(config)
    # Determine a common stable step without retaining three wind fields in memory.
    spacing_upper_bound = min(
        stable_dt(project(config, scenario, grid, masks[h]), k, spacing(grid))
        for h, grid in grids.items()
    )
    rows, stats = [], []
    for h in (10, 5, 2.5):
        wind = project(config, scenario, grids[h], masks[h])
        weights = corridor_weights(grids[h], domain, roads, selected)
        for divisor in ((1, 2, 4) if h == 5 else (1,)):
            name = f"h{h}:dt/{divisor}"
            result, metrics = simulate(name, wind, fields[h], masks[h], k, grids[h],
                                       spacing_upper_bound / divisor, weights)
            rows.extend(result)
            stats.append(dict(**metrics, horizontal_spacing_m=h, vertical_spacing_m=base["dz_m"]))
    return rows, dict(runs=stats, retained_before_renormalization=retained,
                      source_support="Shared 10 m air footprints, uniformly redistributed within each footprint")


def compare_rows(rows, study):
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

    if study == "robustness":
        return {case: compare(case, case.split(":")[0] + ":base") for case in cases}
    return dict(horizontal={case: compare(case, "h2.5:dt/1") for case in cases if case.endswith(":dt/1")},
                time_step={case: compare(case, "h5:dt/4") for case in cases if case.startswith("h5:")})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("study", choices=("robustness", "numerics"))
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
    if args.study == "robustness":
        rows, summary = robustness(config, source, base, solid, corridor_weights(base, domain, roads, selected))
    else:
        rows, summary = numerics(config, scene, source, base, solid, domain, roads, selected)
    with (args.out / "corridors.csv").open("w", encoding="utf8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    summary.update(study=args.study, roads=selected, comparisons=compare_rows(rows, args.study),
                   baseline_source_sha256=sha256(source_path),
                   configuration_sha256=sha256(config_path), scene_files=manifest["files"])
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
