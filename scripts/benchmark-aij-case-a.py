"""Compare the production diagnostic wind projection with AIJ UWE Case A."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

import numpy as np
from scipy.interpolate import RegularGridInterpolator

from src.wind import project_mass_consistent


def read_points(path, digest, columns):
    # Compare against the repository's published digests to catch file mix-ups.
    if hashlib.md5(path.read_bytes()).hexdigest() != digest:
        raise ValueError(f"Unexpected published checksum for {path.name}")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return np.array([[float(row[key]) for key in columns] for row in csv.DictReader(handle)])


def error_stats(predicted, measured, scale):
    error = (predicted - measured) / scale
    return dict(bias=error.mean(axis=0).tolist(),
                mae=np.abs(error).mean(axis=0).tolist(),
                rmse=np.sqrt((error ** 2).mean(axis=0)).tolist())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("data", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    b = 0.08
    height = 2 * b
    approach = read_points(args.data / "AF_caseA.csv", "9f116e2ec5f6984c12c4076bbf242986",
                           ["z(m)", "U(m/s)"])
    measured = read_points(args.data / "RS-caseA.csv", "fc0fe3c1b6c36f20bca135ad1c37f83b",
                           ["x(m)", "y(m)", "z(m)", "U(m/s)", "V(m/s)", "W(m/s)"])
    # Center the block on x=y=0 and align its faces with grid boundaries.
    dx = dy = b / 8
    dz = b / 12
    x = -5 * b + (np.arange(120) + 0.5) * dx
    y = -4 * b + (np.arange(64) + 0.5) * dy
    z = (np.arange(72) + 0.5) * dz
    zz, yy, xx = np.ix_(z, y, x)
    solid = (abs(xx) < b / 2) & (abs(yy) < b / 2) & (zz < height)
    def profile(levels):
        # Keep measured endpoint speeds outside the sampled height range.
        return np.interp(levels, approach[:, 0], approach[:, 1])

    initial = np.broadcast_to(profile(z)[:, None, None], solid.shape).copy()
    zero = np.zeros_like(initial)
    wind = project_mass_consistent(initial, zero, zero, solid, dx=dx, dy=dy, dz=dz,
                                   method="cg", tolerance=1e-4, max_iter=10000)

    # A stencil touching the obstacle is excluded instead of treating solids as air.
    predicted = np.column_stack([
        RegularGridInterpolator((z, y, x), np.where(solid, np.nan, field),
                                bounds_error=False)(measured[:, [2, 1, 0]])
        for field in (wind.u, wind.v, wind.w)
    ])
    valid = np.isfinite(predicted).all(axis=1)
    wake = (measured[:, 0] > b / 2) & (abs(measured[:, 1]) < b / 2) & (measured[:, 2] < height)
    inlet = np.column_stack([profile(measured[:, 2]), np.zeros((len(measured), 2))])
    scale = float(profile(height))
    results = {}
    for name, selection in (("all", valid), ("wake", valid & wake)):
        if not np.any(selection):
            raise ValueError(f"No comparable points in {name}")
        reverse = selection & (measured[:, 3] < 0)
        results[name] = dict(points=int(selection.sum()), measured_reverse=int(reverse.sum()),
                             predicted_reverse_at_measured_reverse=int((reverse & (predicted[:, 0] < 0)).sum()),
                             projection=error_stats(predicted[selection], measured[selection, 3:], scale),
                             inlet_only=error_stats(inlet[selection], measured[selection, 3:], scale))

    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / "comparison.json").open("w", encoding="utf-8") as handle:
        json.dump(dict(dataset="https://zenodo.org/records/15050148", license="CC BY 4.0",
                       measured_points=len(measured), excluded_points=int((~valid).sum()),
                       spacing_m=[dx, dy, dz], block_size_m=[b, b, height],
                       bounds_m=[[-5 * b, 10 * b], [-4 * b, 4 * b], [0, 6 * b]],
                       reference_speed_m_s=scale, error_units="fraction of reference speed",
                       components=["u", "v", "w"], iterations=wind.iterations,
                       projection_residual=wind.sor_residual, results=results),
                  handle, indent=2, allow_nan=False)
    np.savetxt(args.out / "points.csv", np.column_stack([measured, predicted, valid, wake]),
               delimiter=",", comments="",
               header="x_m,y_m,z_m,u_measured,v_measured,w_measured,u_predicted,v_predicted,w_predicted,comparable,wake")


if __name__ == "__main__":
    main()
