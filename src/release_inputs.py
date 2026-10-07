"""Rebuild release voxel/emission inputs from the frozen scene package.

The committed scene package is the reproducibility boundary shared by the
database, web and solver.  This module deliberately does not fetch current OSM
or building-height data: doing so would silently change the geometry visible
in the product.  It rebuilds ``voxel_grid.nc`` and the dimensionless A3.3 road
source; ``python -m src.edgar_normalizer`` then applies the official EDGAR
absolute total.
"""

from __future__ import annotations

import argparse
from collections import Counter
import csv
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr
import yaml
import geopandas as gpd
import pandas as pd
from shapely import wkt
from shapely.geometry import box


REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ReleaseInputDiagnostics:
    road_features: int
    source_cells: int
    proxy_total: float
    proxy_retained: float
    proxy_rejected_by_solids: float
    solid_voxels: int


def _path(raw: str) -> Path:
    candidate = Path(raw)
    return candidate.resolve() if candidate.is_absolute() else (REPO_ROOT / candidate).resolve()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_scene(scene_dir: Path) -> tuple[dict[str, Any], list[dict[str, str]], list[dict[str, str]]]:
    manifest_path = scene_dir / "scene_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for name, expected in manifest.get("files", {}).items():
        path = scene_dir / name
        if not path.is_file():
            raise FileNotFoundError(f"scene package is missing {path}")
        actual = _sha256(path)
        if actual != expected:
            raise ValueError(f"scene checksum mismatch for {name}: {actual} != {expected}")
    with (scene_dir / "grid_cells.csv").open(encoding="utf-8", newline="") as handle:
        cells = list(csv.DictReader(handle))
    with (scene_dir / "roads.csv").open(encoding="utf-8", newline="") as handle:
        roads = list(csv.DictReader(handle))
    return manifest, cells, roads


def build_release_datasets(
    scene_dir: str | Path,
    *,
    emission_factor_g_per_vehicle_km: float,
) -> tuple[xr.Dataset, xr.Dataset, ReleaseInputDiagnostics]:
    """Build the exact grid mask and road-source allocation represented by a scene package."""

    scene_dir = Path(scene_dir).resolve()
    manifest, cells, roads = _load_scene(scene_dir)
    with (scene_dir / "buildings.csv").open(encoding="utf-8", newline="") as handle:
        buildings = list(csv.DictReader(handle))
    height_source_counts = Counter(row["height_source"] for row in buildings)
    grid = manifest["grid"]
    nx, ny, nz = (int(grid[name]) for name in ("nx", "ny", "nz"))
    dx, dy, dz = (float(grid[name]) for name in ("dx_m", "dy_m", "dz_m"))
    x0, y0 = float(grid["origin_x_m"]), float(grid["origin_y_m"])
    crs = f"EPSG:{int(manifest['study_area']['srid'])}"
    x = x0 + (np.arange(nx) + 0.5) * dx
    y = y0 + (np.arange(ny) + 0.5) * dy
    z = (np.arange(nz) + 0.5) * dz

    solid = np.zeros((nz, ny, nx), dtype=bool)
    height = np.zeros((ny, nx), dtype=np.float32)
    if len(cells) != nx * ny:
        raise ValueError(f"grid_cells.csv has {len(cells)} rows, expected {nx * ny}")
    for row in cells:
        i, j = int(row["i"]), int(row["j"])
        if not (0 <= i < nx and 0 <= j < ny):
            raise ValueError(f"grid cell ({i},{j}) is outside the manifest grid")
        lower, upper = row.get("solid_from_k", ""), row.get("solid_to_k", "")
        if lower == "" and upper == "":
            continue
        if lower == "" or upper == "":
            raise ValueError(f"grid cell ({i},{j}) has an incomplete solid interval")
        k0, k1 = int(lower), int(upper)
        if not (0 <= k0 <= k1 < nz):
            raise ValueError(f"grid cell ({i},{j}) has invalid solid interval {k0}:{k1}")
        solid[k0 : k1 + 1, j, i] = True
        height[j, i] = (k1 + 1) * dz

    # Weighted centreline length is the relative traffic proxy.  The emission
    # factor is common to every road, so it cancels during normalisation.
    proxy = np.zeros((ny, nx), dtype=np.float64)
    total = 0.0
    intersecting = 0
    for row in roads:
        line = wkt.loads(row["wkt"])
        weight = float(row["emission_weight"])
        if line.is_empty or not line.is_valid or weight <= 0.0:
            raise ValueError(f"invalid road feature {row.get('source_feature_id')}")
        total += line.length * weight
        minx, miny, maxx, maxy = line.bounds
        imin = max(0, int(np.floor((minx - x0) / dx)))
        imax = min(nx - 1, int(np.floor((maxx - x0) / dx)))
        jmin = max(0, int(np.floor((miny - y0) / dy)))
        jmax = min(ny - 1, int(np.floor((maxy - y0) / dy)))
        if imin > imax or jmin > jmax:
            continue
        inside_length = 0.0
        for j in range(jmin, jmax + 1):
            for i in range(imin, imax + 1):
                length = line.intersection(box(x0 + i * dx, y0 + j * dy, x0 + (i + 1) * dx, y0 + (j + 1) * dy)).length
                if length > 0.0:
                    proxy[j, i] += length * weight
                    inside_length += length
        if inside_length > 0.0:
            intersecting += 1

    source_k = int(np.argmin(np.abs(z - 1.0)))
    rejected_length = float(proxy[solid[source_k]].sum())
    proxy = np.where(solid[source_k], 0.0, proxy)
    retained_length = float(proxy.sum())
    if retained_length <= 0.0:
        raise ValueError("scene roads leave no emission proxy in air voxels")
    relative = np.zeros((nz, ny, nx), dtype=np.float64)
    relative[source_k] = proxy / retained_length
    factor = emission_factor_g_per_vehicle_km / 1000.0
    proxy_total = total * factor
    proxy_retained = retained_length * factor
    proxy_rejected = rejected_length * factor
    # Store float32, then correct its final positive cell so the persisted sum
    # remains as close to one as the A3.3 contract permits.
    relative32 = relative.astype(np.float32)
    positive = np.flatnonzero(relative32 > 0)
    relative32.reshape(-1)[positive[-1]] += np.float32(1.0 - float(relative32.sum(dtype=np.float64)))

    coords = {
        "z": ("z", z, {"units": "m", "positive": "up"}),
        "y": ("y", y, {"units": "m", "standard_name": "projection_y_coordinate"}),
        "x": ("x", x, {"units": "m", "standard_name": "projection_x_coordinate"}),
    }
    common_attrs = {
        "Conventions": "CF-1.10",
        "grid_order": "z,y,x",
        "model_crs": crs,
        "scene_manifest_sha256": _sha256(scene_dir / "scene_manifest.json"),
        "scene_package": str(scene_dir),
    }
    voxel = xr.Dataset(
        {
            "B": (("z", "y", "x"), solid, {"long_name": "solid building voxel"}),
            "H": (("y", "x"), height, {"units": "m", "long_name": "rasterized building height"}),
        },
        coords=coords,
        attrs={
            **common_attrs,
            "solid_voxel_count": int(solid.sum()),
            "height_source_counts_json": json.dumps(
                dict(sorted(height_source_counts.items())), ensure_ascii=False
            ),
        },
    )
    source = xr.Dataset(
        {
            "S": (("z", "y", "x"), relative32, {"units": "1", "transport_ready": "false"}),
            "S_proxy": (("z", "y", "x"), relative.astype(np.float32), {"units": "1"}),
        },
        coords=coords,
        attrs={
            **common_attrs,
            "stage": "A3.3-release",
            "proxy_basis": "scene road centreline length times emission_weight",
            "proxy_total": proxy_total,
            "proxy_retained": proxy_retained,
            "proxy_rejected_by_solids": proxy_rejected,
            "proxy_rejected_fraction_of_inside": proxy_rejected / (proxy_retained + proxy_rejected),
            "road_edges_intersecting_domain": intersecting,
            "road_edges_total": len(roads),
            "source_z_index": source_k,
            "source_z_m": float(z[source_k]),
        },
    )
    diagnostics = ReleaseInputDiagnostics(
        road_features=len(roads),
        source_cells=int(np.count_nonzero(relative32)),
        proxy_total=proxy_total,
        proxy_retained=proxy_retained,
        proxy_rejected_by_solids=proxy_rejected,
        solid_voxels=int(solid.sum()),
    )
    return voxel, source, diagnostics


def _write_netcdf(dataset: xr.Dataset, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    encoding = {name: {"zlib": True, "complevel": 4, "shuffle": True} for name in dataset.data_vars}
    dataset.to_netcdf(temporary, engine="netcdf4", encoding=encoding)
    temporary.replace(path)


def run(config_path: str | Path) -> tuple[Path, Path, ReleaseInputDiagnostics]:
    config = yaml.safe_load(Path(config_path).read_text(encoding="utf-8"))
    scene = _path(str(config["paths"]["scene_package_dir"]))
    voxel_path = _path(str(config["paths"]["voxel_netcdf"]))
    source_path = _path(str(config["paths"]["emission_source_netcdf"]))
    emission_factor = float(config["emissions"]["emission_factor"]["value_g_per_vehicle_km"])
    voxel, source, diagnostics = build_release_datasets(
        scene,
        emission_factor_g_per_vehicle_km=emission_factor,
    )
    _write_netcdf(voxel, voxel_path)
    _write_netcdf(source, source_path)
    # Recreate the A3.2 audit layer consumed by the generated assumptions
    # report.  The geometry remains the checksum-locked scene geometry.
    with (scene / "roads.csv").open(encoding="utf-8", newline="") as handle:
        road_rows = list(csv.DictReader(handle))
    road_frame = pd.DataFrame({
        "source_feature_id": [row["source_feature_id"] for row in road_rows],
        "highway": [row["road_class"] for row in road_rows],
        "class_weight": [float(row["emission_weight"]) for row in road_rows],
        "geometry": [wkt.loads(row["wkt"]) for row in road_rows],
    })
    road_frame["length_m"] = road_frame["geometry"].map(lambda geometry: geometry.length)
    road_frame["emission_proxy"] = (
        road_frame["length_m"] / 1000.0 * road_frame["class_weight"] * emission_factor
    )
    road_frame["emission_share"] = road_frame["emission_proxy"] / road_frame["emission_proxy"].sum()
    roads_path = _path(str(config["paths"]["road_emissions"]))
    roads_path.parent.mkdir(parents=True, exist_ok=True)
    gpd.GeoDataFrame(road_frame, geometry="geometry", crs=voxel.attrs["model_crs"]).to_file(
        roads_path, driver="GeoJSON"
    )
    return voxel_path, source_path, diagnostics


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild B2.1 inputs from the frozen scene package")
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    voxel, source, d = run(args.config)
    print(json.dumps({"voxel": str(voxel), "relative_source": str(source), **d.__dict__}, indent=2))


if __name__ == "__main__":
    main()
