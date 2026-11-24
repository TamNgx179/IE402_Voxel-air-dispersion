"""Scientific comparisons must vary mixing without also varying the time step."""
from types import SimpleNamespace

import numpy as np
import pytest

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
