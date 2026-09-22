"""Status-artifact tests for the Week-1 OpenAQ B1.4 task."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "src" / "00_prepare_openaq.py"


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "prepare_openaq_b1_4",
        SCRIPT,
    )

    if spec is None or spec.loader is None:
        raise ImportError(
            f"cannot load {SCRIPT}"
        )

    module = importlib.util.module_from_spec(spec)
    sys.modules["prepare_openaq_b1_4"] = module
    spec.loader.exec_module(module)

    return module


def test_missing_key_writes_explicit_not_run_status(
    tmp_path,
    monkeypatch,
) -> None:
    module = _load_script()

    monkeypatch.delenv(
        "OPENAQ_API_KEY",
        raising=False,
    )

    status_path = (
        tmp_path
        / "openaq_b1_4_status.json"
    )

    exit_code = module.main(
        status_path=status_path,
    )

    assert exit_code == 2
    assert status_path.is_file()

    payload = json.loads(
        status_path.read_text(
            encoding="utf-8"
        )
    )

    assert payload["task"] == "B1.4"
    assert payload["request"] == "GET /v3/locations?iso=VN"
    assert payload["country_iso"] == "VN"
    assert payload["status"] == "NOT_RUN_MISSING_API_KEY"
    assert payload["api_key_stored"] is False
    assert payload["results"] is None
    assert "OPENAQ_API_KEY" in payload["reason"]


def test_success_writes_completed_status_without_storing_key(
    tmp_path,
    monkeypatch,
) -> None:
    module = _load_script()

    monkeypatch.setenv(
        "OPENAQ_API_KEY",
        "secret-test-key",
    )

    fake_results = {
        "vietnam_location_count": 12,
        "vietnam_pm25_location_count": 7,
        "nguyen_hue_pm25_within_25_km": 2,
        "nguyen_hue_reference_monitors_within_25_km": 1,
        "tier3_qualitative_comparison_possible": True,
    }

    monkeypatch.setattr(
        module,
        "_run_inventory",
        lambda: fake_results,
    )

    status_path = (
        tmp_path
        / "openaq_b1_4_status.json"
    )

    exit_code = module.main(
        status_path=status_path,
    )

    assert exit_code == 0

    payload = json.loads(
        status_path.read_text(
            encoding="utf-8"
        )
    )

    assert payload["status"] == "COMPLETED"
    assert payload["reason"] is None
    assert payload["results"] == fake_results
    assert payload["api_key_stored"] is False

    serialized = status_path.read_text(
        encoding="utf-8"
    )

    assert "secret-test-key" not in serialized