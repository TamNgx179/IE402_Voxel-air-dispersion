"""
Tier 3 driver: build the baseline scenarios and turn any contract file into a
spatial-analysis report.

Everything read from the config; nothing about the grid or the thresholds is
hard-coded here (BR-9).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr

from project_config import REPO_ROOT, get_required, resolve_repo_path

from analysis import operators as ops
from analysis.baseline import gaussian_road_baseline
from analysis.morphology import street_canyon_samples, summarise_canyons
from analysis.fields import ConcentrationField, load_field, write_field


def _repo_path(pattern: str, scenario: str) -> Path:
    return (REPO_ROOT / pattern.format(scenario=scenario)).resolve()


def concentration_path(config: dict[str, Any], scenario: str) -> Path:
    return _repo_path(get_required(config, "analysis.concentration_pattern"), scenario)


def report_path(config: dict[str, Any], scenario: str) -> Path:
    return _repo_path(get_required(config, "analysis.report_pattern"), scenario)


def thresholds(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        key: {"value": float(item["value"]), "label": str(item["label"])}
        for key, item in get_required(config, "analysis.thresholds_ug_m3").items()
    }


def empty_grid(config: dict[str, Any]) -> ConcentrationField:
    """The voxel grid with no concentration yet - the geometry every run shares."""

    voxel_path = resolve_repo_path(config, "paths.voxel_netcdf")

    with xr.open_dataset(voxel_path) as voxel:
        return ConcentrationField(
            concentration=np.zeros(voxel["B"].shape),
            solid=voxel["B"].values.astype(bool),
            z=voxel["z"].values.astype(float),
            y=voxel["y"].values.astype(float),
            x=voxel["x"].values.astype(float),
            crs=str(voxel.attrs["model_crs"]),
        )


def run_gaussian_baselines(config: dict[str, Any]) -> list[Path]:
    """Write concentration_<scenario>_gaussian.nc for every configured scenario."""

    settings = get_required(config, "analysis.gaussian_baseline")
    source = (REPO_ROOT / settings["source_netcdf"]).resolve()

    if not source.exists():
        raise FileNotFoundError(
            f"{source} not found: run the emission pipeline through A3.4 "
            "(src/edgar_normalizer.py) first"
        )

    written = []

    for name in settings["scenarios"]:
        wind = get_required(config, f"meteorology.scenarios.{name}")
        grid = empty_grid(config)
        started = time.perf_counter()

        grid.concentration = gaussian_road_baseline(
            str(source),
            grid,
            wind_from_deg=float(wind["direction_from_deg"]),
            wind_speed_m_s=float(wind["speed_m_s"]),
            reference_height_m=float(settings["reference_height_m"]),
            stability=str(settings["stability"]),
        )
        grid.attrs = {
            "scenario": f"{name}_gaussian",
            "model": "gaussian",
            "model_description": (
                "Briggs-urban Gaussian plumes superposed over every road-source voxel; "
                "plumes ignore buildings, building voxels blanked afterwards"
            ),
            "wind_from_deg": float(wind["direction_from_deg"]),
            "wind_speed_m_s": float(wind["speed_m_s"]),
            "wind_reference_height_m": float(settings["reference_height_m"]),
            "stability": str(settings["stability"]),
            "emission_source": str(source.relative_to(REPO_ROOT)),
            "emission_normalisation": "EDGAR v8.1 TRO 2022 area-weighted (A3.4)",
            "wall_clock_s": round(time.perf_counter() - started, 2),
        }

        written.append(write_field(grid, concentration_path(config, grid.scenario)))

    return written


def _profile_record(field_: ConcentrationField, x_m: float, y_m: float, label: str) -> dict[str, Any]:
    column = ops.vertical_profile(field_.concentration, field_.x, field_.y, x_m, y_m, field_.solid)
    return {
        "label": label,
        "x_m": float(x_m),
        "y_m": float(y_m),
        "z_m": field_.z.tolist(),
        "c_ug_m3": [None if np.isnan(value) else float(value) for value in column],
    }


def analyse(field_: ConcentrationField, config: dict[str, Any]) -> dict[str, Any]:
    """Every docs/RESEARCH.md §13.3 product this tier computes, as plain numbers."""

    dz, dy, dx = field_.spacing
    c = field_.concentration
    limits = thresholds(config)

    finite = np.where(np.isnan(c), -np.inf, c)
    k, j, i = np.unravel_index(int(np.argmax(finite)), c.shape)

    slices = {}
    for height, plane in ops.horizontal_slices(
        c, field_.z, get_required(config, "analysis.slice_heights_m"), field_.solid
    ).items():
        slices[f"{height:g}"] = {
            "mean_ug_m3": float(np.nanmean(plane)),
            "max_ug_m3": float(np.nanmax(plane)),
            "exceedance_area_m2": {
                key: float(np.nansum(plane > item["value"]) * dx * dy) for key, item in limits.items()
            },
        }

    facade = ops.facade_exposure_by_floor(
        c, field_.solid, field_.z, float(get_required(config, "analysis.floor_height_m"))
    )

    centre_x = float(field_.x[field_.x.size // 2])
    centre_y = float(field_.y[field_.y.size // 2])

    return {
        "scenario": field_.scenario,
        "model": str(field_.attrs.get("model")),
        "wind_from_deg": float(field_.attrs["wind_from_deg"]),
        "wind_speed_m_s": float(field_.attrs["wind_speed_m_s"]),
        "units": "ug m-3",
        "grid": {"nz": int(c.shape[0]), "ny": int(c.shape[1]), "nx": int(c.shape[2]), "dz_m": dz, "dy_m": dy, "dx_m": dx},
        "air_voxels": int((~field_.solid).sum()),
        "domain_mean_ug_m3": float(np.nanmean(c)),
        "maximum": {
            "c_ug_m3": float(c[k, j, i]),
            "z_m": float(field_.z[k]),
            "y_m": float(field_.y[j]),
            "x_m": float(field_.x[i]),
        },
        "layer_mean_ug_m3": [None if np.isnan(v) else float(v) for v in ops.layer_means(c, field_.solid)],
        "thresholds": limits,
        "exceedance_volume_m3": {
            key: ops.exceedance_volume(c, field_.solid, item["value"], dx, dy, dz) for key, item in limits.items()
        },
        "exceedance_volume_by_layer_m3": {
            key: ops.exceedance_volume_by_layer(c, field_.solid, item["value"], dx, dy, dz).tolist()
            for key, item in limits.items()
        },
        "slices": slices,
        "facade_by_floor": {
            "floor_height_m": float(get_required(config, "analysis.floor_height_m")),
            "floor": facade.floor.tolist(),
            "cells": facade.cells.tolist(),
            "mean_ug_m3": facade.mean.tolist(),
            "max_ug_m3": facade.maximum.tolist(),
        },
        "profiles": [
            _profile_record(field_, centre_x, centre_y, "tâm miền"),
            _profile_record(field_, float(field_.x[i]), float(field_.y[j]), "ô có nồng độ cực đại"),
        ],
    }


def write_report(report: dict[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def load_scenario(config: dict[str, Any], scenario: str) -> ConcentrationField:
    return load_field(concentration_path(config, scenario), resolve_repo_path(config, "paths.voxel_netcdf"))


def street_canyons(config: dict[str, Any]) -> tuple[dict[str, Any], Path]:
    """G5: H/W of the study area's street canyons, from voxel_grid.nc and the roads."""

    from emission.roads import load_roads

    with xr.open_dataset(resolve_repo_path(config, "paths.voxel_netcdf")) as voxel:
        height = voxel["H"].values.astype(float)
        x, y = voxel["x"].values.astype(float), voxel["y"].values.astype(float)
        crs = str(voxel.attrs["model_crs"])

    roads = load_roads(resolve_repo_path(config, "paths.roads")).to_crs(crs)
    lines = [geom for geom in roads.geometry]
    names = [None if not isinstance(n, str) else n for n in roads.get("name", [None] * len(roads))]

    summary = summarise_canyons(street_canyon_samples(height, x, y, lines), names)
    summary["method"] = (
        "perpendicular transects every 5 m along each OSM centreline; first building cell of H[y,x] "
        "on each side within 60 m; H = mean of the two heights, W = facade-to-facade distance; "
        "one-sided samples are 'open'"
    )

    path = (REPO_ROOT / "output" / "analysis" / "street_canyon_hw.json").resolve()
    return summary, write_report(summary, path)
