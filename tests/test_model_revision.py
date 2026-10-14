"""A container without .git must still identify the model it ran."""
import pytest
from src.solver import model_version


@pytest.mark.parametrize('revision', ['1488642', '1488642-dirty', 'a' * 40, 'unknown'])
def test_container_revision_is_preserved(monkeypatch, revision):
    monkeypatch.setenv('MODEL_REVISION', revision)
    assert model_version() == f'0.1.0+{revision}'


@pytest.mark.parametrize('revision', ['main', '../main', 'secret value', 'ABC1234'])
def test_invalid_container_revision_is_not_published(monkeypatch, revision):
    monkeypatch.setenv('MODEL_REVISION', revision)
    with pytest.raises(ValueError, match='MODEL_REVISION'):
        model_version()
