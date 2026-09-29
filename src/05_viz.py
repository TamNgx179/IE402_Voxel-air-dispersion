"""
Report figures (300 dpi) for every scenario on the data contract.

    python src/05_viz.py --config config/project.yaml

Writes to output/figures/. Needs the scenarios that src/04_analysis.py
analyses; figure definitions are in src/analysis/figures.py.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import geopandas as gpd  # noqa: E402

from analysis import figures  # noqa: E402
from analysis.pipeline import concentration_path, load_scenario, thresholds  # noqa: E402
from project_config import REPO_ROOT, get_required, load_project_config, resolve_repo_path  # noqa: E402

FIGURE_DIR = REPO_ROOT / "output" / "figures"


def satellite_check(config, field_) -> Path:
    """A2.4 over satellite imagery, on the model grid at 0.5 m."""

    from pyproj import Transformer

    from analysis import imagery

    _, dy, dx = field_.spacing
    west, east = field_.x[0] - dx / 2, field_.x[-1] + dx / 2
    south, north = field_.y[0] - dy / 2, field_.y[-1] + dy / 2
    to_wgs84 = Transformer.from_crs(field_.crs, "EPSG:4326", always_xy=True)
    lons, lats = to_wgs84.transform([west, east, east, west], [south, south, north, north])
    mosaic, bounds = imagery.fetch_tiles((min(lons), min(lats), max(lons), max(lats)), 18,
                                         REPO_ROOT / "data" / "raw" / "imagery")
    rgb = imagery.warp_to_grid(mosaic, bounds, field_.crs, (west, south, east, north), 0.5)

    return figures.voxel_check_satellite(
        field_, gpd.read_file(resolve_repo_path(config, "paths.processed_buildings")), rgb,
        (1.0, 15.0, 45.0), imagery.ATTRIBUTION, FIGURE_DIR / "A2_4_voxel_check_satellite.png",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Tier 3 report figures")
    parser.add_argument("--config", required=True)
    parser.add_argument(
        "--imagery", action="store_true",
        help="also draw A2.4 over Esri World Imagery; fetches ~20 tiles once into data/raw/imagery/",
    )
    args = parser.parse_args()

    config = load_project_config(args.config)
    scenarios = [s for s in get_required(config, "web.scenarios") if concentration_path(config, s).exists()]

    if not scenarios:
        raise SystemExit("no concentration file found: run src/04_analysis.py --baselines first")

    fields = [load_scenario(config, s) for s in scenarios]
    # Three decades, not the web's four: static figures need the contrast.
    decades = min(3.0, float(get_required(config, "web.log_decades")))
    limits = thresholds(config)
    tag = "_".join(sorted({f.attrs.get("model", "model") for f in fields}))

    written = [
        figures.voxel_check(fields[0], gpd.read_file(resolve_repo_path(config, "paths.processed_buildings")),
                            FIGURE_DIR / "A2_4_voxel_check.png"),
        figures.slices(fields, get_required(config, "analysis.slice_heights_m"), decades,
                       FIGURE_DIR / f"slices_{tag}.png"),
        figures.layer_means(fields, FIGURE_DIR / f"layer_means_{tag}.png"),
        figures.profiles(fields, limits, FIGURE_DIR / f"profile_street_max_{tag}.png"),
        figures.facade_by_floor(fields, float(get_required(config, "analysis.floor_height_m")),
                                FIGURE_DIR / f"facade_by_floor_{tag}.png"),
        figures.exceedance_sensitivity(fields, limits, FIGURE_DIR / f"exceedance_vs_multiplier_{tag}.png"),
    ]
    written += [
        figures.vertical_sections(f, decades, FIGURE_DIR / f"sections_{f.scenario}.png") for f in fields
    ]

    if args.imagery:
        written.append(satellite_check(config, fields[0]))

    for path in written:
        print(f"Saved {path}")


if __name__ == "__main__":
    main()
