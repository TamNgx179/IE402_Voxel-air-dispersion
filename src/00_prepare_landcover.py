"""
Download the water and green layers for the study area chosen by
00_prepare_osm_data.py. Scene-only: the model never reads them.

    python src/00_prepare_landcover.py
"""

from __future__ import annotations

import argparse
import logging

import geopandas as gpd

from project_config import load_project_config, resolve_repo_path
from scene.landcover import GREEN_TAGS, WATER_TAGS, download_features, prepare_layer

LOGGER = logging.getLogger("prepare_landcover")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OSM water and green layers for the 3D scene")
    parser.add_argument("--config", default="config/project.yaml")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")

    config = load_project_config(args.config)
    study_area = gpd.read_file(resolve_repo_path(config, "paths.study_area"))

    for name, tags, key in (("water", WATER_TAGS, "paths.water"), ("green", GREEN_TAGS, "paths.green")):
        layer = prepare_layer(download_features(study_area, tags), study_area, tags)
        path = resolve_repo_path(config, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        layer.to_file(path, driver="GeoJSON")

        kinds = layer["kind"].value_counts().to_dict() if not layer.empty else {}
        LOGGER.info("%s: %d features %s -> %s", name, len(layer), kinds, path)


if __name__ == "__main__":
    main()
