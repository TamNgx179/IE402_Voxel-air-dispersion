"""Backward-compatible entry point for A3.1-A3.2 emission preparation."""

from emission.roads import (
    METRES_PER_KILOMETRE,
    EmissionInputError,
    _required_positive_number,
    _required_text,
    assign_edge_emission_proxies,
    build_source_term,
    load_emission_settings,
    load_roads,
    summarise_edge_emissions,
    summarise_road_classes,
    write_road_class_summary,
    write_road_emissions,
)
from emission.workflow import (
    parse_road_args as parse_args,
    road_main as main,
    run_road_workflow as run,
)

if __name__ == "__main__":
    main()