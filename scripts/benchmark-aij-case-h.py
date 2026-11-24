"""Compare production FV scalar transport with the neutral AIJ Case H experiment."""
import argparse
import hashlib
import json
from pathlib import Path
from time import perf_counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.interpolate import RegularGridInterpolator

from scripts.fv_study_support import mixing_protocol, stable_dt, transport
from src.solver import model_version
from src.wind import project_mass_consistent

RECORD = "https://zenodo.org/records/15429872"
H = 0.20
U_H = 3.226
RELEASE = 350e-6 / 60  # m³/s, volume of pure tracer
REFERENCE_PPM = 1e6 * RELEASE / (U_H * H**2)


def load_csv(path, md5):
    if hashlib.md5(path.read_bytes()).hexdigest() != md5:
        raise ValueError(f"Published checksum does not match {path}")
    return pd.read_csv(path).rename(columns=str.strip)


def scores(observed, predicted):
    delta = predicted - observed
    return dict(points=len(delta), rmse=float(np.sqrt(np.mean(delta**2))),
                mae=float(np.mean(abs(delta))), bias=float(delta.mean()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--compare-mixing", action="store_true",
                        help="Compare fixed vertical mixing factors with a spatial holdout")
    args = parser.parse_args()
    args.out.mkdir(exist_ok=False, parents=True)
    approach = load_csv(args.data / "AF_caseH.csv", "1e5fd41fe8b5a7c7989ccfbb1c223ecb")
    points = load_csv(args.data / "RS_caseH.csv", "5eb92407a6f2b0a6aa65759081c2118a")
    coordinates = ["x (m)", "y (m)", "z (m)"]
    # The shared centre-plane line occurs twice in the measurement table.
    observed = points.loc[points["<c> (ppm)"] > -999, coordinates + ["<c> (ppm)"]]
    observed = observed.groupby(coordinates, as_index=False)["<c> (ppm)"].mean()
    h = .01
    x = -.35 + (np.arange(115) + .5) * h
    y = -.32 + (np.arange(64) + .5) * h
    z = (np.arange(45) + .5) * h
    zz, yy, xx = np.ix_(z, y, x)
    solid = (xx >= -.1) & (xx < 0) & (abs(yy) < .05) & (zz < H)
    initial = np.broadcast_to(np.interp(z, approach["z (m)"], approach["U (m/s)"])[:, None, None],
                              solid.shape).copy()
    zero = np.zeros_like(initial)
    wind = project_mass_consistent(initial, zero, zero, solid, dx=h, dy=h, dz=h,
                                   method="cg", tolerance=1e-4)
    # Estimate a constant eddy diffusivity from approach-flow shear stress and shear,
    # using a unit turbulent Schmidt number. Concentration observations are untouched.
    z_in = approach["z (m)"].to_numpy()
    dudz = np.gradient(approach["U (m/s)"], z_in)
    use = (z_in >= .02) & (z_in <= .10) & (dudz > 0) & (approach["uw (m2/s2)"] < 0)
    diffusivity = float(np.median(-approach["uw (m2/s2)"].to_numpy()[use] / dudz[use]))
    if not np.isfinite(diffusivity) or diffusivity <= 0:
        raise ValueError("Approach profile cannot support the diffusivity estimate")
    # The floor hole is smaller than one voxel. Split it over the four touching
    # air cells to preserve the rate and symmetry. The injection jet is unresolved.
    source = np.zeros_like(initial)
    indices_x = np.argsort(abs(x - .05))[:2]
    indices_y = np.argsort(abs(y))[:2]
    source[np.ix_([0], indices_y, indices_x)] = RELEASE / (4 * h**3)
    if np.any(source[solid]):
        raise ValueError("Tracer source overlaps the obstacle")
    spacing = (h, h, h)
    k = (diffusivity,) * 3
    variants, comparison_dt = mixing_protocol(wind, diffusivity, spacing)
    dt = comparison_dt if args.compare_mixing else stable_dt(wind, k, spacing)
    fields, metrics = transport(wind, source, solid, k, spacing, seconds=3, dt=dt, checkpoints=3)
    coords = observed[coordinates].to_numpy()[:, [2, 1, 0]]
    def sample(field):
        return RegularGridInterpolator((z, y, x), np.where(solid, np.nan, field),
                                       bounds_error=False)(coords) * 1e6 / REFERENCE_PPM

    predicted, previous = sample(fields[-1]), sample(fields[-2])
    measured = observed["<c> (ppm)"].to_numpy() / REFERENCE_PPM
    valid = np.isfinite(predicted)
    wake = (coords[:, 2] > 0) & (abs(coords[:, 1]) < .05) & (coords[:, 0] < H)
    result = {name: scores(measured[mask], predicted[mask])
              for name, mask in (("all", valid), ("wake", valid & wake), ("outside_wake", valid & ~wake))}
    point_results = observed.assign(measured_cstar=measured, predicted_cstar=predicted, wake=wake)
    comparison = None
    if args.compare_mixing:
        # Hold out complete streamwise stations, using positions alone before scoring.
        # This split tests interpolation across stations of the same experiment.
        stations = np.unique(coords[valid, 2])
        held_out = np.isin(coords[:, 2], stations[1::2])
        point_results["split"] = np.where(~valid, "excluded", np.where(held_out, "held_out", "development"))
        comparison = {"held_out_x_m": stations[1::2].tolist(), "variants": {},
                      "common_target_dt_s": comparison_dt,
                      "wind_source": "diagnostic projection of measured approach profile"}
        # Run baseline again in the same timing loop as both alternatives.
        for factor in (1.0, 0.5, 2.0):
            # FV diffusivities are ordered (z, y, x). Keep horizontal mixing and wind fixed.
            mixing = variants[factor]
            start = perf_counter()
            samples, budget = transport(wind, source, solid, mixing, spacing, seconds=3,
                                        dt=comparison_dt, checkpoints=3)
            wall_s = perf_counter() - start
            estimate = sample(samples[-1])
            if not np.array_equal(np.isfinite(estimate), valid):
                raise ValueError("Mixing variants must be scored on identical observations")
            point_results[f"predicted_cstar_kz_{factor:g}"] = estimate
            splits = {}
            for split, selected in (("development", ~held_out), ("held_out", held_out)):
                splits[split] = {
                    name: scores(measured[mask], estimate[mask])
                    for name, mask in (
                        ("wake", valid & selected & wake),
                        ("outside_wake", valid & selected & ~wake),
                    )
                }
            comparison["variants"][f"{factor:g}"] = dict(
                vertical_factor=factor, transport_wall_s=wall_s, metrics=budget, scores=splits,
            )
        variants = comparison["variants"]
        winner = min(variants, key=lambda key: variants[key]["scores"]["development"]["wake"]["rmse"])
        comparison["selected_by_development_wake_rmse"] = float(winner)
    point_results.to_csv(args.out / "points.csv", index=False)
    centre = valid & np.isclose(coords[:, 1], 0)
    cmap = "magma"
    limit = max(float(np.max(measured[centre])), float(np.max(predicted[centre])))
    fig, axes = plt.subplots(1, 2, sharex=True, sharey=True, figsize=(10, 4), layout="constrained")
    for ax, values, title in zip(axes, (measured, predicted), ("Wind tunnel", "FV transport"), strict=True):
        dots = ax.scatter(coords[centre, 2] / H, coords[centre, 0] / H, c=values[centre],
                          cmap=cmap, vmin=0, vmax=limit, s=16)
        ax.add_patch(plt.Rectangle((-.5, 0), .5, 1, color="slategray"))
        ax.set(title=title, xlabel="x / H", aspect="equal")
    axes[0].set_ylabel("z / H")
    fig.colorbar(dots, ax=axes, label="Normalized tracer concentration")
    fig.savefig(args.out / "centre-plane.png", dpi=160)
    summary = dict(dataset=RECORD, license="CC BY 4.0", grid_spacing_m=h,
                   model_version=model_version(),
                   input_sha256={name: hashlib.sha256((args.data / name).read_bytes()).hexdigest()
                                 for name in ("AF_caseH.csv", "RS_caseH.csv")},
                   source_volume_m3_s=RELEASE, reference_ppm=REFERENCE_PPM,
                   reference_height_m=H, reference_speed_m_s=U_H,
                   normalization="Cstar = C_ppm / (1e6 * Q_m3_s / (U_H * H**2))",
                   wind_source="diagnostic projection of measured approach profile; not measured 3D wind",
                   diffusivity_m2_s=diffusivity, projected_wind_residual=wind.sor_residual,
                   excluded_points=int((~valid).sum()), metrics=metrics, scores=result,
                   last_second_relative_change=float(np.linalg.norm((predicted - previous)[valid])
                                                     / np.linalg.norm(predicted[valid])))
    if comparison is not None:
        summary["mixing_comparison"] = comparison
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
