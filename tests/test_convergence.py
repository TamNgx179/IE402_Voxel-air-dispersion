import numpy as np
import pytest
from src.convergence import SteadyStateMonitor


@pytest.mark.parametrize('minimum_s,expected_exit',[(100,3),(0,0)])
def test_cli_persists_convergence_gate_and_refuses_unconverged_run(tmp_path,minimum_s,expected_exit):
    import json
    import subprocess
    import sys
    import uuid
    import yaml
    from src.benchmark_solver import _fixture,REPO_ROOT
    template,_=_fixture(tmp_path,REPO_ROOT/'config/project.yaml')
    config=yaml.safe_load(template.read_text(encoding='utf-8'))
    run_id=str(uuid.uuid4()); out=tmp_path/'run'
    config['run']={'run_id':run_id,'scenario_id':'dry_nov_apr','model':'fv'}
    config['wind']['poisson_method']='cg'
    config['transport'].update(stopping_criterion='steady_state',implementation='sparse',max_simulated_s=4,
        steady_state={'interval_s':1,'minimum_s':minimum_s,'tolerance':1,'required_checks':2})
    snapshot=out/'config.yaml'; snapshot.write_text(yaml.safe_dump(config),encoding='utf-8')
    process=subprocess.run([sys.executable,'-m','src.solver','run','--run-id',run_id,'--config',str(snapshot),'--out',str(out)],
        cwd=REPO_ROOT,capture_output=True,text=True,timeout=60)
    assert process.returncode==expected_exit,process.stderr
    manifest=json.loads((out/'manifest.json').read_text(encoding='utf-8'))
    assert manifest['stopping']['criterion']=='steady_state'
    assert manifest['verification']['checks']['steady_state']['status']==('pass' if expected_exit==0 else 'fail')


def test_requires_multiple_checks_and_minimum_time():
    m = SteadyStateMonitor(interval_s=1, minimum_s=4, required_checks=2)
    a = np.ones((2, 2, 2)) * 1e-14
    assert not m.observe(a, 1)
    assert not m.observe(a, 2)
    assert not m.observe(a, 3)
    assert not m.observe(a, 4)
    assert m.observe(a, 5)


def test_scale_independent_and_reset_on_change():
    for scale in (1e-14, 100):
        m = SteadyStateMonitor(interval_s=1, minimum_s=0, required_checks=2)
        a = np.ones((2,2,2)) * scale
        assert not m.observe(a,1)
        assert not m.observe(a,2)
        assert not m.observe(a*2,3)
        assert m.consecutive == 0
        assert not m.observe(a*2,4)
        assert m.observe(a*2,5)


def test_rejects_invalid_settings_and_nonfinite():
    with pytest.raises(ValueError):
        SteadyStateMonitor(tolerance=0)
    with pytest.raises(ValueError):
        SteadyStateMonitor().observe(np.array([np.nan]),31)
