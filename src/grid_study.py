"""B8.2/B8.3/B9.1 grid and time-step convergence study of the FV transport.

Verification only (not validation): a 3D Gaussian puff advected by a uniform
wind and diffused by constant K over a closed, flat ground. The exact solution
is known (moving Gaussian, ground handled by an image source), so the error of
the production operator (``SparseFVStepper`` = the same face-flux upwind/central
explicit step used by ``src.solver``) is measured directly against exact cell
averages. Nothing here reads the urban scene, buildings or the production grid;
the result says nothing about grid convergence of the urban runs.

Sweeps (identical domain, initial condition, BCs, K, wind and comparison time):

* ``grid``     three levels h = 10, 5, 2.5 m (dz = 4, 2, 1 m), r = 2, all with
                the SAME dt (the finest level's CFL step) so time error is
                common and small and the change between levels is spatial.
* ``grid_cfl`` the same three levels with the production rule dt = Cr*CFL
                (courant_target from config), i.e. what a user would actually run.
* ``time``     the production level (5/5/2 m) with dt = dt_cfl, /2, /4, /8 and a
                semi-discrete reference at dt_cfl/32; the temporal error is
                measured against that same-grid reference, not against the exact
                solution, so it is not mixed with spatial error.

    python -m src.grid_study run --stage pilot --out artifacts/grid-study/pilot
    python -m src.grid_study run --stage full  --out artifacts/grid-study

Each case runs in a fresh child process so peak memory is per case.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import math
import os
import platform
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml
from scipy.special import ndtr

REPO_ROOT = Path(__file__).resolve().parents[1]
STUDY_VERSION = "1.0"
REFINEMENT_RATIO = 2.0
SAFETY_FACTOR = 1.25          # Roache Fs for three-grid studies
ROUNDOFF_RTOL = 1e-10         # differences below this are "already converged"


def _load_transport():
    spec = importlib.util.spec_from_file_location("src._transport_grid_study", REPO_ROOT / "src" / "03_transport.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_hash(obj) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Design (B8.2)
# ---------------------------------------------------------------------------

def build_design(config_path: Path = REPO_ROOT / "config" / "project.yaml", scenario: str = "dry_nov_apr") -> dict:
    """Physical problem, taken read-only from the frozen production config."""

    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    tr = config["transport"]
    met = config["meteorology"]["scenarios"][scenario]
    speed = float(met["speed_m_s"]); direction = math.radians(float(met["direction_from_deg"]))
    # Meteorological "from" convention -> velocity towards.
    ux = -speed * math.sin(direction); uy = -speed * math.cos(direction)
    return {
        "study_version": STUDY_VERSION,
        "problem": "3D Gaussian puff, uniform wind, constant K, closed ground (image source), no buildings",
        "config_source": {"path": "config/project.yaml", "sha256": sha256_file(config_path), "scenario": scenario},
        "domain_m": {"Lx": 440.0, "Ly": 300.0, "Lz": 80.0},
        "puff": {"mass_kg": 1.0, "x0": 360.0, "y0": 80.0, "z0": 12.0, "sigma_h0_m": 20.0, "sigma_z0_m": 8.0},
        "wind_m_s": {"ux": ux, "uy": uy, "uz": 0.0, "speed": speed, "direction_from_deg": float(met["direction_from_deg"])},
        "diffusivity_m2_s": {"kx": float(tr["horizontal_diffusivity_m2_s"]), "ky": float(tr["horizontal_diffusivity_m2_s"]),
                             "kz": float(tr["vertical_diffusivity_m2_s"])},
        "comparison_time_s": 100.0,
        "courant_target": float(tr["courant_target"]),
        "gates": {"mass_balance_rtol": float(tr["mass_balance_tolerance"]),
                  "positivity_correction_rtol": float(tr["positivity_correction_tolerance"]),
                  "max_courant": 1.0, "max_diffusion_number": 0.5},
        "levels": {"coarse": {"h_m": 10.0, "dz_m": 4.0}, "medium": {"h_m": 5.0, "dz_m": 2.0},
                   "fine": {"h_m": 2.5, "dz_m": 1.0}},
        "production_level": "medium",
        "time_divisors": [1, 2, 4, 8],
        "time_reference_divisor": 32,
    }


def cfl_steps(design: dict, level: str, courant: float) -> int:
    """Steps N so dt = T/N is the largest step not above courant * CFL limit."""

    lv = design["levels"][level]; w = design["wind_m_s"]; k = design["diffusivity_m2_s"]
    h, dz = lv["h_m"], lv["dz_m"]
    adv = abs(w["ux"]) / h + abs(w["uy"]) / h + abs(w["uz"]) / dz
    dif = k["kx"] / h**2 + k["ky"] / h**2 + k["kz"] / dz**2
    dt = courant * min(1.0 / adv, 0.5 / dif)
    return int(math.ceil(design["comparison_time_s"] / dt - 1e-9))


def plan_cases(design: dict, stage: str) -> list[dict]:
    levels = ["coarse", "medium"] if stage == "pilot" else ["coarse", "medium", "fine"]
    cr = design["courant_target"]
    common = cfl_steps(design, levels[-1], cr)
    cases = []
    for lv in levels:
        cases.append({"case_id": f"grid-{lv}", "sweep": "grid", "level": lv, "n_steps": common})
    for lv in levels:
        n = cfl_steps(design, lv, cr)
        if not (lv == levels[-1]):  # finest level identical to the grid sweep case
            cases.append({"case_id": f"gridcfl-{lv}", "sweep": "grid_cfl", "level": lv, "n_steps": n})
    prod = design["production_level"]; n0 = cfl_steps(design, prod, cr)
    divisors = design["time_divisors"][:2] if stage == "pilot" else design["time_divisors"]
    ref_div = 8 if stage == "pilot" else design["time_reference_divisor"]
    for d in divisors:
        cases.append({"case_id": f"time-dt{d}", "sweep": "time", "level": prod, "n_steps": n0 * d, "dt_divisor": d})
    cases.append({"case_id": f"time-ref{ref_div}", "sweep": "time_reference", "level": prod,
                  "n_steps": n0 * ref_div, "dt_divisor": ref_div})
    return cases


# ---------------------------------------------------------------------------
# Exact solution
# ---------------------------------------------------------------------------

def grid_axes(design: dict, level: str) -> dict:
    lv = design["levels"][level]; d = design["domain_m"]
    h, dz = lv["h_m"], lv["dz_m"]
    n = {"nx": round(d["Lx"] / h), "ny": round(d["Ly"] / h), "nz": round(d["Lz"] / dz)}
    if not all(math.isclose(n[a] * s, d[L]) for a, s, L in (("nx", h, "Lx"), ("ny", h, "Ly"), ("nz", dz, "Lz"))):
        raise ValueError("domain not divisible by level spacing")
    edges = {"x": np.linspace(0, d["Lx"], n["nx"] + 1), "y": np.linspace(0, d["Ly"], n["ny"] + 1),
             "z": np.linspace(0, d["Lz"], n["nz"] + 1)}
    return {"h": h, "dz": dz, **n, "edges": edges, "centres": {a: 0.5 * (e[1:] + e[:-1]) for a, e in edges.items()}}


def exact_sigmas(design: dict, t: float) -> tuple[float, float, float]:
    p = design["puff"]; k = design["diffusivity_m2_s"]
    return (math.sqrt(p["sigma_h0_m"]**2 + 2 * k["kx"] * t), math.sqrt(p["sigma_h0_m"]**2 + 2 * k["ky"] * t),
            math.sqrt(p["sigma_z0_m"]**2 + 2 * k["kz"] * t))


def _cell_fraction(edges: np.ndarray, mu: float, sigma: float) -> np.ndarray:
    cdf = ndtr((edges - mu) / sigma)
    return np.diff(cdf)


def exact_cell_average(design: dict, axes: dict, t: float) -> np.ndarray:
    """Exact cell average [z, y, x] at time t (kg m-3)."""

    p = design["puff"]; w = design["wind_m_s"]
    sx, sy, sz = exact_sigmas(design, t)
    fx = _cell_fraction(axes["edges"]["x"], p["x0"] + w["ux"] * t, sx)
    fy = _cell_fraction(axes["edges"]["y"], p["y0"] + w["uy"] * t, sy)
    zc = p["z0"] + w["uz"] * t
    # Image source at -zc: its mass in cell [a, b] (a >= 0) is ndtr((b+zc)/s) - ndtr((a+zc)/s).
    fz = _cell_fraction(axes["edges"]["z"], zc, sz) + np.diff(ndtr((axes["edges"]["z"] + zc) / sz))
    volume = axes["h"] * axes["h"] * axes["dz"]
    return p["mass_kg"] * fz[:, None, None] * fy[None, :, None] * fx[None, None, :] / volume


def exact_functionals(design: dict, t: float) -> dict:
    """Continuum (grid-free) values of the scalar functionals at time t."""

    p = design["puff"]; w = design["wind_m_s"]
    sx, sy, sz = exact_sigmas(design, t)
    zc = p["z0"] + w["uz"] * t
    z = np.linspace(0, design["domain_m"]["Lz"], 200001)
    g = (np.exp(-0.5 * ((z - zc) / sz) ** 2) + np.exp(-0.5 * ((z + zc) / sz) ** 2)) / (sz * math.sqrt(2 * math.pi))
    mz = np.trapezoid(g, z); cz = np.trapezoid(g * z, z) / mz
    vz = np.trapezoid(g * (z - cz) ** 2, z) / mz
    peak = p["mass_kg"] * g.max() / (2 * math.pi * sx * sy)
    return {"centroid_x_m": p["x0"] + w["ux"] * t, "centroid_y_m": p["y0"] + w["uy"] * t, "centroid_z_m": cz,
            "variance_x_m2": sx**2, "variance_y_m2": sy**2, "variance_z_m2": vz, "peak_kg_m3": peak}


# ---------------------------------------------------------------------------
# Metrics (unit-tested in tests/test_grid_study.py)
# ---------------------------------------------------------------------------

def error_norms(numerical: np.ndarray, reference: np.ndarray, cell_volume: float) -> dict:
    """Relative volume-weighted L1, L2 and max-norm errors."""

    e = numerical - reference
    return {"l1_rel": float(np.abs(e).sum() / np.abs(reference).sum()),
            "l2_rel": float(math.sqrt((e**2).sum() * cell_volume) / math.sqrt((reference**2).sum() * cell_volume)),
            "linf_rel": float(np.abs(e).max() / np.abs(reference).max())}


def field_moments(field: np.ndarray, axes: dict, sheppard: bool = True) -> dict:
    """Centroid and variance per axis from cell centres; Sheppard-corrected (h^2/12)."""

    out = {}; total = float(field.sum())
    for name, ax, spacing in (("x", 2, axes["h"]), ("y", 1, axes["h"]), ("z", 0, axes["dz"])):
        other = tuple(i for i in range(3) if i != ax)
        profile = field.sum(axis=other); c = axes["centres"][name]
        mean = float((profile * c).sum() / total)
        var = float((profile * (c - mean) ** 2).sum() / total) - (spacing**2 / 12.0 if sheppard else 0.0)
        out[f"centroid_{name}_m"] = mean; out[f"variance_{name}_m2"] = var
    out["peak_kg_m3"] = float(field.max())
    return out


def observed_order(error_coarse: float, error_fine: float, ratio: float = REFINEMENT_RATIO) -> float | None:
    """Two-level order against an exact reference: ln(e_c/e_f)/ln r."""

    if not (error_coarse > 0 and error_fine > 0):
        return None
    return math.log(error_coarse / error_fine) / math.log(ratio)


def gci_three_level(f_fine: float, f_medium: float, f_coarse: float, ratio: float = REFINEMENT_RATIO,
                    formal_order: float = 1.0, order_tolerance: float = 0.3, fs: float = SAFETY_FACTOR) -> dict:
    """Roache three-grid order, Richardson extrapolation and GCI with explicit validity.

    GCI is reported as valid only when convergence is monotone (0 < R < 1) and the
    observed order lies within ``order_tolerance`` (relative) of the formal order,
    our proxy for "in the asymptotic range". Otherwise the reason is returned.
    """

    e21 = f_medium - f_fine; e32 = f_coarse - f_medium
    scale = max(abs(f_fine), abs(f_medium), abs(f_coarse), np.finfo(float).tiny)
    result = {"f_fine": f_fine, "f_medium": f_medium, "f_coarse": f_coarse, "ratio_R": None,
              "convergence": None, "observed_order": None, "extrapolated": None, "gci_fine_rel": None,
              "gci_medium_rel": None, "valid": False, "reason": ""}
    if abs(e21) <= ROUNDOFF_RTOL * scale or abs(e32) <= ROUNDOFF_RTOL * scale:
        result.update(convergence="round-off", reason="differences between levels at round-off; GCI not applicable")
        return result
    R = e21 / e32; result["ratio_R"] = R
    if R < 0:
        result.update(convergence="oscillatory", reason="oscillatory convergence (R < 0); GCI not applicable")
        return result
    if R >= 1:
        result.update(convergence="divergent", reason="divergent (R >= 1); GCI not applicable")
        return result
    p = math.log(1.0 / R) / math.log(ratio)
    rp = ratio**p
    ext = f_fine + (f_fine - f_medium) / (rp - 1.0)
    gci_f = fs * abs(e21 / f_fine) / (rp - 1.0) if f_fine else None
    gci_m = fs * abs(e32 / f_medium) / (rp - 1.0) if f_medium else None
    asymptotic = abs(p - formal_order) <= order_tolerance * formal_order
    result.update(convergence="monotone", observed_order=p, extrapolated=ext, gci_fine_rel=gci_f, gci_medium_rel=gci_m,
                  valid=bool(asymptotic),
                  reason="" if asymptotic else f"observed order {p:.2f} outside +/-{order_tolerance:.0%} of formal {formal_order:g}: not asymptotic")
    return result


# ---------------------------------------------------------------------------
# One case (runs in a child process)
# ---------------------------------------------------------------------------

def _peak_memory_bytes() -> int:
    import psutil
    info = psutil.Process().memory_info()
    if hasattr(info, "peak_wset"):
        return int(info.peak_wset)
    import resource
    return int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss) * 1024


def simulate(design: dict, level: str, n_steps: int, transport=None) -> dict:
    """Run the production sparse FV step; returns field, ledger and gate data."""

    from src.fv_operator import SparseFVStepper

    transport = transport or _load_transport()
    axes = grid_axes(design, level)
    nx, ny, nz, h, dz = axes["nx"], axes["ny"], axes["nz"], axes["h"], axes["dz"]
    w = design["wind_m_s"]; k = design["diffusivity_m2_s"]; T = design["comparison_time_s"]
    faces = (np.full((nz, ny, nx + 1), w["ux"]), np.full((nz, ny + 1, nx), w["uy"]), np.full((nz + 1, ny, nx), w["uz"]))
    # Closed ground: no vertical flux through z = 0 (already zero with uz = 0).
    faces[2][0] = 0.0
    solid = np.zeros((nz, ny, nx), bool); source = np.zeros((nz, ny, nx))
    diff = (k["kz"], k["ky"], k["kx"])
    dt = T / n_steps
    courant = transport.courant_number_faces(faces, dt, dz_m=dz, dy_m=h, dx_m=h)
    diffusion_number = dt * (k["kx"] / h**2 + k["ky"] / h**2 + k["kz"] / dz**2)
    c = exact_cell_average(design, axes, 0.0)
    volume = h * h * dz
    m0 = float(c.sum()) * volume
    t0 = time.perf_counter()
    stepper = SparseFVStepper(faces, source, diff, solid, (dz, h, h), transport)
    setup_s = time.perf_counter() - t0
    ledger: dict = {}; failure = None
    t1 = time.perf_counter()
    try:
        for _ in range(n_steps):
            c = stepper.step(c, dt, ledger)
    except transport.NegativeConcentrationError as exc:
        failure = f"positivity: {exc}"
    step_s = time.perf_counter() - t1
    return {"axes": axes, "field": c, "ledger": ledger, "dt": dt, "courant": courant,
            "diffusion_number": diffusion_number, "mass0": m0, "volume": volume, "failure": failure,
            "setup_s": setup_s, "step_s": step_s}


def run_case(design: dict, case: dict, out_dir: str) -> dict:
    t_start = time.perf_counter()
    sim = simulate(design, case["level"], case["n_steps"])
    axes = sim["axes"]; c = sim["field"]; vol = sim["volume"]; led = sim["ledger"]
    T = design["comparison_time_s"]; g = design["gates"]
    ref = exact_cell_average(design, axes, T)
    mass_T = float(c.sum()) * vol
    balance = sim["mass0"] + led.get("emitted_kg", 0) - led.get("escaped_kg", 0) - led.get("solid_removed_kg", 0) \
        + led.get("positivity_correction_kg", 0) - mass_T
    mass_rel = abs(balance) / sim["mass0"]
    pos_rel = led.get("positivity_correction_kg", 0.0) / sim["mass0"]
    checks = {
        "courant": {"value": sim["courant"], "limit": g["max_courant"], "status": "pass" if sim["courant"] <= g["max_courant"] else "fail"},
        "diffusion_number": {"value": sim["diffusion_number"], "limit": g["max_diffusion_number"],
                             "status": "pass" if sim["diffusion_number"] <= g["max_diffusion_number"] + 1e-12 else "fail"},
        "positivity": {"raw_failure": sim["failure"], "correction_rel": pos_rel, "limit": g["positivity_correction_rtol"],
                       "status": "pass" if sim["failure"] is None and pos_rel <= g["positivity_correction_rtol"] else "fail"},
        "mass_balance": {"value_rel": mass_rel, "limit": g["mass_balance_rtol"],
                         "status": "pass" if mass_rel <= g["mass_balance_rtol"] else "fail"},
    }
    status = "pass" if all(v["status"] == "pass" for v in checks.values()) else "fail"
    num_mom = field_moments(c, axes); ref_mom = field_moments(ref, axes)
    metrics = error_norms(c, ref, vol)
    metrics.update({
        "mass_in_domain_rel_error": (mass_T - float(ref.sum()) * vol) / sim["mass0"],
        "escaped_mass_rel": led.get("escaped_kg", 0.0) / sim["mass0"],
        "peak_rel_error": (num_mom["peak_kg_m3"] - ref_mom["peak_kg_m3"]) / ref_mom["peak_kg_m3"],
        "centroid_error_m": float(math.dist([num_mom[f"centroid_{a}_m"] for a in "xyz"], [ref_mom[f"centroid_{a}_m"] for a in "xyz"])),
        **{f"variance_{a}_rel_error": (num_mom[f"variance_{a}_m2"] - ref_mom[f"variance_{a}_m2"]) / ref_mom[f"variance_{a}_m2"] for a in "xyz"},
    })
    case_dir = Path(out_dir) / "cases" / case["case_id"]; case_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(case_dir / "field.npz", concentration=c)
    manifest = {
        "case": case, "design_hash": canonical_hash(design), "case_hash": canonical_hash({"design": design, "case": case}),
        "grid": {k: axes[k] for k in ("h", "dz", "nx", "ny", "nz")}, "cells": int(c.size),
        "dt_s": sim["dt"], "n_steps": case["n_steps"], "comparison_time_s": T,
        "verification": {"status": status, "checks": checks},
        "ledger_kg": led, "mass0_kg": sim["mass0"],
        "metrics": metrics, "functionals_numerical": num_mom, "functionals_reference_discrete": ref_mom,
        "runtime_s": {"setup": sim["setup_s"], "stepping": sim["step_s"], "total_case": time.perf_counter() - t_start},
        "peak_memory_bytes": _peak_memory_bytes(),
        "field_file": "field.npz", "field_sha256": sha256_file(case_dir / "field.npz"),
    }
    (case_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, default=float), encoding="utf-8")
    return manifest


# ---------------------------------------------------------------------------
# Study driver
# ---------------------------------------------------------------------------

def _provenance() -> dict:
    files = ["src/03_transport.py", "src/fv_operator.py", "src/grid_study.py", "config/project.yaml"]
    try:
        from src.solver import model_version
        version = model_version()
    except Exception as exc:  # pragma: no cover - provenance only
        version = f"unknown ({exc})"
    import scipy
    return {"model_version": version, "source_sha256": {f: sha256_file(REPO_ROOT / f) for f in files},
            "python": sys.version.split()[0], "numpy": np.__version__, "scipy": scipy.__version__,
            "platform": platform.platform(), "cpu_count": os.cpu_count(),
            "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def analyse(design: dict, manifests: dict[str, dict], out_dir: Path, stage: str) -> dict:
    levels = ["coarse", "medium"] if stage == "pilot" else ["coarse", "medium", "fine"]
    exact = exact_functionals(design, design["comparison_time_s"])
    norms = ["l1_rel", "l2_rel", "linf_rel", "peak_rel_error", "variance_x_rel_error", "variance_y_rel_error", "variance_z_rel_error"]
    out: dict = {"exact_functionals": exact, "grid_orders": {}, "grid_cfl_orders": {}, "gci": {}, "time": {}}
    for sweep in ("grid_orders", "grid_cfl_orders"):
        for name in norms:
            series = []
            for lv in levels:
                cid = f"grid-{lv}" if sweep == "grid_orders" or lv == levels[-1] else f"gridcfl-{lv}"
                series.append(abs(manifests[cid]["metrics"][name]))
            out[sweep][name] = {"errors": series, "orders": [observed_order(series[i], series[i + 1]) for i in range(len(series) - 1)]}
    if len(levels) == 3:
        formal = {"peak_kg_m3": 1.0, "variance_x_m2": 1.0, "variance_y_m2": 1.0, "variance_z_m2": 2.0,
                  "centroid_x_m": 1.0, "centroid_y_m": 1.0, "centroid_z_m": 2.0}
        for f, p_f in formal.items():
            vals = [manifests[f"grid-{lv}"]["functionals_numerical"][f] for lv in ("fine", "medium", "coarse")]
            res = gci_three_level(*vals, formal_order=p_f)
            res["exact"] = exact[f]
            res["true_rel_error_fine"] = abs(vals[0] - exact[f]) / abs(exact[f])
            res["gci_band_covers_exact"] = (None if res["gci_fine_rel"] is None
                                            else bool(res["true_rel_error_fine"] <= res["gci_fine_rel"]))
            out["gci"][f] = res
    # Time sweep: temporal error vs a same-grid semi-discrete reference.
    ref_id = next(k for k, m in manifests.items() if m["case"]["sweep"] == "time_reference")
    ref_dir = out_dir / "cases" / ref_id
    c_ref = np.load(ref_dir / "field.npz")["concentration"]
    vol = manifests[ref_id]["grid"]["h"] ** 2 * manifests[ref_id]["grid"]["dz"]
    rows = []
    for cid in sorted((k for k, m in manifests.items() if m["case"]["sweep"] == "time"), key=lambda k: manifests[k]["dt_s"], reverse=True):
        c = np.load(out_dir / "cases" / cid / "field.npz")["concentration"]
        te = error_norms(c, c_ref, vol)
        rows.append({"case_id": cid, "dt_s": manifests[cid]["dt_s"], "temporal": te,
                     "total_vs_exact_l2": manifests[cid]["metrics"]["l2_rel"]})
    for i in range(len(rows) - 1):
        rows[i + 1]["temporal_order_l2"] = observed_order(rows[i]["temporal"]["l2_rel"], rows[i + 1]["temporal"]["l2_rel"])
    # Reference-free order from successive differences ||C(dt)-C(dt/2)|| (no bias from the dt/32 reference).
    fields = [np.load(out_dir / "cases" / r["case_id"] / "field.npz")["concentration"] for r in rows]
    diffs = [float(np.sqrt(((fields[i] - fields[i + 1]) ** 2).sum())) for i in range(len(fields) - 1)]
    difference_orders = [observed_order(diffs[i], diffs[i + 1]) for i in range(len(diffs) - 1)]
    out["time"] = {"reference_case": ref_id, "reference_dt_s": manifests[ref_id]["dt_s"],
                   "reference_vs_exact_l2": manifests[ref_id]["metrics"]["l2_rel"], "rows": rows,
                   "successive_difference_l2": diffs, "difference_orders": difference_orders}
    # Modified-equation check: upwind + forward Euler adds variance u*h*t - u^2*dt*t per axis, so
    # the h -> 0 limit at the grid sweep's fixed dt is sigma^2_exact - u^2*dt*T (a time-error bias).
    if "variance_x_m2" in out["gci"]:
        dt_common = manifests["grid-fine"]["dt_s"]; T = design["comparison_time_s"]; w = design["wind_m_s"]
        out["modified_equation_check"] = {
            a: {"predicted_limit_fixed_dt": exact[f"variance_{a}_m2"] - w[f"u{a}"] ** 2 * dt_common * T,
                "richardson_extrapolated": out["gci"][f"variance_{a}_m2"]["extrapolated"]} for a in "xy"}
    return out


def write_tables(manifests: dict, analysis: dict, out_dir: Path) -> None:
    fields = ["case_id", "sweep", "level", "h_m", "dz_m", "cells", "n_steps", "dt_s", "courant", "diffusion_number",
              "status", "mass_balance_rel", "l1_rel", "l2_rel", "linf_rel", "peak_rel_error", "centroid_error_m",
              "variance_x_rel_error", "variance_y_rel_error", "variance_z_rel_error", "mass_in_domain_rel_error",
              "runtime_s", "peak_memory_mb"]
    with (out_dir / "summary.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields); w.writeheader()
        for cid, m in manifests.items():
            v = m["verification"]["checks"]
            w.writerow({"case_id": cid, "sweep": m["case"]["sweep"], "level": m["case"]["level"], "h_m": m["grid"]["h"],
                        "dz_m": m["grid"]["dz"], "cells": m["cells"], "n_steps": m["n_steps"], "dt_s": f"{m['dt_s']:.6g}",
                        "courant": f"{v['courant']['value']:.4g}", "diffusion_number": f"{v['diffusion_number']['value']:.4g}",
                        "status": m["verification"]["status"], "mass_balance_rel": f"{v['mass_balance']['value_rel']:.3e}",
                        **{k: f"{m['metrics'][k]:.6g}" for k in fields[12:21]},
                        "runtime_s": f"{m['runtime_s']['total_case']:.2f}", "peak_memory_mb": f"{m['peak_memory_bytes'] / 2**20:.0f}"})


def make_figures(manifests: dict, analysis: dict, out_dir: Path, stage: str) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    colors = ["#2a78d6", "#eb6834", "#1baf7a", "#6250d6", "#e87ba4"]
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
                         "axes.grid": True, "grid.color": "#e4e3df", "grid.linewidth": 0.6})
    levels = ["coarse", "medium"] if stage == "pilot" else ["coarse", "medium", "fine"]
    h = np.array([manifests[f"grid-{lv}"]["grid"]["h"] for lv in levels])
    written = []

    def slope_guide(ax, x, y0, p, label):
        ax.plot(x, y0 * (x / x[0]) ** p, ls=":", color="#52514e", lw=1)
        ax.annotate(label, (x[-1], y0 * (x[-1] / x[0]) ** p), textcoords="offset points", xytext=(4, -10), fontsize=8, color="#52514e")

    for sweep, title, fname in (("grid_orders", "Sai số theo h (dt chung = dt CFL của lưới mịn)", "fig_error_vs_h.png"),
                                ("grid_cfl_orders", "Sai số theo h (dt = Cr·CFL từng lưới, như production)", "fig_error_vs_h_cfl.png")):
        fig, ax = plt.subplots(figsize=(6.4, 4.6))
        for i, (name, lab) in enumerate((("l1_rel", "L1 tương đối"), ("l2_rel", "L2 tương đối"), ("linf_rel", "Linf tương đối"),
                                          ("variance_x_rel_error", "|sai số σx²|"), ("peak_rel_error", "|sai số đỉnh|"))):
            e = np.array(analysis[sweep][name]["errors"])
            p = np.polyfit(np.log(h), np.log(e), 1)[0]
            ax.loglog(h, e, marker="o", ms=6, lw=2, color=colors[i], label=f"{lab} (độ dốc {p:.2f})")
        slope_guide(ax, h, analysis[sweep]["l2_rel"]["errors"][0] * 0.55, 1, "bậc 1")
        ax.set_xlabel("h ngang (m); dz = 0.4·h"); ax.set_ylabel("sai số tương đối so với nghiệm giải tích")
        ax.set_title(title, fontsize=10); ax.legend(fontsize=8, frameon=False); ax.invert_xaxis()
        ax.set_xticks(h, [f"{v:g}" for v in h]); ax.minorticks_off()
        fig.tight_layout(); fig.savefig(out_dir / fname, dpi=150); plt.close(fig); written.append(fname)

    rows = analysis["time"]["rows"]
    dt = np.array([r["dt_s"] for r in rows])
    fig, ax = plt.subplots(figsize=(6.4, 4.6))
    for i, (key, lab) in enumerate((("l1_rel", "L1 thời gian"), ("l2_rel", "L2 thời gian"), ("linf_rel", "Linf thời gian"))):
        e = np.array([r["temporal"][key] for r in rows])
        p = np.polyfit(np.log(dt), np.log(e), 1)[0]
        ax.loglog(dt, e, marker="o", ms=6, lw=2, color=colors[i], label=f"{lab} vs tham chiếu dt/{analysis['time']['reference_case'].split('ref')[-1]} (độ dốc {p:.2f})")
    tot = np.array([r["total_vs_exact_l2"] for r in rows])
    ax.loglog(dt, tot, marker="s", ms=6, lw=2, color=colors[3], label="L2 tổng so với giải tích")
    slope_guide(ax, dt, rows[0]["temporal"]["l2_rel"] * 0.5, 1, "bậc 1")
    ax.set_xlabel("dt (s), lưới production 5/5/2 m"); ax.set_ylabel("sai số tương đối")
    ax.set_title("Sai số theo bước thời gian (tách khỏi sai số không gian)", fontsize=10)
    ax.legend(fontsize=8, frameon=False); ax.invert_xaxis()
    ax.set_xticks(dt, [f"{v:.3g}" for v in dt]); ax.minorticks_off()
    fig.tight_layout(); fig.savefig(out_dir / "fig_error_vs_dt.png", dpi=150); plt.close(fig); written.append("fig_error_vs_dt.png")

    # Profile along the plume centreline (x), cell values through the exact centre.
    from_design = json.loads((out_dir / "design.json").read_text(encoding="utf-8"))
    fig, ax = plt.subplots(figsize=(6.4, 4.0))
    ex = analysis["exact_functionals"]
    for i, lv in enumerate(levels):
        axes = grid_axes(from_design, lv)
        c = np.load(out_dir / "cases" / f"grid-{lv}" / "field.npz")["concentration"]
        prof = c.sum(axis=(0, 1)) * axes["h"] * axes["dz"]
        ax.plot(axes["centres"]["x"], prof, lw=2, color=colors[i], label=f"FV {lv} (h={axes['h']:g} m)")
    xs = np.linspace(0, from_design["domain_m"]["Lx"], 2000); sx = math.sqrt(ex["variance_x_m2"])
    ax.plot(xs, from_design["puff"]["mass_kg"] * np.exp(-0.5 * ((xs - ex["centroid_x_m"]) / sx) ** 2) / (sx * math.sqrt(2 * math.pi)),
            color="#0b0b0b", lw=1.2, ls="--", label="giải tích")
    ax.set_xlabel("x (m)"); ax.set_ylabel("khối lượng theo x (kg m⁻¹)"); ax.set_xlim(60, 360)
    ax.set_title(f"Phân bố khối lượng theo x tại t = {from_design['comparison_time_s']:g} s", fontsize=10)
    ax.legend(fontsize=8, frameon=False)
    fig.tight_layout(); fig.savefig(out_dir / "fig_profile_x.png", dpi=150); plt.close(fig); written.append("fig_profile_x.png")
    return written


def positivity_coefficient(design: dict, level: str, dt: float) -> float:
    """Diagonal coefficient 1 - dt*(sum|u|/d + 2*sum K/d^2); >= 0 guarantees a positive explicit update."""

    w = design["wind_m_s"]; k = design["diffusivity_m2_s"]; lv = design["levels"][level]
    h, dz = lv["h_m"], lv["dz_m"]
    return 1.0 - dt * (abs(w["ux"]) / h + abs(w["uy"]) / h + abs(w["uz"]) / dz
                       + 2.0 * (k["kx"] / h**2 + k["ky"] / h**2 + k["kz"] / dz**2))


def stability_probe(design: dict, levels=("coarse", "medium"), courants=(0.5, 0.75, 1.0)) -> list[dict]:
    """Expected-to-fail probe: the CFL rule min(1/A, 0.5/D) is not a positivity bound above Cr = 0.5."""

    rows = []
    for cr in courants:
        for lv in levels:
            n = cfl_steps(design, lv, cr); sim = simulate(design, lv, n)
            rows.append({"courant_target": cr, "level": lv, "n_steps": n, "dt_s": sim["dt"],
                         "advective_courant": sim["courant"], "diffusion_number": sim["diffusion_number"],
                         "diagonal_coefficient": positivity_coefficient(design, lv, sim["dt"]),
                         "positivity_failure": sim["failure"]})
    return rows


def run_study(stage: str, out_dir: Path, workers: int = 1) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    design = build_design(); cases = plan_cases(design, stage)
    (out_dir / "design.json").write_text(json.dumps(design, indent=2), encoding="utf-8")
    t0 = time.perf_counter(); manifests = {}
    with ProcessPoolExecutor(max_workers=workers, max_tasks_per_child=1) as pool:
        futures = {c["case_id"]: pool.submit(run_case, design, c, str(out_dir)) for c in cases}
        for cid, fut in futures.items():
            manifests[cid] = fut.result()
            m = manifests[cid]
            print(json.dumps({"case": cid, "status": m["verification"]["status"], "cells": m["cells"], "steps": m["n_steps"],
                              "l2_rel": round(m["metrics"]["l2_rel"], 6), "runtime_s": round(m["runtime_s"]["total_case"], 2),
                              "peak_mb": round(m["peak_memory_bytes"] / 2**20)}), flush=True)
    analysis = analyse(design, manifests, out_dir, stage)
    if stage == "full":
        analysis["stability_probe"] = stability_probe(design)
    wall = time.perf_counter() - t0
    summary = {"stage": stage, "design_hash": canonical_hash(design), "provenance": _provenance(),
               "all_cases_pass_verification": all(m["verification"]["status"] == "pass" for m in manifests.values()),
               "wall_time_s": wall, "runtime_budget_s": 1200.0,
               "cases": {cid: {"status": m["verification"]["status"], "dt_s": m["dt_s"], "n_steps": m["n_steps"],
                               "grid": m["grid"], "metrics": m["metrics"], "runtime_s": m["runtime_s"],
                               "peak_memory_mb": m["peak_memory_bytes"] / 2**20, "case_hash": m["case_hash"]}
                         for cid, m in manifests.items()},
               "analysis": analysis}
    write_tables(manifests, analysis, out_dir)
    summary["figures"] = make_figures(manifests, analysis, out_dir, stage)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=float), encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run the study")
    run.add_argument("--stage", choices=("pilot", "full"), default="full")
    run.add_argument("--out", type=Path, default=REPO_ROOT / "artifacts" / "grid-study")
    run.add_argument("--workers", type=int, default=1, help="parallel cases (1 keeps runtimes comparable)")
    args = parser.parse_args(argv)
    summary = run_study(args.stage, args.out, args.workers)
    print(json.dumps({"stage": summary["stage"], "all_pass": summary["all_cases_pass_verification"],
                      "wall_time_s": round(summary["wall_time_s"], 1), "out": str(args.out)}))
    return 0 if summary["all_cases_pass_verification"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
