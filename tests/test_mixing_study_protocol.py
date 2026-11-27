"""Scientific comparisons must vary mixing without also varying the time step."""
from types import SimpleNamespace

import numpy as np
import pytest

from scripts import fv_study_support
from scripts.fv_study_support import mixing_protocol, stable_dt, transport


def test_mixing_variants_share_stable_steps_and_preserve_mass():
    shape = (3, 3, 4)
    wind = SimpleNamespace(
        uf=np.ones((3, 3, 5)), vf=np.zeros((3, 4, 4)), wf=np.zeros((4, 3, 4)),
    )
    variants, dt = mixing_protocol(wind, 0.2, (1.0, 1.0, 1.0))
    assert set(variants) == {0.5, 1.0, 2.0}
    solid = np.zeros(shape, dtype=bool)
    source = np.zeros(shape)
    source[0, 1, 1] = 1.0
    steps = []
    for factor, mixing in variants.items():
        assert mixing == (factor * 0.2, 0.2, 0.2)
        assert dt <= stable_dt(wind, mixing, (1.0, 1.0, 1.0))
        fields, ledger = transport(wind, source, solid, mixing, (1.0, 1.0, 1.0),
                                   seconds=1, dt=dt, checkpoints=2)
        steps.append(ledger['steps'])
        assert ledger['relative_mass_error'] < 1e-12
        assert np.isfinite(fields[-1]).all()
        assert fields[-1].min() >= 0
    assert len(set(steps)) == 1


@pytest.mark.parametrize('diffusivity', [0, -1, float('nan'), float('inf')])
def test_mixing_protocol_rejects_invalid_diffusivity(diffusivity):
    with pytest.raises(ValueError, match='diffusivity'):
        mixing_protocol(None, diffusivity, (1.0, 1.0, 1.0))


def unit_case():
    shape = (3, 3, 4)
    wind = SimpleNamespace(
        uf=np.ones((3, 3, 5)), vf=np.zeros((3, 4, 4)), wf=np.zeros((4, 3, 4)),
    )
    source = np.zeros(shape)
    source[0, 1, 1] = 1.0
    return wind, source, np.zeros(shape, dtype=bool)


def test_reported_steps_match_every_step_taken(monkeypatch):
    # linspace(0, 1, 4) gives intervals differing in the last bit; with
    # dt == 1/6 a per-interval ceil took 2 steps in one and 3 in another.
    wind, source, solid = unit_case()
    taken = []
    original = fv_study_support.SparseFVStepper.step

    def record(self, field, dt, ledger):
        taken.append(dt)
        return original(self, field, dt, ledger)

    monkeypatch.setattr(fv_study_support.SparseFVStepper, 'step', record)
    dt = (1 / 3) / 2
    assert dt <= stable_dt(wind, (0.2,) * 3, (1.0, 1.0, 1.0))
    fields, ledger = transport(wind, source, solid, (0.2,) * 3, (1.0, 1.0, 1.0),
                               seconds=1, dt=dt, checkpoints=3)
    assert len(fields) == 3
    assert ledger['steps'] == len(taken) == 6
    assert set(taken) == {ledger['dt_s']}
    assert ledger['dt_s'] <= dt
    assert np.isclose(sum(taken), 1)


@pytest.mark.parametrize('kwargs', [dict(seconds=0), dict(seconds=float('nan')),
                                    dict(dt=0), dict(checkpoints=0), dict(checkpoints=1.5)])
def test_transport_rejects_invalid_schedule(kwargs):
    wind, source, solid = unit_case()
    options = dict(seconds=1, dt=0.1, checkpoints=1) | kwargs
    with pytest.raises(ValueError):
        transport(wind, source, solid, (0.2,) * 3, (1.0, 1.0, 1.0), **options)


def test_transport_rejects_source_without_emission():
    # A zero source used to fail with a bare ZeroDivisionError in the budget.
    wind, source, solid = unit_case()
    with pytest.raises(ValueError, match='emit'):
        transport(wind, source * 0, solid, (0.2,) * 3, (1.0, 1.0, 1.0), seconds=1, dt=0.1)
