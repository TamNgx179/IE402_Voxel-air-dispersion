from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class GridDefinition:
    """
    Definition of the 3D computational grid.

    Coordinate convention
    ---------------------
    x:
        East-west projected coordinate, in metres.

    y:
        North-south projected coordinate, in metres.

    z:
        Height above the configured domain base, in metres.

    Array convention used throughout the project
    --------------------------------------------
    2D:
        [y, x]

    3D:
        [z, y, x]

    The values stored here describe CELL BOUNDARIES.

    Cell-centre coordinates are generated using:
        x_centers()
        y_centers()
        z_centers()
    """

    min_x: float
    min_y: float

    max_x: float
    max_y: float

    z_min_m: float
    z_max_m: float

    dx_m: float
    dy_m: float
    dz_m: float

    @property
    def width_m(self) -> float:
        """
        Horizontal domain width along x.
        """

        return (
            self.max_x
            - self.min_x
        )

    @property
    def height_m(self) -> float:
        """
        Horizontal domain height along y.
        """

        return (
            self.max_y
            - self.min_y
        )

    @property
    def vertical_extent_m(self) -> float:
        """
        Vertical domain extent.
        """

        return (
            self.z_max_m
            - self.z_min_m
        )

    @property
    def nx(self) -> int:
        """
        Number of cells along x.
        """

        return _cell_count(
            length_m=self.width_m,
            spacing_m=self.dx_m,
            axis_name="x",
        )

    @property
    def ny(self) -> int:
        """
        Number of cells along y.
        """

        return _cell_count(
            length_m=self.height_m,
            spacing_m=self.dy_m,
            axis_name="y",
        )

    @property
    def nz(self) -> int:
        """
        Number of cells along z.
        """

        return _cell_count(
            length_m=self.vertical_extent_m,
            spacing_m=self.dz_m,
            axis_name="z",
        )

    @property
    def shape_yx(
        self,
    ) -> tuple[int, int]:
        """
        Shape of a horizontal 2D field.
        """

        return (
            self.ny,
            self.nx,
        )

    @property
    def shape_zyx(
        self,
    ) -> tuple[int, int, int]:
        """
        Canonical 3D array shape.
        """

        return (
            self.nz,
            self.ny,
            self.nx,
        )

    @property
    def total_voxels(self) -> int:
        """
        Total number of voxels in the domain.
        """

        return (
            self.nx
            * self.ny
            * self.nz
        )

    @property
    def cell_volume_m3(self) -> float:
        """
        Physical volume of one voxel.
        """

        return (
            self.dx_m
            * self.dy_m
            * self.dz_m
        )

    def x_centers(
        self,
    ) -> np.ndarray:
        """
        Return x coordinates of cell centres.

        Shape
        -----
        (nx,)
        """

        return (
            self.min_x
            + (
                np.arange(
                    self.nx,
                    dtype=np.float64,
                )
                + 0.5
            )
            * self.dx_m
        )

    def y_centers(
        self,
    ) -> np.ndarray:
        """
        Return y coordinates of cell centres.

        y increases from south to north.

        Shape
        -----
        (ny,)
        """

        return (
            self.min_y
            + (
                np.arange(
                    self.ny,
                    dtype=np.float64,
                )
                + 0.5
            )
            * self.dy_m
        )

    def z_centers(
        self,
    ) -> np.ndarray:
        """
        Return z coordinates of voxel centres.

        Shape
        -----
        (nz,)
        """

        return (
            self.z_min_m
            + (
                np.arange(
                    self.nz,
                    dtype=np.float64,
                )
                + 0.5
            )
            * self.dz_m
        )


@dataclass(frozen=True)
class HeightSettings:
    """
    Rules for resolving building height from GIS attributes.

    Priority
    --------
    1. direct_fields
    2. levels_fields * meters_per_level
    3. configured fallback policy
    """

    direct_fields: tuple[str, ...]

    levels_fields: tuple[str, ...]

    meters_per_level: float

    fallback_mode: str

    fallback_height_m: float | None

    minimum_height_m: float

    maximum_height_m: float | None


@dataclass(frozen=True)
class RasterSettings:
    """
    Building rasterization behaviour.
    """

    all_touched: bool

    overlap_rule: str


@dataclass(frozen=True)
class OutputSettings:
    """
    Output paths and serialization settings.
    """

    netcdf_path: Path

    processed_buildings_path: Path | None

    save_processed_buildings: bool

    processed_buildings_crs: str

    netcdf_engine: str

    compression_level: int

    height_dtype: str

    mask_dtype: str


def _cell_count(
    length_m: float,
    spacing_m: float,
    axis_name: str,
) -> int:
    """
    Convert a physical domain length into an exact cell count.

    This function intentionally refuses to round an incompatible
    domain/grid combination.

    Example
    -------
    length = 500 m
    spacing = 5 m

        -> 100 cells

    length = 503 m
    spacing = 5 m

        -> error

    Silent rounding would change the requested physical domain,
    so it is not allowed.
    """

    if not np.isfinite(
        length_m
    ):
        raise ValueError(
            f"Domain length on axis '{axis_name}' "
            "must be finite."
        )

    if not np.isfinite(
        spacing_m
    ):
        raise ValueError(
            f"Grid spacing on axis '{axis_name}' "
            "must be finite."
        )

    if length_m <= 0:
        raise ValueError(
            f"Domain length on axis '{axis_name}' "
            f"must be > 0. Got {length_m}."
        )

    if spacing_m <= 0:
        raise ValueError(
            f"Grid spacing on axis '{axis_name}' "
            f"must be > 0. Got {spacing_m}."
        )

    raw_count = (
        length_m
        / spacing_m
    )

    rounded_count = round(
        raw_count
    )

    if not np.isclose(
        raw_count,
        rounded_count,
        rtol=0.0,
        atol=1e-9,
    ):
        raise ValueError(
            f"Domain length on axis '{axis_name}' "
            f"({length_m} m) is not exactly divisible "
            f"by spacing ({spacing_m} m). "
            f"Result would be {raw_count} cells."
        )

    return int(
        rounded_count
    )