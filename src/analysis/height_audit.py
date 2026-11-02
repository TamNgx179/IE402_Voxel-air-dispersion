"""Quantify building-height conflicts and top clearance; never alter the scene.

Run: python -m src.analysis.height_audit --out artifacts/height-audit
This is a geometry audit, not a solver sensitivity experiment or validation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path

import yaml


def positive_number(value):
    """Only accept explicit positive metre values; do not guess units/tags."""
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        match = re.fullmatch(r"\s*([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:m)?\s*", value)
        if match is None:
            return None
        value = match.group(1)
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def audit(features, *, top_m, dz_m):
    if not math.isfinite(top_m) or not math.isfinite(dz_m) or top_m <= 0 or dz_m <= 0:
        raise ValueError("top_m and dz_m must be positive finite numbers")
    rows = []
    for feature in features:
        p = feature["properties"]
        height = positive_number(p.get("resolved_height_m"))
        if height is None:
            raise ValueError("missing or invalid resolved_height_m")
        osm = positive_number(p.get("osm_height_raw"))
        rows.append({
            "feature_id": f"{p.get('osm_type', 'unknown')}/{p.get('osm_id', 'unknown')}",
            "height_source": p.get("height_source", "unknown"),
            "resolved_height_m": height,
            "top_clearance_m": top_m - height,
            "clearance_in_layers": (top_m - height) / dz_m,
            "resolved_reaches_or_exceeds_top": height >= top_m,
            "below_first_voxel_center": height < dz_m / 2,
            "osm_height_raw": p.get("osm_height_raw"),
            "osm_height_m": osm,
            "osm_minus_resolved_m": None if osm is None else osm - height,
            "osm_reaches_or_exceeds_top": None if osm is None else osm >= top_m,
        })
    if not rows:
        raise ValueError("no buildings to audit")
    return {
        "schema_version": 1,
        "scope": "geometry_only_not_physics_sensitivity",
        "assumptions": {"vertical_origin_m": 0, "domain_top_m": top_m, "dz_m": dz_m,
                        "osm_is_ground_truth": False},
        "summary": {
            "buildings": len(rows),
            "height_sources": dict(Counter(r["height_source"] for r in rows)),
            "minimum_top_clearance_m": min(r["top_clearance_m"] for r in rows),
            "resolved_reaches_or_exceeds_top": sum(r["resolved_reaches_or_exceeds_top"] for r in rows),
            "below_first_voxel_center": sum(r["below_first_voxel_center"] for r in rows),
            "numeric_osm_heights": sum(r["osm_height_m"] is not None for r in rows),
            "unparsed_osm_heights": sum(r["osm_height_raw"] not in (None, "") and r["osm_height_m"] is None for r in rows),
            "osm_reaches_or_exceeds_top": sum(r["osm_reaches_or_exceeds_top"] is True for r in rows),
        },
        "buildings": sorted(rows, key=lambda r: r["top_clearance_m"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config/project.yaml"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    if config["domain"]["vertical"]["min_m"] != 0:
        raise ValueError("audit currently requires vertical min_m = 0")
    source = Path(config["paths"]["processed_buildings"])
    report = audit(json.loads(source.read_text(encoding="utf-8"))["features"],
                   top_m=float(config["domain"]["vertical"]["max_m"]),
                   dz_m=float(config["grid"]["dz_m"]))
    report["inputs"] = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in (args.config, source)}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "height-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
