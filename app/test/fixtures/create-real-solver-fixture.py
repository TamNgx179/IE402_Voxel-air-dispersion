"""Create a small physical input fixture for the real executor E2E test."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import xarray as xr
import yaml


root = Path(sys.argv[1]).resolve()
base_config = Path(sys.argv[2]).resolve()
scene = base_config.parent.parent / "app" / "test" / "fixtures" / "scene"
source = np.zeros((4, 2, 2), dtype=np.float64)
# The other two columns are solid in the committed PostGIS fixture.
source[0, 0, 1] = 5e-13
source[0, 1, 0] = 5e-13
source_path = root / "source.nc"
xr.Dataset({"S": (("z", "y", "x"), source, {"units": "kg m-3 s-1"})}).to_netcdf(source_path)
config = yaml.safe_load(base_config.read_text(encoding="utf-8"))
config["paths"]["scene_package_dir"] = str(scene)
config["paths"]["emission_source_transport_netcdf"] = str(source_path)
config["transport"]["max_simulated_s"] = 5.0
destination = root / "project.yaml"
destination.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
print(destination)
