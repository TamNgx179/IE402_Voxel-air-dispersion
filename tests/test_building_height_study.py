"""A roof alternative must change occupancy without moving or rescaling sources."""
import copy
import json

import numpy as np
import pandas as pd
import pytest
import xarray as xr

from scripts.benchmark_building_heights import prepare_variant
from src.solver import sha256, solid_mask


def fixture(tmp_path):
    scene = tmp_path / 'scene'
    scene.mkdir()
    pd.DataFrame([['tower', 3.0, 'gob:building_height', 'POLYGON((0 0,5 0,5 5,0 5,0 0))']],
                 columns=['source_feature_id', 'height_m', 'height_source', 'wkt']).to_csv(scene/'buildings.csv', index=False)
    pd.DataFrame([[0, 0, 0, 0, 'POLYGON((0 0,5 0,5 5,0 5,0 0))'],
                  [1, 0, None, None, 'POLYGON((5 0,10 0,10 5,5 5,5 0))']],
                 columns=['i','j','solid_from_k','solid_to_k','wkt']).to_csv(scene/'grid_cells.csv', index=False)
    grid = dict(nx=2,ny=1,nz=2,dx_m=5,dy_m=5,dz_m=2,origin_x_m=0,origin_y_m=0)
    manifest = {'grid':grid,'files':{n:sha256(scene/n)for n in ['buildings.csv','grid_cells.csv']}}
    (scene/'scene_manifest.json').write_text(json.dumps(manifest))
    source=tmp_path/'source.nc'
    xr.DataArray(np.array([[[0., 7.]],[[0.,0.]]]),dims=('z','y','x'),
                 coords={'z':[1,3],'y':[2.5],'x':[2.5,7.5]},attrs={'units':'kg m-3 s-1'}).to_dataset(name='S').to_netcdf(source)
    return {'paths':{'scene_package_dir':str(scene),'emission_source_transport_netcdf':str(source)},
            'domain':{'vertical':{'max_m':4}},'voxelization':{'rasterization':{'all_touched':False}}}


def test_height_alternative_preserves_source_and_footprint(tmp_path):
    original=fixture(tmp_path)
    for name,heights in [('baseline',{}),('alternative',{'tower':7.0})]:
        config=copy.deepcopy(original);out=tmp_path/name;out.mkdir()
        prepare_variant(config,out,heights,top_m=8)
        manifest=json.loads((out/'scene/scene_manifest.json').read_text())
        mask=solid_mask(out/'scene/grid_cells.csv',manifest['grid'])
        assert mask[:,0,0].tolist()==([True,True,True,False]if heights else[True,False,False,False])
        assert not mask[:,0,1].any()
        with xr.open_dataset(out/'source.nc') as source:
            assert source.S.values[:,0,1].tolist()==[7,0,0,0]
            assert source.S.attrs['units']=='kg m-3 s-1'
        assert manifest['files']['grid_cells.csv']==sha256(out/'scene/grid_cells.csv')
    assert json.loads((tmp_path/'scene/scene_manifest.json').read_text())['grid']['nz']==2


@pytest.mark.parametrize('heights,top', [({'unknown':5},8),({'tower':float('nan')},8),
                                      ({'tower':8},8),({'tower':True},8),({'tower':7},7)])
def test_invalid_alternative_is_rejected_before_source_copy(tmp_path,heights,top):
    config=fixture(tmp_path);out=tmp_path/'out';out.mkdir()
    with pytest.raises(ValueError):prepare_variant(config,out,heights,top_m=top)
    assert not (out/'scene').exists()
