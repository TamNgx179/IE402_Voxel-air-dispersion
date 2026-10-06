"""
Contract v1 between the Python solver and the monolith (docs/spec.md,
"Hợp đồng v1"). The monolith validates the same schema file, so a change
here that the other side does not see breaks the run, not the report.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((REPO_ROOT / "config" / "manifest.schema.json").read_text(encoding="utf-8"))
EXAMPLE = json.loads(
    (REPO_ROOT / "tests" / "fixtures" / "manifest_v1_example.json").read_text(encoding="utf-8")
)

validator = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def _errors(manifest: dict) -> list[str]:
    return [error.message for error in validator.iter_errors(manifest)]


def test_schema_is_itself_valid() -> None:
    Draft202012Validator.check_schema(SCHEMA)


def test_example_manifest_validates() -> None:
    assert _errors(EXAMPLE) == []


def test_failed_verification_is_still_a_valid_manifest() -> None:
    """A failing run must still be describable, so the monolith can say why."""

    manifest = copy.deepcopy(EXAMPLE)
    manifest["verification"]["status"] = "fail"
    manifest["verification"]["checks"]["positivity"]["status"] = "fail"

    assert _errors(manifest) == []


@pytest.mark.parametrize(
    "mutate",
    [
        lambda m: m.pop("input_hash"),
        lambda m: m["grid"].update(axis_order="x,y,z"),
        lambda m: m["units"].update(concentration="kg m-3"),
        lambda m: m["artifacts"][0].update(path="../../etc/passwd"),
        lambda m: m["verification"]["checks"].pop("mass_balance"),
        lambda m: m.update(model="cfd"),
        lambda m: m.update(unexpected_field=1),
    ],
    ids=[
        "missing-input-hash",
        "wrong-axis-order",
        "wrong-units",
        "path-escapes-run-dir",
        "missing-mass-balance-check",
        "unknown-model",
        "unknown-field",
    ],
)
def test_contract_violations_are_refused(mutate) -> None:
    manifest = copy.deepcopy(EXAMPLE)
    mutate(manifest)

    assert _errors(manifest) != []


def test_example_grid_and_thresholds_match_the_config() -> None:
    """The fixture is the reference the monolith tests against; keep it honest."""

    config = yaml.safe_load((REPO_ROOT / "config" / "project.yaml").read_text(encoding="utf-8"))

    grid = EXAMPLE["grid"]
    assert grid["dx_m"] == config["grid"]["dx_m"]
    assert grid["dy_m"] == config["grid"]["dy_m"]
    assert grid["dz_m"] == config["grid"]["dz_m"]
    assert grid["nx"] * grid["dx_m"] == config["domain"]["horizontal"]["width_m"]
    assert grid["nz"] * grid["dz_m"] == config["domain"]["vertical"]["max_m"]

    for key, threshold in config["analysis"]["thresholds_ug_m3"].items():
        assert EXAMPLE["thresholds"][key]["value_ug_m3"] == threshold["value"]
