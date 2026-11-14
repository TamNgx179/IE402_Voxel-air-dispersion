import json

import numpy as np
import xarray as xr

from src.production_study import extend_top


def test_extending_top_preserves_existing_source_and_occupancy(tmp_path):
    scene = tmp_path / 'scene'
    scene.mkdir()
    manifest = {'grid': {'nz': 2, 'dz_m': 2}, 'files': {'grid_cells.csv': 'unchanged'}}
    (scene / 'scene_manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    cells = b'i,j,solid_from_k,solid_to_k\n0,0,0,0\n'
    (scene / 'grid_cells.csv').write_bytes(cells)
    source = tmp_path / 'source.nc'
    xr.DataArray(np.array([[[5.]], [[0.]]]), dims=('z', 'y', 'x'), coords={'z': [1, 3]},
                 attrs={'units': 'kg m-3 s-1'}).to_dataset(name='S').to_netcdf(source)
    config = {'paths': {'scene_package_dir': str(scene), 'emission_source_transport_netcdf': str(source)},
              'domain': {'vertical': {'max_m': 4}}}
    out = tmp_path / 'out'
    out.mkdir()
    extend_top(config, out, extra_layers=2)
    assert config['domain']['vertical']['max_m'] == 8
    assert (out / 'scene' / 'grid_cells.csv').read_bytes() == cells
    with xr.open_dataset(out / 'source.nc') as extended:
        assert extended.z.values.tolist() == [1, 3, 5, 7]
        assert extended.S.values.ravel().tolist() == [5, 0, 0, 0]
        assert extended.S.attrs['units'] == 'kg m-3 s-1'
