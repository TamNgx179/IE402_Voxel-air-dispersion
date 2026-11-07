"""B8.4: immutable source, canonical identity and paired scientific statistics."""
from pathlib import Path
import uuid
import numpy as np
import pytest
import xarray as xr
import yaml
from src.source_scenarios import emission_multiplier
from src.solver import load_inputs, load_transport_source, SolverError
from src.source_reduction_study import paired_metrics, physics_signature, artifact_filename


@pytest.mark.parametrize('value', [None, True, False, '0.8', 0, -1, 1.2, 0.7, float('nan'), float('inf')])
def test_multiplier_rejects_coercion_or_unsupported_presets(value):
    with pytest.raises(ValueError):
        emission_multiplier({'run':{'emission_multiplier':value}})


def test_source_is_scaled_before_transport_without_modifying_original(tmp_path):
    source = np.array([[[0, 2e-12],[4e-12,0]]],dtype=float)
    path = tmp_path/'source.nc'
    xr.Dataset({'S':(('z','y','x'),source,{'units':'kg m-3 s-1'})}).to_netcdf(path)
    before = path.read_bytes()
    for multiplier in (1,.8,.6):
        got = load_transport_source({'config':{'paths':{'emission_source_transport_netcdf':str(path)},
            'run':{'emission_multiplier':multiplier}}}, np.zeros(source.shape,dtype=bool))
        np.testing.assert_array_equal(got,source*multiplier)
        assert path.read_bytes()==before


def test_default_and_explicit_baseline_keep_hash_reductions_change_it(tmp_path):
    root = Path(__file__).resolve().parents[1]
    config = yaml.safe_load((root/'config/project.yaml').read_text(encoding='utf-8'))
    run_id = str(uuid.uuid4())
    config['run']={'run_id':run_id,'scenario_id':'dry_nov_apr','model':'fv'}
    path = tmp_path/'config.yaml'
    def load():
        path.write_text(yaml.safe_dump(config),encoding='utf-8')
        return load_inputs(path,run_id)
    original = load()
    config['run']['emission_multiplier']=1
    assert load()['input_hash']==original['input_hash']
    hashes={original['input_hash']}
    for value in (.8,.6):
        config['run']['emission_multiplier']=value
        hashes.add(load()['input_hash'])
    assert len(hashes)==3
    config['run']['model']='gaussian'
    with pytest.raises(SolverError,match='fv only'):
        load()


def test_paired_metrics_preserve_zero_and_solid_exclude_ratio_at_zero():
    a=np.array([[[0.,2.,np.nan],[4.,8.,1.]]])
    result=paired_metrics(a,a*.8,.8)
    assert result['air_voxels']==5
    assert result['zero_baseline_voxels']==1
    assert result['linearity_linf_relative_to_baseline_max']==0
    assert result['mean_delta_ug_m3']==pytest.approx(-.6)
    b=a.copy(); b[0,0,2]=0
    with pytest.raises(ValueError,match='masks'):
        paired_metrics(a,b,.8)
    with pytest.raises(ValueError,match='No paired'):
        paired_metrics(np.array([np.nan]),np.array([np.nan]),.8)


def test_physics_signature_only_ignores_run_identity_and_source_preset():
    date=yaml.safe_load('date: 2026-11-07')['date']
    base={'run':{'run_id':'one','scenario_id':'dry','emission_multiplier':1},'K':1,'date':date}
    reduced={'run':{'run_id':'two','scenario_id':'dry','emission_multiplier':.8},'K':1,'date':date}
    assert physics_signature(base)==physics_signature(reduced)
    reduced['K']=2
    assert physics_signature(base)!=physics_signature(reduced)


def test_artifact_uses_manifest_filename_not_a_name_inferred_from_kind():
    assert artifact_filename({'artifacts':[{'kind':'wind_vectors','path':'wind-vectors.json'}]},'wind_vectors')=='wind-vectors.json'
    for name in ('../wind.json','x/y','x\\y','C:wind','..'):
        with pytest.raises(ValueError,match='Unsafe'):
            artifact_filename({'artifacts':[{'kind':'wind_vectors','path':name}]},'wind_vectors')
    with pytest.raises(ValueError,match='Missing/duplicate'):
        artifact_filename({'artifacts':[]},'wind_vectors')
