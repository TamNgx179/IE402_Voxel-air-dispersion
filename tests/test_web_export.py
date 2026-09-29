"""
netCDF -> web/data export: quantisation error, geolocation, the data contract,
the size budget, and the file:// constraint on the viewer.
"""

from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

import numpy as np
import pytest
import xarray as xr
from pyproj import Transformer

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from analysis import web_export as wx  # noqa: E402
from analysis.fields import ConcentrationField, ContractError, load_field, write_field  # noqa: E402

CONFIG_PATH = REPO_ROOT / "config" / "project.yaml"
VOXEL_PATH = REPO_ROOT / "data" / "processed" / "voxel_grid.nc"
WEB_DIR = REPO_ROOT / "web"

needs_voxels = pytest.mark.skipif(not VOXEL_PATH.exists(), reason="run src/01_voxelize.py first")


# --- AC-7 / EC-3: quantisation ---------------------------------------------

def test_ac7_decoded_values_are_within_two_percent_over_the_whole_scale():
    c_max, decades = 8.3, 4.0
    values = np.logspace(np.log10(c_max) - decades, np.log10(c_max), 20_000)

    decoded = wx.dequantise_log(wx.quantise_log(values, c_max, decades), c_max, decades)

    assert np.max(np.abs(decoded / values - 1.0)) <= 0.02


def test_ac7_code_table_no_data_below_and_top():
    c = np.array([np.nan, 0.0, 1e-9, 10.0])

    codes = wx.quantise_log(c, 10.0, 4.0)

    assert codes.tolist() == [wx.CODE_NO_DATA, wx.CODE_BELOW, wx.CODE_BELOW, wx.CODE_LAST]
    decoded = wx.dequantise_log(codes, 10.0, 4.0)
    assert np.isnan(decoded[0]) and decoded[1] == 0.0 and decoded[3] == pytest.approx(10.0)


def test_ec3_all_zero_field_does_not_divide_by_zero():
    c = np.zeros((3, 3, 3))
    c[0, 0, 0] = np.nan

    codes = wx.quantise_log(c, 0.0, 4.0)

    assert codes[0, 0, 0] == wx.CODE_NO_DATA
    assert (codes.ravel()[1:] == wx.CODE_BELOW).all()


def test_ec3_constant_field_encodes_every_cell_at_the_top():
    codes = wx.quantise_log(np.full((2, 2, 2), 3.0), 3.0, 4.0)

    assert (codes == wx.CODE_LAST).all()


# --- AC-8: geolocation -----------------------------------------------------

def _field_on(crs: str, x0: float, y0: float) -> ConcentrationField:
    return ConcentrationField(
        concentration=np.zeros((2, 100, 100)),
        solid=np.zeros((2, 100, 100), dtype=bool),
        z=np.array([1.0, 3.0]),
        y=y0 + 5.0 * (np.arange(100) + 0.5),
        x=x0 + 5.0 * (np.arange(100) + 0.5),
        crs=crs,
        attrs={},
    )


def test_ac8_corners_match_an_independent_projection():
    field_ = _field_on("EPSG:32648", 686012.54, 1191324.79)

    corners = wx.domain_corners_wgs84(field_)

    to_wgs84 = Transformer.from_crs("EPSG:32648", "EPSG:4326", always_xy=True)
    expected = {
        "sw": (686012.54, 1191324.79),
        "ne": (686512.54, 1191824.79),
        "se": (686512.54, 1191324.79),
        "nw": (686012.54, 1191824.79),
    }
    for name, (x, y) in expected.items():
        np.testing.assert_allclose(corners[name], to_wgs84.transform(x, y), atol=1e-7)


def test_ac8_bilinear_nodes_match_pyproj_at_every_node():
    """What the viewer does in JS: every node within 1e-7 degrees (~1 cm)."""

    field_ = _field_on("EPSG:32648", 686012.54, 1191324.79)
    nodes = wx.bilinear_nodes(wx.domain_corners_wgs84(field_), 100, 100)

    xs = 686012.54 + 5.0 * np.arange(101)
    ys = 1191324.79 + 5.0 * np.arange(101)
    xx, yy = np.meshgrid(xs, ys)
    lon, lat = Transformer.from_crs("EPSG:32648", "EPSG:4326", always_xy=True).transform(xx, yy)

    assert np.max(np.abs(nodes[..., 0] - lon)) < 1e-7
    assert np.max(np.abs(nodes[..., 1] - lat)) < 1e-7


# --- EC-5: the data contract -----------------------------------------------

@needs_voxels
def test_ec5_contract_file_missing_an_attribute_is_refused_by_name(tmp_path):
    with xr.open_dataset(VOXEL_PATH) as voxel:
        grid = ConcentrationField(
            concentration=np.ones(voxel["B"].shape),
            solid=voxel["B"].values.astype(bool),
            z=voxel["z"].values, y=voxel["y"].values, x=voxel["x"].values,
            crs=str(voxel.attrs["model_crs"]),
            attrs={"scenario": "t", "model": "fv", "wind_from_deg": 90.0, "wind_speed_m_s": 1.0},
        )

    path = write_field(grid, tmp_path / "concentration_t.nc")

    with xr.open_dataset(path) as ds:
        broken = ds.load()
    del broken.attrs["wind_speed_m_s"]
    broken.to_netcdf(tmp_path / "broken.nc")

    with pytest.raises(ContractError, match="wind_speed_m_s"):
        load_field(tmp_path / "broken.nc", VOXEL_PATH)


@needs_voxels
def test_contract_round_trip_blanks_buildings(tmp_path):
    with xr.open_dataset(VOXEL_PATH) as voxel:
        solid = voxel["B"].values.astype(bool)
        grid = ConcentrationField(
            concentration=np.full(solid.shape, 2.5),
            solid=solid,
            z=voxel["z"].values, y=voxel["y"].values, x=voxel["x"].values,
            crs=str(voxel.attrs["model_crs"]),
            attrs={"scenario": "t", "model": "fv", "wind_from_deg": 90.0, "wind_speed_m_s": 1.0},
        )

    loaded = load_field(write_field(grid, tmp_path / "c.nc"), VOXEL_PATH)

    assert np.isnan(loaded.concentration[solid]).all()
    np.testing.assert_allclose(loaded.concentration[~solid], 2.5)


@needs_voxels
def test_contract_wrong_units_are_refused(tmp_path):
    with xr.open_dataset(VOXEL_PATH) as voxel:
        ds = xr.Dataset(
            {"C": (("z", "y", "x"), np.zeros(voxel["B"].shape), {"units": "kg m-3"})},
            coords={name: voxel[name].values for name in ("z", "y", "x")},
            attrs={"scenario": "t", "model": "fv", "wind_from_deg": 1.0, "wind_speed_m_s": 1.0},
        )
    ds.to_netcdf(tmp_path / "bad_units.nc")

    with pytest.raises(ContractError, match="units"):
        load_field(tmp_path / "bad_units.nc", VOXEL_PATH)


# --- EC-6: the viewer must not need a server -------------------------------

def test_ec6_viewer_loads_data_by_script_tag_never_fetch():
    app = (WEB_DIR / "app.js").read_text(encoding="utf-8")
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")

    assert "fetch(" not in app and "XMLHttpRequest" not in app
    for name in ("manifest.js", "buildings.js", "roads.js"):
        assert f'src="./data/{name}"' in html


def test_viewer_pins_exact_library_versions():
    html = (WEB_DIR / "index.html").read_text(encoding="utf-8")

    versions = re.findall(r"(maplibre-gl|deck\.gl)@([^/\"]+)", html)
    assert versions, "no CDN library found"
    for _, version in versions:
        assert re.fullmatch(r"\d+\.\d+\.\d+", version), f"unpinned version {version!r}"


# --- AC-7 end to end: the committed export ---------------------------------

def _read_global(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    body = text[text.index("=") + 1 :].strip().rstrip(";")
    return json.loads(body)


@pytest.mark.skipif(not (WEB_DIR / "data" / "manifest.js").exists(), reason="run src/06_export_web.py first")
def test_ac7_exported_package_is_under_budget_and_decodes():
    import yaml

    budget = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))["web"]["size_budget_bytes"]
    files = list((WEB_DIR / "data").glob("*.js"))
    assert sum(f.stat().st_size for f in files) < budget

    manifest = _read_global(WEB_DIR / "data" / "manifest.js")
    grid = manifest["grid"]

    for entry in manifest["scenarios"]:
        text = (WEB_DIR / "data" / entry["file"]).read_text(encoding="utf-8")
        payload = json.loads(text[text.rindex("] = ") + 4 :].strip().rstrip(";"))
        codes = np.frombuffer(base64.b64decode(payload["codes_base64"]), dtype=np.uint8)

        assert codes.size == grid["nx"] * grid["ny"] * grid["nz"]
        assert codes.max() == wx.CODE_LAST  # the maximum is on the scale
        assert len(payload["layer_mean_ug_m3"]) == grid["nz"]
