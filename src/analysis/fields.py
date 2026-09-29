"""
The data contract between the model (person B) and analysis/web (person A).

A concentration file is `output/netcdf/concentration_<scenario>.nc` holding

    C          float32 [z, y, x], ug m-3
    z, y, x    cell centres in metres, CRS of voxel_grid.nc
    attrs      scenario, model, wind_from_deg, wind_speed_m_s

The contract is what lets either side change its code without breaking the
other: the web never reads a solver, only this file.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import xarray as xr

CONTRACT_VARIABLE = "C"
CONTRACT_UNITS = "ug m-3"
REQUIRED_ATTRS = ("scenario", "model", "wind_from_deg", "wind_speed_m_s")


class ContractError(ValueError):
    """A concentration file does not satisfy the data contract."""


@dataclass
class ConcentrationField:
    """One scenario's concentration on the voxel grid, plus the grid itself."""

    concentration: np.ndarray       # [z, y, x], ug m-3, NaN in solids
    solid: np.ndarray               # [z, y, x] bool
    z: np.ndarray
    y: np.ndarray
    x: np.ndarray
    crs: str
    attrs: dict[str, Any] = field(default_factory=dict)

    @property
    def spacing(self) -> tuple[float, float, float]:
        """(dz, dy, dx) in metres."""

        return (
            float(self.z[1] - self.z[0]),
            float(self.y[1] - self.y[0]),
            float(self.x[1] - self.x[0]),
        )

    @property
    def scenario(self) -> str:
        return str(self.attrs["scenario"])


def _crs_of(dataset: xr.Dataset) -> str:
    crs = dataset.attrs.get("model_crs")

    if not crs:
        raise ContractError("dataset carries no model_crs attribute")

    return str(crs)


def load_field(
    path: str | Path,
    voxel_path: str | Path,
    *,
    variable: str = CONTRACT_VARIABLE,
    metadata: dict[str, Any] | None = None,
) -> ConcentrationField:
    """
    Read a concentration file against the voxel grid it was computed on.

    `metadata` fills contract attributes a file does not carry (the Gaussian
    baseline, for one, records no scenario). Whatever is still missing after
    that is refused by name (EC-5), never defaulted.
    """

    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(f"concentration file not found: {path}")

    with xr.open_dataset(voxel_path) as voxel:
        solid = voxel["B"].values.astype(bool)
        grid = (voxel["z"].values, voxel["y"].values, voxel["x"].values)
        crs = _crs_of(voxel)

    with xr.open_dataset(path) as dataset:
        if variable not in dataset:
            raise ContractError(
                f"{path.name}: variable {variable!r} not found "
                f"(has {sorted(dataset.data_vars)})"
            )

        data = dataset[variable]

        if tuple(data.dims) != ("z", "y", "x"):
            raise ContractError(f"{path.name}: {variable} must be [z, y, x], got {data.dims}")

        units = str(data.attrs.get("units", "")).replace("µ", "u").strip()

        if units != CONTRACT_UNITS:
            raise ContractError(f"{path.name}: {variable} units must be {CONTRACT_UNITS!r}, got {units!r}")

        for name, expected in zip(("z", "y", "x"), grid):
            if not np.allclose(dataset[name].values, expected):
                raise ContractError(f"{path.name}: coordinate {name} does not match the voxel grid")

        attrs = {**dict(dataset.attrs), **(metadata or {})}
        concentration = data.values.astype(float)

    missing = [name for name in REQUIRED_ATTRS if name not in attrs]

    if missing:
        raise ContractError(f"{path.name}: missing required attribute(s) {', '.join(missing)}")

    concentration[solid] = np.nan

    return ConcentrationField(
        concentration=concentration,
        solid=solid,
        z=np.asarray(grid[0], dtype=float),
        y=np.asarray(grid[1], dtype=float),
        x=np.asarray(grid[2], dtype=float),
        crs=crs,
        attrs=attrs,
    )


def write_field(field_: ConcentrationField, path: str | Path, extra_attrs: dict[str, Any] | None = None) -> Path:
    """Write a field in contract form."""

    missing = [name for name in REQUIRED_ATTRS if name not in field_.attrs]

    if missing:
        raise ContractError(f"cannot write: missing required attribute(s) {', '.join(missing)}")

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)

    dataset = xr.Dataset(
        {
            CONTRACT_VARIABLE: (
                ("z", "y", "x"),
                field_.concentration.astype(np.float32),
                {"units": CONTRACT_UNITS, "long_name": "PM2.5 concentration (traffic contribution)"},
            )
        },
        coords={
            "z": ("z", field_.z, {"units": "m", "positive": "up", "long_name": "cell-centre height"}),
            "y": ("y", field_.y, {"units": "m", "standard_name": "projection_y_coordinate"}),
            "x": ("x", field_.x, {"units": "m", "standard_name": "projection_x_coordinate"}),
        },
        attrs={
            "conventions": "CF-1.10",
            "grid_order": "z,y,x",
            "model_crs": field_.crs,
            **{key: value for key, value in field_.attrs.items() if isinstance(value, (str, int, float))},
            **(extra_attrs or {}),
        },
    )

    encoding = {CONTRACT_VARIABLE: {"zlib": True, "complevel": 4}}
    dataset.to_netcdf(destination, engine="netcdf4", encoding=encoding)

    return destination
