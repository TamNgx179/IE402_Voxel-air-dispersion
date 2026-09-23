"""Traffic-emission preparation package (A3.1-A3.3)."""

from emission.roads import (
    EmissionInputError,
    assign_edge_emission_proxies,
    build_source_term,
    load_emission_settings,
    load_roads,
    summarise_edge_emissions,
    summarise_road_classes,
    write_road_class_summary,
    write_road_emissions,
)
from emission.rasterizer import (
    EmissionRasterizationError,
    RasterizationDiagnostics,
    RasterizationSettings,
    rasterize_relative_source,
)
from emission.workflow import (
    load_road_emissions,
    load_voxel_dataset,
    read_rasterization_settings,
    save_emission_source_dataset,
)

__all__ = [
    "EmissionInputError",
    "assign_edge_emission_proxies",
    "build_source_term",
    "load_emission_settings",
    "load_roads",
    "summarise_edge_emissions",
    "summarise_road_classes",
    "write_road_class_summary",
    "write_road_emissions",
    "EmissionRasterizationError",
    "RasterizationDiagnostics",
    "RasterizationSettings",
    "load_road_emissions",
    "load_voxel_dataset",
    "rasterize_relative_source",
    "read_rasterization_settings",
    "save_emission_source_dataset",
]