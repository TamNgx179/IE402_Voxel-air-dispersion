"""
Scene package: the GIS layers and the voxel lattice, written in the format
the monolith seeds into PostGIS (docs/DATABASE.md, "Scene package").

Every layer comes from the same files the voxeliser read, and the grid cells
come from the voxel NetCDF itself, so the web scene, the database and the
model mask cannot disagree about where a building is (spec BR-32, BR-35).

Output is deterministic: same inputs, same bytes, same checksums. Only
`generated_at` in the manifest changes between runs.
"""

from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import xarray as xr

SCHEMA_VERSION = "1.0"

# Millimetres are far below the 5 m voxel; more digits only churn checksums.
WKT_DECIMALS = 3


@dataclass(frozen=True)
class Grid:
    srid: int
    origin_x_m: float
    origin_y_m: float
    dx_m: float
    dy_m: float
    dz_m: float
    nx: int
    ny: int
    nz: int

    def as_dict(self) -> dict[str, float | int]:
        return {
            "origin_x_m": self.origin_x_m,
            "origin_y_m": self.origin_y_m,
            "dx_m": self.dx_m,
            "dy_m": self.dy_m,
            "dz_m": self.dz_m,
            "nx": self.nx,
            "ny": self.ny,
            "nz": self.nz,
        }


def _spacing(coordinate: np.ndarray, name: str) -> float:
    steps = np.diff(coordinate)
    if steps.size == 0 or not np.allclose(steps, steps[0]) or steps[0] <= 0:
        raise ValueError(f"voxel coordinate '{name}' is not uniform and increasing")
    return float(steps[0])


def grid_from_voxel(voxel: xr.Dataset) -> Grid:
    """Read the lattice from the voxel NetCDF; cell centres become cell edges."""

    crs = str(voxel.attrs.get("model_crs", ""))
    if not crs.upper().startswith("EPSG:"):
        raise ValueError(f"voxel grid has no EPSG model_crs (got '{crs}')")

    x, y, z = (voxel[name].values.astype(float) for name in ("x", "y", "z"))
    dx, dy, dz = _spacing(x, "x"), _spacing(y, "y"), _spacing(z, "z")

    return Grid(
        srid=int(crs.split(":")[1]),
        origin_x_m=round(float(x[0] - dx / 2), WKT_DECIMALS),
        origin_y_m=round(float(y[0] - dy / 2), WKT_DECIMALS),
        dx_m=dx,
        dy_m=dy,
        dz_m=dz,
        nx=x.size,
        ny=y.size,
        nz=z.size,
    )


def grid_cells_frame(voxel: xr.Dataset, grid: Grid) -> pd.DataFrame:
    """One row per voxel column, with the range of solid layers if any."""

    solid = voxel["B"].transpose("z", "y", "x").values.astype(bool)
    has_solid = solid.any(axis=0)
    k = np.arange(grid.nz)[:, None, None]
    first = np.where(solid, k, grid.nz).min(axis=0)
    last = np.where(solid, k, -1).max(axis=0)

    rows = []
    for j in range(grid.ny):
        y0 = grid.origin_y_m + j * grid.dy_m
        y1 = y0 + grid.dy_m
        for i in range(grid.nx):
            x0 = grid.origin_x_m + i * grid.dx_m
            x1 = x0 + grid.dx_m
            wkt = (
                f"POLYGON(({x0:.3f} {y0:.3f},{x1:.3f} {y0:.3f},{x1:.3f} {y1:.3f},"
                f"{x0:.3f} {y1:.3f},{x0:.3f} {y0:.3f}))"
            )
            rows.append(
                {
                    "i": i,
                    "j": j,
                    "solid_from_k": int(first[j, i]) if has_solid[j, i] else None,
                    "solid_to_k": int(last[j, i]) if has_solid[j, i] else None,
                    "wkt": wkt,
                }
            )

    frame = pd.DataFrame(rows)
    for column in ("solid_from_k", "solid_to_k"):
        frame[column] = frame[column].astype("Int64")
    return frame


def _wkt(layer: gpd.GeoDataFrame, srid: int) -> pd.Series:
    return layer.to_crs(epsg=srid).geometry.to_wkt(rounding_precision=WKT_DECIMALS)


def buildings_frame(buildings: gpd.GeoDataFrame, srid: int) -> pd.DataFrame:
    frame = pd.DataFrame(
        {
            "source_feature_id": buildings["osm_type"].astype(str) + "/" + buildings["osm_id"].astype(str),
            "height_m": buildings["resolved_height_m"].astype(float).round(2),
            "height_source": buildings["height_source"].astype(str),
            "wkt": _wkt(buildings, srid).values,
        }
    )
    if frame["height_m"].isna().any():
        raise ValueError("a building without height reached the scene package (spec BR-13)")
    return frame.sort_values("source_feature_id").reset_index(drop=True)


def roads_frame(roads: gpd.GeoDataFrame, srid: int) -> pd.DataFrame:
    ids = roads["osm_u"].astype(str) + "-" + roads["osm_v"].astype(str)
    # Parallel edges between the same two nodes keep distinct ids.
    ids = ids + ids.groupby(ids).cumcount().map(lambda n: "" if n == 0 else f"#{n}")

    frame = pd.DataFrame(
        {
            "source_feature_id": ids.values,
            "road_class": roads["highway"].astype(str).values,
            "emission_weight": roads["road_class_weight"].astype(float).values,
            "wkt": _wkt(roads, srid).values,
        }
    )
    return frame.sort_values("source_feature_id").reset_index(drop=True)


def landcover_frame(layer: gpd.GeoDataFrame, srid: int) -> pd.DataFrame:
    if layer.empty:
        return pd.DataFrame(columns=["source_feature_id", "kind", "wkt"])
    frame = pd.DataFrame(
        {
            "source_feature_id": layer["source_feature_id"].astype(str).values,
            "kind": layer["kind"].astype(str).values,
            "wkt": _wkt(layer, srid).values,
        }
    )
    return frame.sort_values("source_feature_id").reset_index(drop=True)


def _write_csv(frame: pd.DataFrame, path: Path) -> str:
    frame.to_csv(path, index=False, lineterminator="\n", quoting=csv.QUOTE_MINIMAL, encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _retrieved(path: Path) -> str:
    return date.fromtimestamp(path.stat().st_mtime).isoformat()


def write_scene_package(
    out_dir: Path,
    *,
    study_area: gpd.GeoDataFrame,
    buildings: gpd.GeoDataFrame,
    roads: gpd.GeoDataFrame,
    water: gpd.GeoDataFrame,
    green: gpd.GeoDataFrame,
    voxel: xr.Dataset,
    sources: dict[str, Path],
) -> dict:
    """Write every CSV and the manifest; return the manifest."""

    grid = grid_from_voxel(voxel)
    out_dir.mkdir(parents=True, exist_ok=True)

    tables = {
        "buildings.csv": buildings_frame(buildings, grid.srid),
        "roads.csv": roads_frame(roads, grid.srid),
        "water.csv": landcover_frame(water, grid.srid),
        "green.csv": landcover_frame(green, grid.srid),
        "grid_cells.csv": grid_cells_frame(voxel, grid),
    }
    checksums = {name: _write_csv(frame, out_dir / name) for name, frame in tables.items()}

    area = study_area.to_crs(epsg=grid.srid)
    name = str(area["candidate"].iloc[0]) if "candidate" in area else "study_area"

    manifest = {
        "schema_version": SCHEMA_VERSION,
        "study_area": {
            "name": name,
            "srid": grid.srid,
            "wkt": area.geometry.to_wkt(rounding_precision=WKT_DECIMALS).iloc[0],
        },
        "grid": grid.as_dict(),
        "counts": {
            "buildings": len(tables["buildings.csv"]),
            "roads": len(tables["roads.csv"]),
            "water": len(tables["water.csv"]),
            "green": len(tables["green.csv"]),
            "grid_cells": len(tables["grid_cells.csv"]),
        },
        "files": checksums,
        "provenance": {
            "buildings": {
                "footprint": "OpenStreetMap contributors",
                "height": "Google Open Buildings 2.5D Temporal",
                "license": "ODbL 1.0 (footprints); CC BY 4.0 (heights)",
                "retrieved": _retrieved(sources["buildings"]),
            },
            "roads": {"source": "OpenStreetMap contributors", "license": "ODbL 1.0", "retrieved": _retrieved(sources["roads"])},
            "water": {"source": "OpenStreetMap contributors", "license": "ODbL 1.0", "retrieved": _retrieved(sources["water"])},
            "green": {"source": "OpenStreetMap contributors", "license": "ODbL 1.0", "retrieved": _retrieved(sources["green"])},
            "grid_cells": {"source": "voxel grid NetCDF (src/01_voxelize.py)", "retrieved": _retrieved(sources["voxel"])},
        },
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }

    (out_dir / "scene_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    return manifest
