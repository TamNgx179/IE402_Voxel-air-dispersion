from __future__ import annotations

import sys
import zipfile

from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from pyproj import CRS


REPO_ROOT = (
    Path(
        __file__
    )
    .resolve()
    .parents[
        1
    ]
)

SRC_DIR = (
    REPO_ROOT
    /
    "src"
)

if str(
    SRC_DIR
) not in sys.path:

    sys.path.insert(
        0,
        str(
            SRC_DIR
        ),
    )


import edgar_normalizer as en

from project_config import ConfigError


def _settings(
    **overrides,
) -> en.EdgarSettings:

    values = {
        "method":
            "area_weighted_flux",

        "spatial_proxy_pollutant":
            "PM",

        "target_pollutant":
            "PM2.5",

        "release":
            "EDGAR v8.1",

        "year":
            2022,

        "sector_code":
            "TRO",

        "sector_description":
            "IPCC 1A3b - Road transportation",

        "product":
            "annual_sector_specific_flux",

        "archive_url":
            "https://example.invalid/edgar.zip",

        "download_if_missing":
            False,

        "download_timeout_s":
            30.0,

        "member_name":
            None,

        "variable_name":
            "fluxes",

        "latitude_coordinate":
            "lat",

        "longitude_coordinate":
            "lon",

        "expected_units":
            "kg m-2 s-1",

        "area_coverage_relative_tolerance":
            1e-5,

        "output_dtype":
            "float32",

        "netcdf_engine":
            "scipy",

        "compression_level":
            1,

        "attribution":
            "synthetic test",
    }

    values.update(
        overrides
    )

    return en.EdgarSettings(
        **values
    )


def _relative_dataset(
    dtype=np.float64,
    values=None,
) -> xr.Dataset:

    x = np.array(
        [
            1250.0,
            1750.0,
        ]
    )

    y = np.array(
        [
            1250.0,
            1750.0,
        ]
    )

    z = np.array(
        [
            1.0,
            3.0,
        ]
    )

    source = np.zeros(
        (
            2,
            2,
            2,
        ),
        dtype=dtype,
    )

    if values is None:

        source[
            0,
            :,
            :,
        ] = np.asarray(
            0.25,
            dtype=dtype,
        )

    else:

        source[
            0,
            :,
            :,
        ] = (
            np.asarray(
                values,
                dtype=dtype,
            )
            .reshape(
                2,
                2,
            )
        )

    crs = CRS.from_epsg(
        3857
    )

    dataset = xr.Dataset(
        {
            "S": (
                (
                    "z",
                    "y",
                    "x",
                ),
                source,
            ),

            "S_proxy": (
                (
                    "z",
                    "y",
                    "x",
                ),
                source.astype(
                    float
                )
                *
                3.0,
            ),

            "crs":
                xr.DataArray(
                    np.int32(
                        0
                    )
                ),
        },

        coords={
            "x":
                x,

            "y":
                y,

            "z":
                z,
        },
    )

    dataset[
        "S"
    ].attrs.update(
        {
            "units":
                "1",

            "transport_ready":
                "false",
        }
    )

    dataset[
        "crs"
    ].attrs.update(
        {
            "crs_wkt":
                crs.to_wkt(),

            "spatial_ref":
                crs.to_wkt(),
        }
    )

    dataset.attrs.update(
        {
            "model_crs":
                crs.to_string(),

            "proxy_retained":
                3.0,
        }
    )

    return dataset


def _edgar_flux(
    value=2e-9,
) -> xr.DataArray:

    lat = np.array(
        [
            -0.05,
            0.05,
        ]
    )

    lon = np.array(
        [
            -0.05,
            0.05,
        ]
    )

    data = np.array(
        [
            [
                1e-9,
                1e-9,
            ],

            [
                1e-9,
                value,
            ],
        ],
        dtype=float,
    )

    result = xr.DataArray(
        data,

        dims=(
            "lat",
            "lon",
        ),

        coords={
            "lat":
                lat,

            "lon":
                lon,
        },

        name="fluxes",
    )

    result.attrs[
        "units"
    ] = (
        "kg m-2 s-1"
    )

    return result


def test_normalization_conserves_edgar_target():

    (
        output,
        diagnostics,
    ) = en.normalize_with_edgar(
        relative_dataset=
            _relative_dataset(),

        edgar_flux=
            _edgar_flux(
                2e-9
            ),

        settings=
            _settings(),
    )

    assert (
        diagnostics.domain_area_m2
        ==
        pytest.approx(
            1_000_000.0
        )
    )

    assert (
        diagnostics.target_total_kg_s
        ==
        pytest.approx(
            0.002,
            rel=2e-4,
        )
    )

    assert (
        diagnostics.integrated_transport_source_kg_s
        ==
        pytest.approx(
            diagnostics.target_total_kg_s,
            rel=1e-13,
        )
    )

    assert (
        output[
            "S"
        ].attrs[
            "units"
        ]
        ==
        "kg m-3 s-1"
    )

    assert (
        output.attrs[
            "transport_ready"
        ]
        ==
        "true"
    )

    assert float(
        output[
            "S_relative"
        ].sum()
    ) == pytest.approx(
        1.0,
        abs=1e-15,
    )


def test_float32_persisted_drift_is_renormalized_before_mass_balance():

    dataset = _relative_dataset(
        dtype=np.float32,

        values=[
            0.1,
            0.2,
            0.3,
            0.4,
        ],
    )

    persisted = float(
        np.asarray(
            dataset[
                "S"
            ].values,
            dtype=np.float64,
        ).sum()
    )

    assert persisted != 1.0

    (
        output,
        diagnostics,
    ) = en.normalize_with_edgar(
        relative_dataset=
            dataset,

        edgar_flux=
            _edgar_flux(),

        settings=
            _settings(),
    )

    assert (
        diagnostics.persisted_relative_source_sum
        ==
        pytest.approx(
            persisted
        )
    )

    assert (
        diagnostics.normalized_relative_source_sum
        ==
        pytest.approx(
            1.0,
            abs=1e-15,
        )
    )

    assert (
        diagnostics.integrated_transport_source_kg_s
        ==
        pytest.approx(
            diagnostics.target_total_kg_s,
            rel=1e-13,
        )
    )

    assert float(
        output[
            "S_relative"
        ].sum()
    ) == pytest.approx(
        1.0,
        abs=1e-15,
    )


def test_normalization_uses_voxel_volume():

    (
        output,
        diagnostics,
    ) = en.normalize_with_edgar(
        relative_dataset=
            _relative_dataset(),

        edgar_flux=
            _edgar_flux(
                2e-9
            ),

        settings=
            _settings(),
    )

    assert (
        diagnostics.voxel_volume_m3
        ==
        pytest.approx(
            500_000.0
        )
    )

    expected = (
        diagnostics.target_total_kg_s
        *
        0.25
        /
        diagnostics.voxel_volume_m3
    )

    np.testing.assert_allclose(
        output[
            "S"
        ].values[
            0
        ],
        expected,
    )

    np.testing.assert_allclose(
        output[
            "S"
        ].values[
            1
        ],
        0.0,
    )


def test_normalization_factor_uses_a33_proxy():

    (
        _,
        diagnostics,
    ) = en.normalize_with_edgar(
        relative_dataset=
            _relative_dataset(),

        edgar_flux=
            _edgar_flux(),

        settings=
            _settings(),
    )

    assert (
        diagnostics.normalization_factor_kg_s_per_proxy_unit
        ==
        pytest.approx(
            diagnostics.target_total_kg_s
            /
            3.0
        )
    )


def test_negative_edgar_flux_fails():

    flux = _edgar_flux()

    flux.loc[
        {
            "lat":
                0.05,

            "lon":
                0.05,
        }
    ] = -1e-9

    with pytest.raises(
        en.EdgarNormalizationError,
        match="non-negative",
    ):

        en.normalize_with_edgar(
            relative_dataset=
                _relative_dataset(),

            edgar_flux=
                flux,

            settings=
                _settings(),
        )


def test_extract_single_netcdf_from_zip(
    tmp_path: Path,
):

    netcdf = (
        tmp_path
        /
        "synthetic.nc"
    )

    xr.Dataset(
        {
            "fluxes": (
                (
                    "lat",
                    "lon",
                ),
                np.ones(
                    (
                        2,
                        2,
                    )
                ),
            )
        },

        coords={
            "lat":
                [
                    -0.05,
                    0.05,
                ],

            "lon":
                [
                    -0.05,
                    0.05,
                ],
        },
    ).to_netcdf(
        netcdf
    )

    archive = (
        tmp_path
        /
        "edgar.zip"
    )

    with zipfile.ZipFile(
        archive,
        "w",
    ) as bundle:

        bundle.write(
            netcdf,
            arcname=
                "folder/synthetic.nc",
        )

    extracted = en.extract_edgar_netcdf(
        archive,

        tmp_path
        /
        "out",

        _settings(),
    )

    assert (
        extracted.name
        ==
        "synthetic.nc"
    )

    assert extracted.exists()


def test_load_edgar_flux_checks_units(
    tmp_path: Path,
):

    netcdf = (
        tmp_path
        /
        "flux.nc"
    )

    dataset = xr.Dataset(
        {
            "fluxes": (
                (
                    "lat",
                    "lon",
                ),
                np.ones(
                    (
                        2,
                        2,
                    )
                ),
            )
        },

        coords={
            "lat":
                [
                    -0.05,
                    0.05,
                ],

            "lon":
                [
                    -0.05,
                    0.05,
                ],
        },
    )

    dataset[
        "fluxes"
    ].attrs[
        "units"
    ] = (
        "ton/year"
    )

    dataset.to_netcdf(
        netcdf
    )

    with pytest.raises(
        en.EdgarNormalizationError,
        match="Unexpected EDGAR flux units",
    ):

        en.load_edgar_flux(
            netcdf,
            _settings(),
        )


def test_missing_archive_does_not_fallback(
    tmp_path: Path,
):

    with pytest.raises(
        FileNotFoundError,
        match="automatic download is disabled",
    ):

        en.ensure_edgar_archive(
            tmp_path
            /
            "missing.zip",

            _settings(
                download_if_missing=
                    False
            ),
        )


def test_settings_require_values():

    with pytest.raises(
        ConfigError
    ):

        en.read_edgar_settings(
            {
                "emissions": {
                    "pollutant":
                        "PM",

                    "normalization":
                        {},
                }
            }
        )