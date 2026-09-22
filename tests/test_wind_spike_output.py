"""Regression test for the persisted B1.5 wind-spike evidence."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WIND_PATH = ROOT / "src" / "02_wind.py"


def _load_wind_entry():
    spec = importlib.util.spec_from_file_location(
        "wind_output_entry",
        WIND_PATH,
    )

    if spec is None or spec.loader is None:
        raise ImportError(
            f"cannot load {WIND_PATH}"
        )

    module = importlib.util.module_from_spec(
        spec
    )

    sys.modules[
        "wind_output_entry"
    ] = module

    spec.loader.exec_module(
        module
    )

    return module


def test_week1_spike_persists_three_roadmap_answers(tmp_path) -> None:
    wind = _load_wind_entry()

    result_path = (
        tmp_path
        / "wind_spike_result.json"
    )

    figure_dir = (
        tmp_path
        / "figures"
    )

    wind.run_week1_spike(
        result_json_path=result_path,
        figure_dir=figure_dir,
    )

    assert result_path.is_file()

    report = json.loads(
        result_path.read_text(
            encoding="utf-8"
        )
    )

    assert report["task"] == "B1.5"
    assert report["overall_status"] == "PASS"

    questions = (
        report["formal_case"]
        ["questions"]
    )

    assert questions[
        "q1_sor_converges"
    ]["answer"] is True

    assert questions[
        "q1_sor_converges"
    ]["iterations"] < 10_000

    assert questions[
        "q2_divergence_below_threshold_in_every_air_voxel"
    ]["answer"] is True

    assert questions[
        "q2_divergence_below_threshold_in_every_air_voxel"
    ]["max_abs_div_after_1_s"] < 1.0e-3

    assert questions[
        "q3_flow_deflects_around_building"
    ]["answer"] is True

    assert questions[
        "q3_flow_deflects_around_building"
    ]["max_abs_vertical_speed_near_block_m_s"] > 1.0e-6

    assert report[
        "supplemental_robustness"
    ]["status"] == "PASS"