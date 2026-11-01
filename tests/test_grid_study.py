"""Fast checks for the B8/B9 grid-study metrics (tiny grids, no full study)."""

import math

import numpy as np
import pytest

from src import grid_study as gs


def test_observed_order_recovers_known_rates():
    assert gs.observed_order(0.4, 0.2) == pytest.approx(1.0)
    assert gs.observed_order(0.4, 0.1) == pytest.approx(2.0)
    assert gs.observed_order(0.0, 0.1) is None


def test_gci_on_synthetic_first_order_sequence():
    exact, c = 10.0, 3.0
    f = [exact + c * h for h in (1.0, 2.0, 4.0)]  # fine, medium, coarse
    res = gs.gci_three_level(*f, formal_order=1.0)
    assert res["convergence"] == "monotone" and res["valid"]
    assert res["observed_order"] == pytest.approx(1.0)
    assert res["extrapolated"] == pytest.approx(exact)
    # Fs * |e21/f1| / (r^p - 1) with e21 = 3, f1 = 13
    assert res["gci_fine_rel"] == pytest.approx(1.25 * 3 / 13)


def test_gci_refuses_oscillatory_divergent_roundoff_and_preasymptotic():
    assert gs.gci_three_level(1.0, 1.1, 0.95)["convergence"] == "oscillatory"
    assert gs.gci_three_level(1.0, 2.0, 2.5)["convergence"] == "divergent"
    assert gs.gci_three_level(1.0, 1.0, 1.0)["convergence"] == "round-off"
    pre = gs.gci_three_level(1.0, 1.03, 1.13, formal_order=1.0)  # p ~ 1.74
    assert pre["convergence"] == "monotone" and not pre["valid"] and "not asymptotic" in pre["reason"]
    for bad in ("oscillatory", "divergent"):
        assert gs.gci_three_level(*{"oscillatory": (1.0, 1.1, 0.95), "divergent": (1.0, 2.0, 2.5)}[bad])["gci_fine_rel"] is None


def test_error_norms_relative_and_volume_weighted():
    ref = np.ones((2, 2, 2)); num = ref.copy(); num[0, 0, 0] = 3.0
    e = gs.error_norms(num, ref, cell_volume=2.0)
    assert e["l1_rel"] == pytest.approx(2 / 8)
    assert e["l2_rel"] == pytest.approx(math.sqrt(4 / 8))
    assert e["linf_rel"] == pytest.approx(2.0)


def _tiny_design():
    d = gs.build_design()
    d["domain_m"] = {"Lx": 440.0, "Ly": 300.0, "Lz": 80.0}
    d["levels"] = {"coarse": {"h_m": 20.0, "dz_m": 8.0}, "medium": {"h_m": 10.0, "dz_m": 4.0}}
    return d


def test_exact_cell_average_conserves_mass_and_matches_moments():
    d = _tiny_design(); axes = gs.grid_axes(d, "medium")
    c = gs.exact_cell_average(d, axes, 50.0)
    vol = axes["h"] ** 2 * axes["dz"]
    assert c.sum() * vol == pytest.approx(d["puff"]["mass_kg"], rel=1e-4)
    mom = gs.field_moments(c, axes); ex = gs.exact_functionals(d, 50.0)
    assert mom["centroid_x_m"] == pytest.approx(ex["centroid_x_m"], abs=1e-3)
    # Sheppard-corrected discrete variance of exact cell averages ~ continuum variance.
    assert mom["variance_x_m2"] == pytest.approx(ex["variance_x_m2"], rel=2e-3)


def test_tiny_case_passes_gates_and_converges_under_refinement(tmp_path):
    d = _tiny_design(); d["comparison_time_s"] = 40.0
    n = gs.cfl_steps(d, "medium", d["courant_target"])
    m = {lv: gs.run_case(d, {"case_id": lv, "sweep": "grid", "level": lv, "n_steps": n}, str(tmp_path)) for lv in ("coarse", "medium")}
    for man in m.values():
        assert man["verification"]["status"] == "pass"
        assert man["verification"]["checks"]["mass_balance"]["value_rel"] < 1e-10
        assert (tmp_path / "cases" / man["case"]["case_id"] / "manifest.json").is_file()
    assert m["medium"]["metrics"]["l2_rel"] < m["coarse"]["metrics"]["l2_rel"]
    assert m["medium"]["metrics"]["variance_x_rel_error"] < m["coarse"]["metrics"]["variance_x_rel_error"]


def test_courant_above_half_loses_positivity_guarantee():
    d = _tiny_design()
    n_half = gs.cfl_steps(d, "medium", 0.5)
    assert gs.positivity_coefficient(d, "medium", d["comparison_time_s"] / n_half) >= 0
    n_one = gs.cfl_steps(d, "medium", 1.0)
    assert gs.positivity_coefficient(d, "medium", d["comparison_time_s"] / n_one) < 0


def test_plan_keeps_comparison_time_and_common_dt():
    d = gs.build_design(); cases = gs.plan_cases(d, "full")
    grid = [c for c in cases if c["sweep"] == "grid"]
    assert len(grid) == 3 and len({c["n_steps"] for c in grid}) == 1
    time_cases = [c for c in cases if c["sweep"] in ("time", "time_reference")]
    assert {c["level"] for c in time_cases} == {"medium"}
    assert sorted(c["dt_divisor"] for c in time_cases) == [1, 2, 4, 8, 32]
