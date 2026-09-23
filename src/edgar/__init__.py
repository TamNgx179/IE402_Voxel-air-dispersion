"""EDGAR transport-emission normalisation package."""

from edgar.config import (
    EdgarCellContribution,
    EdgarNormalizationError,
    EdgarSettings,
    NormalizationDiagnostics,
    read_edgar_settings,
)
from edgar.io import (
    ensure_edgar_archive,
    extract_edgar_netcdf,
    load_edgar_flux,
    load_relative_source,
    save_transport_source,
    write_normalization_report,
)
from edgar.normalizer import main, normalize_with_edgar, run

__all__ = [
    "EdgarCellContribution",
    "EdgarNormalizationError",
    "EdgarSettings",
    "NormalizationDiagnostics",
    "read_edgar_settings",
    "ensure_edgar_archive",
    "extract_edgar_netcdf",
    "load_edgar_flux",
    "load_relative_source",
    "save_transport_source",
    "write_normalization_report",
    "normalize_with_edgar",
    "run",
    "main",
]