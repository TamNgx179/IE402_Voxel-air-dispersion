"""Scene package (docs/DATABASE.md, "Scene package"): format, lattice, determinism."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import xarray as xr
from shapely.geometry import LineString, box

from src.scene.export import grid_cells_frame, grid_from_voxel, write_scene_package

SRID = 32648
X0, Y0 = 686000.0, 1191000.0  # west / south edges


def _voxel(nx=4, ny=3, nz=5) -> xr.Dataset:
    solid = np.zeros((nz, ny, nx), dtype=bool)
    solid[0:3, 1, 2] = True  # one building column, layers 0..2
    return xr.Dataset(
        {"B": (("z", "y", "x"), solid)},
        coords={
            "x": X0 + 2.5 + 5.0 * np.arange(nx),
            "y": Y0 + 2.5 + 5.0 * np.arange(ny),
            "z": 1.0 + 2.0 * np.arange(nz),
        },
        attrs={"model_crs": f"EPSG:{SRID}"},
    )


def _layers():
    utm = f"EPSG:{SRID}"
    study = gpd.GeoDataFrame({"candidate": ["Test"]}, geometry=[box(X0, Y0, X0 + 20, Y0 + 15)], crs=utm)
    buildings = gpd.GeoDataFrame(
        {"osm_type": ["way"], "osm_id": [7], "resolved_height_m": [6.0], "height_source": ["gob:building_height"]},
        geometry=[box(X0 + 10, Y0 + 5, X0 + 15, Y0 + 10)],
        crs=utm,
    )
    roads = gpd.GeoDataFrame(
        {"osm_u": [1, 1], "osm_v": [2, 2], "highway": ["primary", "primary"], "road_class_weight": [1.0, 1.0]},
        geometry=[LineString([(X0, Y0), (X0 + 20, Y0)]), LineString([(X0, Y0 + 1), (X0 + 20, Y0 + 1)])],
        crs=utm,
    )
    green = gpd.GeoDataFrame({"source_feature_id": ["way/9"], "kind": ["park"]}, geometry=[box(X0, Y0, X0 + 5, Y0 + 5)], crs=utm)
    water = gpd.GeoDataFrame({"source_feature_id": [], "kind": []}, geometry=[], crs=utm)
    return study, buildings, roads, water, green


def _write(out: Path, tmp_path: Path) -> dict:
    sources = {}
    for name in ("buildings", "roads", "water", "green", "voxel"):
        path = tmp_path / f"{name}.src"
        path.write_text("x")
        sources[name] = path
    study, buildings, roads, water, green = _layers()
    return write_scene_package(
        out, study_area=study, buildings=buildings, roads=roads, water=water, green=green,
        voxel=_voxel(), sources=sources,
    )


def test_grid_edges_come_from_the_voxel_cell_centres() -> None:
    grid = grid_from_voxel(_voxel())

    assert (grid.srid, grid.origin_x_m, grid.origin_y_m) == (SRID, X0, Y0)
    assert (grid.dx_m, grid.dy_m, grid.dz_m, grid.nx, grid.ny, grid.nz) == (5.0, 5.0, 2.0, 4, 3, 5)


def test_grid_cells_record_the_solid_layer_range() -> None:
    voxel = _voxel()
    cells = grid_cells_frame(voxel, grid_from_voxel(voxel)).set_index(["i", "j"])

    assert len(cells) == 12
    assert (cells.loc[(2, 1), "solid_from_k"], cells.loc[(2, 1), "solid_to_k"]) == (0, 2)
    assert cells["solid_from_k"].isna().sum() == 11
    assert cells.loc[(0, 0), "wkt"].startswith(f"POLYGON(({X0:.3f} {Y0:.3f},")


def test_non_uniform_lattice_is_refused() -> None:
    voxel = _voxel().assign_coords(x=[0.0, 5.0, 11.0, 15.0])

    with pytest.raises(ValueError, match="not uniform"):
        grid_from_voxel(voxel)


def test_package_matches_the_contract(tmp_path: Path) -> None:
    out = tmp_path / "scene"
    manifest = _write(out, tmp_path)

    assert manifest["counts"] == {"buildings": 1, "roads": 2, "water": 0, "green": 1, "grid_cells": 12}
    assert manifest["study_area"]["srid"] == SRID

    for name, digest in manifest["files"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest

    assert list(pd.read_csv(out / "buildings.csv").columns) == ["source_feature_id", "height_m", "height_source", "wkt"]
    assert list(pd.read_csv(out / "water.csv").columns) == ["source_feature_id", "kind", "wkt"]
    assert sorted(pd.read_csv(out / "roads.csv")["source_feature_id"]) == ["1-2", "1-2#1"]

    on_disk = json.loads((out / "scene_manifest.json").read_text(encoding="utf-8"))
    assert on_disk["files"] == manifest["files"]


def test_package_is_byte_identical_when_rerun(tmp_path: Path) -> None:
    first = _write(tmp_path / "a", tmp_path)
    second = _write(tmp_path / "b", tmp_path)

    assert first["files"] == second["files"]


def test_building_without_height_is_refused(tmp_path: Path) -> None:
    study, buildings, roads, water, green = _layers()
    buildings["resolved_height_m"] = [np.nan]
    sources = {name: tmp_path for name in ("buildings", "roads", "water", "green", "voxel")}

    with pytest.raises(ValueError, match="BR-13"):
        write_scene_package(
            tmp_path / "scene", study_area=study, buildings=buildings, roads=roads,
            water=water, green=green, voxel=_voxel(), sources=sources,
        )


COMMITTED = Path(__file__).resolve().parents[1] / "db" / "seeds" / "scene"


@pytest.mark.skipif(not (COMMITTED / "scene_manifest.json").exists(), reason="no committed scene package")
def test_committed_package_checksums_are_intact() -> None:
    """The seed refuses a tampered package; catch it here first."""

    manifest = json.loads((COMMITTED / "scene_manifest.json").read_text(encoding="utf-8"))
    for name, digest in manifest["files"].items():
        assert hashlib.sha256((COMMITTED / name).read_bytes()).hexdigest() == digest, name
