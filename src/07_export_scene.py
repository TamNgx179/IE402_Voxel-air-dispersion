"""
Write the scene package that the monolith seeds into PostGIS.

    python src/07_export_scene.py

Run after 00_prepare_osm_data.py, 00_prepare_landcover.py, the emission
steps and 01_voxelize.py. Output: paths.scene_package_dir (committed).
"""

from __future__ import annotations

import argparse
import logging

import geopandas as gpd
import xarray as xr

from project_config import load_project_config, resolve_repo_path
from scene.export import write_scene_package

LOGGER = logging.getLogger("export_scene")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scene package for the PostGIS seed")
    parser.add_argument("--config", default="config/project.yaml")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")

    config = load_project_config(args.config)
    sources = {
        "study_area": resolve_repo_path(config, "paths.study_area"),
        "buildings": resolve_repo_path(config, "paths.processed_buildings"),
        "roads": resolve_repo_path(config, "paths.road_emissions"),
        "water": resolve_repo_path(config, "paths.water"),
        "green": resolve_repo_path(config, "paths.green"),
        "voxel": resolve_repo_path(config, "paths.voxel_netcdf"),
    }

    missing = [str(path) for path in sources.values() if not path.exists()]
    if missing:
        raise SystemExit("Missing inputs; run the earlier pipeline steps first:\n" + "\n".join(missing))

    out_dir = resolve_repo_path(config, "paths.scene_package_dir")

    with xr.open_dataset(sources["voxel"]) as voxel:
        manifest = write_scene_package(
            out_dir,
            study_area=gpd.read_file(sources["study_area"]),
            buildings=gpd.read_file(sources["buildings"]),
            roads=gpd.read_file(sources["roads"]),
            water=gpd.read_file(sources["water"]),
            green=gpd.read_file(sources["green"]),
            voxel=voxel.load(),
            sources=sources,
        )

    LOGGER.info("scene package -> %s %s", out_dir, manifest["counts"])


if __name__ == "__main__":
    main()
