"""Week-3 traffic-emission preparation.

A3.1
    Read ``roads.geojson`` and summarise road length by OSM ``highway`` class.

A3.2
    Build a per-edge *relative emission allocation* from configured road-class
    weights and the configured motorcycle running emission factor.

Important: A3.2 is not yet an absolute g/s inventory because no measured
traffic count is available. A3.4 later normalises ``emission_share`` to the
EDGAR total. Scientific/model values and output paths are required from YAML;
this module provides no silent model-parameter fallbacks.
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd

from project_config import ConfigError, get_required, load_project_config, resolve_repo_path

LOGGER = logging.getLogger("emissions")
METRES_PER_KILOMETRE = 1000.0  # exact unit conversion, not a model parameter


class EmissionInputError(ValueError):
    """Raised when road/emission input is invalid."""


def build_source_term(shape: tuple[int, int, int], sources: list[dict]) -> np.ndarray:
    """Return ``S[z,y,x]`` from explicit voxel-source records.

    Kept for compatibility with existing transport tests/notebooks. A3.3 will
    replace manual records with rasterised road sources.
    """
    source = np.zeros(shape, dtype=float)

    for item in sources:
        z, y, x = (int(v) for v in item["index"])
        source[z, y, x] += float(item["rate"])

    return source


def load_roads(roads_path: str | Path) -> gpd.GeoDataFrame:
    """Read and validate the prepared road network."""
    path = Path(roads_path).expanduser().resolve()

    if not path.exists():
        raise FileNotFoundError(
            "Road network not found. Run src/00_prepare_osm_data.py first: "
            f"{path}"
        )

    roads = gpd.read_file(path)

    if roads.empty:
        raise EmissionInputError(
            f"Road network is empty: {path}"
        )

    required = {
        "highway",
        "length_m",
        "geometry",
    }

    missing = required.difference(
        roads.columns
    )

    if missing:
        raise EmissionInputError(
            "Road network is missing required columns: "
            + ", ".join(
                sorted(missing)
            )
        )

    highway = (
        roads["highway"]
        .astype("string")
        .str.strip()
    )

    invalid_highway = (
        highway.isna()
        | (highway == "")
    )

    if invalid_highway.any():
        raise EmissionInputError(
            "Every road edge must have a non-empty OSM highway class; "
            f"found {int(invalid_highway.sum())} invalid edge(s)."
        )

    length_m = pd.to_numeric(
        roads["length_m"],
        errors="coerce",
    )

    invalid_length = (
        ~np.isfinite(
            length_m.to_numpy(dtype=float)
        )
        | (length_m <= 0)
    )

    if invalid_length.any():
        raise EmissionInputError(
            "Every road edge must have finite positive length_m; "
            f"found {int(invalid_length.sum())} invalid edge(s)."
        )

    invalid_geometry = (
        roads.geometry.isna()
        | roads.geometry.is_empty
    )

    if invalid_geometry.any():
        raise EmissionInputError(
            "Every road edge must have a non-empty geometry; "
            f"found {int(invalid_geometry.sum())} invalid edge(s)."
        )

    result = roads.copy()

    result["highway"] = highway.astype(str)
    result["length_m"] = length_m.astype(float)

    return result


def summarise_road_classes(
    roads: gpd.GeoDataFrame,
) -> pd.DataFrame:
    """Return the A3.1 road-length table grouped by OSM highway class."""
    if roads.empty:
        raise EmissionInputError(
            "Cannot summarise an empty road network."
        )

    frame = pd.DataFrame(
        {
            "highway": (
                roads["highway"]
                .astype("string")
                .str.strip()
            ),
            "length_m": pd.to_numeric(
                roads["length_m"],
                errors="coerce",
            ),
        }
    )

    if (
        frame["highway"].isna().any()
        or (frame["highway"] == "").any()
    ):
        raise EmissionInputError(
            "Cannot group roads with an empty highway class."
        )

    if (
        ~np.isfinite(
            frame["length_m"]
        )
        | (frame["length_m"] <= 0)
    ).any():
        raise EmissionInputError(
            "Cannot group roads with invalid length_m values."
        )

    summary = (
        frame
        .groupby(
            "highway",
            as_index=False,
        )
        .agg(
            edges=(
                "length_m",
                "size",
            ),
            length_m=(
                "length_m",
                "sum",
            ),
        )
        .sort_values(
            [
                "length_m",
                "highway",
            ],
            ascending=[
                False,
                True,
            ],
            ignore_index=True,
        )
    )

    total = float(
        summary["length_m"].sum()
    )

    if (
        not np.isfinite(total)
        or total <= 0
    ):
        raise EmissionInputError(
            "Total road length must be finite and positive."
        )

    summary["length_km"] = (
        summary["length_m"]
        / METRES_PER_KILOMETRE
    )

    summary["share_percent"] = (
        summary["length_m"]
        / total
        * 100.0
    )

    summary["length_m"] = (
        summary["length_m"]
        .round(1)
    )

    summary["length_km"] = (
        summary["length_km"]
        .round(4)
    )

    summary["share_percent"] = (
        summary["share_percent"]
        .round(2)
    )

    return summary[
        [
            "highway",
            "edges",
            "length_m",
            "length_km",
            "share_percent",
        ]
    ]


def _required_text(
    config: dict[str, Any],
    key: str,
) -> str:
    value = get_required(
        config,
        key,
    )

    if (
        not isinstance(value, str)
        or not value.strip()
    ):
        raise ConfigError(
            f"Configuration key '{key}' must be a non-empty string."
        )

    return value.strip()


def _required_positive_number(
    config: dict[str, Any],
    key: str,
) -> float:
    value = get_required(
        config,
        key,
    )

    if isinstance(
        value,
        bool,
    ):
        raise ConfigError(
            f"Configuration key '{key}' must be a positive number."
        )

    try:
        number = float(
            value
        )

    except (
        TypeError,
        ValueError,
    ) as exc:
        raise ConfigError(
            f"Configuration key '{key}' must be a positive number."
        ) from exc

    if (
        not np.isfinite(number)
        or number <= 0
    ):
        raise ConfigError(
            f"Configuration key '{key}' must be finite and > 0."
        )

    return number


def load_emission_settings(
    config: dict[str, Any],
) -> dict[str, Any]:
    """Read all A3.2 model parameters from YAML; no fallback values exist."""

    weights_raw = get_required(
        config,
        "emissions.allocation.road_class_weights",
    )

    if (
        not isinstance(weights_raw, dict)
        or not weights_raw
    ):
        raise ConfigError(
            "'emissions.allocation.road_class_weights' "
            "must be a non-empty mapping."
        )

    weights: dict[str, float] = {}

    for road_class, raw_weight in weights_raw.items():

        if (
            not isinstance(road_class, str)
            or not road_class.strip()
        ):
            raise ConfigError(
                "Every configured road-class key "
                "must be non-empty text."
            )

        key = road_class.strip()

        try:
            weight = float(
                raw_weight
            )

        except (
            TypeError,
            ValueError,
        ) as exc:
            raise ConfigError(
                f"Road-class weight for '{key}' must be numeric."
            ) from exc

        if (
            not np.isfinite(weight)
            or weight <= 0
        ):
            raise ConfigError(
                f"Road-class weight for '{key}' "
                "must be finite and > 0."
            )

        weights[
            key
        ] = weight

    return {
        "pollutant": _required_text(
            config,
            "emissions.pollutant",
        ),
        "ef_g_per_vehicle_km": _required_positive_number(
            config,
            "emissions.emission_factor.value_g_per_vehicle_km",
        ),
        "ef_source": _required_text(
            config,
            "emissions.emission_factor.source",
        ),
        "ef_doi": _required_text(
            config,
            "emissions.emission_factor.doi",
        ),
        "allocation_basis": _required_text(
            config,
            "emissions.allocation.basis",
        ),
        "road_class_weights": weights,
    }


def assign_edge_emission_proxies(
    roads: gpd.GeoDataFrame,
    config: dict[str, Any],
) -> gpd.GeoDataFrame:
    """Assign the config-driven A3.2 relative emission allocation.

    weighted_length_km =
        length_km * class_weight

    emission_proxy =
        weighted_length_km * EF

    emission_share =
        emission_proxy / sum(emission_proxy)

    emission_proxy is not an absolute g/s rate.
    It is only an allocation proxy until A3.4
    normalises the shares to EDGAR.
    """

    if roads.empty:
        raise EmissionInputError(
            "Cannot allocate emissions to an empty road network."
        )

    settings = load_emission_settings(
        config
    )

    weights = settings[
        "road_class_weights"
    ]

    classes = set(
        roads["highway"]
        .astype(str)
        .str.strip()
    )

    missing = sorted(
        classes.difference(
            weights
        )
    )

    if missing:
        raise ConfigError(
            "No configured A3.2 road-class weight for: "
            + ", ".join(missing)
            + ". Add every observed class under "
            "emissions.allocation.road_class_weights."
        )

    result = roads.copy()

    result["road_class_weight"] = (
        result["highway"]
        .astype(str)
        .str.strip()
        .map(weights)
        .astype(float)
    )

    result["length_km"] = (
        result["length_m"].astype(float)
        / METRES_PER_KILOMETRE
    )

    result["weighted_length_km"] = (
        result["length_km"]
        * result["road_class_weight"]
    )

    result["ef_g_per_vehicle_km"] = settings[
        "ef_g_per_vehicle_km"
    ]

    result["emission_proxy"] = (
        result["weighted_length_km"]
        * result["ef_g_per_vehicle_km"]
    )

    total_proxy = float(
        result["emission_proxy"].sum()
    )

    if (
        not np.isfinite(total_proxy)
        or total_proxy <= 0
    ):
        raise EmissionInputError(
            "Configured edge-emission proxy "
            "has a non-positive total."
        )

    result["emission_share"] = (
        result["emission_proxy"]
        / total_proxy
    )

    result["pollutant"] = settings[
        "pollutant"
    ]

    result["allocation_basis"] = settings[
        "allocation_basis"
    ]

    return result


def summarise_edge_emissions(
    roads: gpd.GeoDataFrame,
) -> pd.DataFrame:
    """Summarise A3.2 allocation by road class for QA."""

    required = {
        "highway",
        "length_m",
        "road_class_weight",
        "weighted_length_km",
        "emission_proxy",
        "emission_share",
    }

    missing = required.difference(
        roads.columns
    )

    if missing:
        raise EmissionInputError(
            "Road-emission table is missing required columns: "
            + ", ".join(
                sorted(missing)
            )
        )

    summary = (
        roads
        .groupby(
            "highway",
            as_index=False,
        )
        .agg(
            edges=(
                "highway",
                "size",
            ),
            length_m=(
                "length_m",
                "sum",
            ),
            class_weight=(
                "road_class_weight",
                "first",
            ),
            weighted_length_km=(
                "weighted_length_km",
                "sum",
            ),
            emission_proxy=(
                "emission_proxy",
                "sum",
            ),
            emission_share=(
                "emission_share",
                "sum",
            ),
        )
        .sort_values(
            [
                "emission_share",
                "highway",
            ],
            ascending=[
                False,
                True,
            ],
            ignore_index=True,
        )
    )

    summary[
        "emission_share_percent"
    ] = (
        summary["emission_share"]
        * 100.0
    )

    return summary[
        [
            "highway",
            "edges",
            "length_m",
            "class_weight",
            "weighted_length_km",
            "emission_proxy",
            "emission_share_percent",
        ]
    ]


def write_road_class_summary(
    summary: pd.DataFrame,
    output_path: str | Path,
) -> Path:

    path = (
        Path(output_path)
        .expanduser()
        .resolve()
    )

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    summary.to_csv(
        path,
        index=False,
        encoding="utf-8",
    )

    return path


def write_road_emissions(
    roads: gpd.GeoDataFrame,
    output_path: str | Path,
) -> Path:

    path = (
        Path(output_path)
        .expanduser()
        .resolve()
    )

    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    roads.to_file(
        path,
        driver="GeoJSON",
    )

    return path


def run(
    config_path: str | Path,
) -> tuple[
    pd.DataFrame,
    gpd.GeoDataFrame,
    Path,
    Path,
]:

    config = load_project_config(
        config_path
    )

    roads_path = resolve_repo_path(
        config,
        "paths.roads",
    )

    summary_path = resolve_repo_path(
        config,
        "paths.road_class_summary",
    )

    emissions_path = resolve_repo_path(
        config,
        "paths.road_emissions",
    )

    if emissions_path == roads_path:
        raise ConfigError(
            "paths.road_emissions must not overwrite paths.roads."
        )

    roads = load_roads(
        roads_path
    )

    LOGGER.info(
        "Loaded %d road edges from %s (%.1f m total)",
        len(roads),
        roads_path,
        roads["length_m"].sum(),
    )

    road_summary = summarise_road_classes(
        roads
    )

    allocated = assign_edge_emission_proxies(
        roads,
        config,
    )

    write_road_class_summary(
        road_summary,
        summary_path,
    )

    write_road_emissions(
        allocated,
        emissions_path,
    )

    return (
        road_summary,
        allocated,
        summary_path,
        emissions_path,
    )


def parse_args() -> argparse.Namespace:

    parser = argparse.ArgumentParser(
        description=(
            "A3.1-A3.2 road summary and "
            "config-driven emission allocation."
        )
    )

    parser.add_argument(
        "--config",
        required=True,
        help=(
            "Project YAML path. Required so the emission "
            "workflow never guesses model settings."
        ),
    )

    return parser.parse_args()


def main() -> None:

    args = parse_args()

    config = load_project_config(
        args.config
    )

    level_name = _required_text(
        config,
        "runtime.log_level",
    ).upper()

    level = getattr(
        logging,
        level_name,
        None,
    )

    if not isinstance(
        level,
        int,
    ):
        raise ConfigError(
            f"Invalid runtime.log_level: {level_name}"
        )

    logging.basicConfig(
        level=level,
        format="%(levelname)s: %(message)s",
    )

    (
        road_summary,
        allocated,
        summary_path,
        emissions_path,
    ) = run(
        args.config
    )

    settings = load_emission_settings(
        config
    )

    emission_summary = summarise_edge_emissions(
        allocated
    )

    print(
        "\nA3.1 - Road length by OSM highway class"
    )

    print(
        "=" * 72
    )

    print(
        road_summary.to_string(
            index=False
        )
    )

    print(
        "=" * 72
    )

    print(
        f"Total edges: "
        f"{int(road_summary['edges'].sum())}"
    )

    print(
        f"Total length: "
        f"{road_summary['length_m'].sum():.1f} m"
    )

    print(
        f"Saved A3.1: {summary_path}"
    )

    print(
        "\nA3.2 - Config-driven relative edge emission allocation"
    )

    print(
        "=" * 100
    )

    print(
        f"Pollutant label: "
        f"{settings['pollutant']}"
    )

    print(
        f"EF: "
        f"{settings['ef_g_per_vehicle_km']:.6g} "
        f"g/(vehicle km)"
    )

    print(
        f"Allocation basis: "
        f"{settings['allocation_basis']}"
    )

    print(
        emission_summary.to_string(
            index=False,
            formatters={
                "length_m": (
                    lambda v: f"{v:.1f}"
                ),
                "class_weight": (
                    lambda v: f"{v:.3f}"
                ),
                "weighted_length_km": (
                    lambda v: f"{v:.6f}"
                ),
                "emission_proxy": (
                    lambda v: f"{v:.8f}"
                ),
                "emission_share_percent": (
                    lambda v: f"{v:.2f}"
                ),
            },
        )
    )

    print(
        "=" * 100
    )

    print(
        "Emission-share sum: "
        f"{allocated['emission_share'].sum():.12f}"
    )

    print(
        f"Saved A3.2: {emissions_path}"
    )

    print(
        "NOTE: A3.2 is a relative allocation only; "
        "A3.4 supplies the EDGAR normalisation."
    )


if __name__ == "__main__":
    main()