"""Tests for A3.3 road-emission rasterisation."""

from __future__ import annotations

import sys

from pathlib import Path

import geopandas as gpd
import numpy as np
import pytest
import xarray as xr

from pyproj import CRS
from shapely.geometry import LineString


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


import emission_rasterizer as er

from project_config import (
    ConfigError,
)


def _voxel_dataset(
    *,
    solid_cell: tuple[
        int,
        int,
        int,
    ]
    |
    None = None,
) -> xr.Dataset:

    x = np.array(
        [
            2.5,
            7.5,
            12.5,
            17.5,
        ],
        dtype=float,
    )


    y = np.array(
        [
            2.5,
            7.5,
            12.5,
            17.5,
        ],
        dtype=float,
    )


    z = np.array(
        [
            1.0,
            3.0,
            5.0,
        ],
        dtype=float,
    )


    building = np.zeros(
        (
            3,
            4,
            4,
        ),
        dtype=np.uint8,
    )


    if solid_cell is not None:

        building[
            solid_cell
        ] = 1


    crs = CRS.from_epsg(
        32648
    )


    dataset = xr.Dataset(

        data_vars={

            "B": (
                (
                    "z",
                    "y",
                    "x",
                ),
                building,
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
        "crs"
    ].attrs.update(
        {
            "spatial_ref":
                crs.to_wkt(),

            "crs_wkt":
                crs.to_wkt(),
        }
    )


    dataset.attrs[
        "model_crs"
    ] = (
        crs.to_string()
    )


    return dataset


def _roads() -> gpd.GeoDataFrame:

    geometry = [

        LineString(
            [
                (
                    0.0,
                    7.5,
                ),
                (
                    20.0,
                    7.5,
                ),
            ]
        ),

        LineString(
            [
                (
                    10.0,
                    0.0,
                ),
                (
                    10.0,
                    20.0,
                ),
            ]
        ),

    ]


    return gpd.GeoDataFrame(

        {
            "length_m": [
                20.0,
                20.0,
            ],

            "emission_proxy": [
                2.0,
                1.0,
            ],
        },

        geometry=geometry,

        crs="EPSG:32648",

    )


def _settings(
    *,
    source_height_m: float = 1.0,
    netcdf_engine: str = "scipy",
) -> er.RasterizationSettings:

    return er.RasterizationSettings(

        source_height_m=
            source_height_m,

        geometry_length_relative_tolerance=
            0.01,

        output_dtype=
            "float32",

        netcdf_engine=
            netcdf_engine,

        compression_level=
            1,

    )


def test_a33_creates_canonical_zyx_source_and_sum_one():

    (
        result,
        diagnostics,
    ) = (
        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                _roads(),

            settings=
                _settings(),

        )
    )


    assert (
        result[
            "S"
        ].dims
        ==
        (
            "z",
            "y",
            "x",
        )
    )


    assert (
        result[
            "S"
        ].shape
        ==
        (
            3,
            4,
            4,
        )
    )


    assert float(
        result[
            "S"
        ].sum()
    ) == pytest.approx(
        1.0,
        abs=1e-12,
    )


    assert (
        diagnostics.source_z_index
        ==
        0
    )


    assert (
        diagnostics.source_z_m
        ==
        pytest.approx(
            1.0
        )
    )


def test_a33_puts_source_only_in_configured_nearest_height_layer():

    (
        result,
        diagnostics,
    ) = (
        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                _roads(),

            settings=
                _settings(
                    source_height_m=3.4
                ),

        )
    )


    assert (
        diagnostics.source_z_index
        ==
        1
    )


    assert (
        diagnostics.source_z_m
        ==
        pytest.approx(
            3.0
        )
    )


    assert float(
        result[
            "S"
        ]
        .isel(
            z=0
        )
        .sum()
    ) == pytest.approx(
        0.0
    )


    assert float(
        result[
            "S"
        ]
        .isel(
            z=1
        )
        .sum()
    ) == pytest.approx(
        1.0
    )


    assert float(
        result[
            "S"
        ]
        .isel(
            z=2
        )
        .sum()
    ) == pytest.approx(
        0.0
    )


def test_a33_rejects_source_inside_solid_voxel_and_renormalises():

    voxel = _voxel_dataset(
        solid_cell=(
            0,
            1,
            0,
        )
    )


    (
        result,
        diagnostics,
    ) = (
        er.rasterize_relative_source(

            voxel_dataset=
                voxel,

            road_emissions=
                _roads(),

            settings=
                _settings(),

        )
    )


    solid = np.asarray(
        voxel[
            "B"
        ].values,
        dtype=bool,
    )


    source = np.asarray(
        result[
            "S"
        ].values
    )


    assert (
        diagnostics.proxy_rejected_by_solids
        >
        0.0
    )


    assert np.all(
        source[
            solid
        ]
        ==
        0.0
    )


    assert (
        source.sum()
        ==
        pytest.approx(
            1.0,
            abs=1e-12,
        )
    )


def test_a33_clips_road_at_horizontal_domain_boundary():

    roads = gpd.GeoDataFrame(

        {
            "length_m": [
                40.0
            ],

            "emission_proxy": [
                4.0
            ],
        },

        geometry=[
            LineString(
                [
                    (
                        -10.0,
                        7.5,
                    ),
                    (
                        30.0,
                        7.5,
                    ),
                ]
            )
        ],

        crs="EPSG:32648",

    )


    (
        _,
        diagnostics,
    ) = (
        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                roads,

            settings=
                _settings(),

        )
    )


    assert (
        diagnostics.input_proxy_total
        ==
        pytest.approx(
            4.0
        )
    )


    assert (
        diagnostics.proxy_inside_domain
        ==
        pytest.approx(
            2.0
        )
    )


def test_a33_length_m_mismatch_fails_loudly():

    roads = (
        _roads()
        .copy()
    )


    roads.loc[
        0,
        "length_m",
    ] = 100.0


    with pytest.raises(
        er.EmissionRasterizationError,
        match="length_m",
    ):

        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                roads,

            settings=
                _settings(),

        )


def test_a33_source_height_outside_domain_fails():

    with pytest.raises(
        ConfigError,
        match="outside",
    ):

        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                _roads(),

            settings=
                _settings(
                    source_height_m=100.0
                ),

        )


def test_a33_output_is_explicitly_not_transport_ready():

    (
        result,
        _,
    ) = (
        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                _roads(),

            settings=
                _settings(),

        )
    )


    assert (
        result[
            "S"
        ].attrs[
            "units"
        ]
        ==
        "1"
    )


    assert (
        result[
            "S"
        ].attrs[
            "normalization_status"
        ]
        ==
        "pending_A3.4_EDGAR"
    )


    assert (
        result[
            "S"
        ].attrs[
            "transport_ready"
        ]
        ==
        "false"
    )


def test_a33_writes_netcdf_round_trip(
    tmp_path: Path,
):

    (
        result,
        _,
    ) = (
        er.rasterize_relative_source(

            voxel_dataset=
                _voxel_dataset(),

            road_emissions=
                _roads(),

            settings=
                _settings(),

        )
    )


    output = (
        er.save_emission_source_dataset(

            result,

            tmp_path
            /
            "emission_source.nc",

            _settings(),

        )
    )


    assert output.exists()


    with xr.open_dataset(
        output
    ) as loaded:

        assert (
            loaded[
                "S"
            ].dims
            ==
            (
                "z",
                "y",
                "x",
            )
        )


        assert float(
            loaded[
                "S"
            ].sum()
        ) == pytest.approx(
            1.0,
            abs=1e-6,
        )


        assert (
            "S_proxy"
            in loaded
        )


        assert (
            "crs"
            in loaded
        )