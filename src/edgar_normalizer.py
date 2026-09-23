"""Backward-compatible entry point for the EDGAR normalisation package."""

from edgar.config import (
    EdgarCellContribution,
    EdgarNormalizationError,
    EdgarSettings,
    NormalizationDiagnostics,
    _boolean,
    _integer,
    _nonnegative,
    _positive,
    _text,
    read_edgar_settings,
)
from edgar.io import (
    _read_model_crs,
    _sum_bound_storage,
    _units,
    _validated_relative_source,
    ensure_edgar_archive,
    extract_edgar_netcdf,
    load_edgar_flux,
    load_relative_source,
    save_transport_source,
    write_normalization_report,
)
from edgar.normalizer import (
    _edges,
    _overlaps,
    _positive_attr,
    _spacing,
    _sum_bound64,
    main,
    normalize_with_edgar,
    run,
)

if __name__ == "__main__":
    main()