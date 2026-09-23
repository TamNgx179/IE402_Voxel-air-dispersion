"""Backward-compatible entry point for A3.3 emission rasterisation."""

from emission.rasterizer import (
    EmissionRasterizationError,
    RasterizationDiagnostics,
    RasterizationSettings,
    _build_output_dataset,
    _cell_edges,
    _nearest_coordinate_index,
    _read_model_crs,
    _required_nonnegative_float,
    _uniform_spacing,
    _validate_projected_road_lengths,
    _validate_voxel_dataset,
    rasterize_relative_source,
)
from emission.workflow import (
    load_road_emissions,
    load_voxel_dataset,
    read_rasterization_settings,
    save_emission_source_dataset,
    parse_raster_args as parse_args,
    raster_main as main,
    run_raster_workflow as run,
)

if __name__ == "__main__":
    main()