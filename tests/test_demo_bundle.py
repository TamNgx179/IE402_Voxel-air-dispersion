"""Offline demo must refuse corrupted inputs before writing anything."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

import pytest

from src.demo_bundle import EXPECTED, ROOT, inspect_bundle, install, safe_destination


@pytest.fixture
def bundle_copy(tmp_path):
    bundle = tmp_path / 'bundle'
    shutil.copytree(ROOT / 'deploy/demo-inputs', bundle)
    scene = tmp_path / 'db/seeds/scene'
    scene.mkdir(parents=True)
    shutil.copy2(ROOT / 'db/seeds/scene/scene_manifest.json', scene)
    return bundle, tmp_path


def write_manifest(bundle, manifest):
    (bundle / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')


def test_committed_bundle_matches_scene_and_bytes():
    manifest, files = inspect_bundle(ROOT / 'deploy/demo-inputs')
    assert set(files) == set(EXPECTED)
    assert manifest['provenance']['sector_code'] == 'TRO'
    assert manifest['provenance']['year'] == 2022


def test_install_into_empty_root_is_idempotent(bundle_copy):
    bundle, root = bundle_copy
    first = install(bundle, root)
    assert sorted(first['installed']) == sorted(EXPECTED.values())
    assert install(bundle, root)['installed'] == []
    manifest, files = inspect_bundle(bundle, root)
    for name, data in files.items():
        assert (root / manifest['files'][name]['destination']).read_bytes() == data


def test_install_refuses_existing_different_inputs_without_partial_write(bundle_copy):
    bundle, root = bundle_copy
    existing = root / EXPECTED['emission_source_transport.nc']
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b'local science input')
    with pytest.raises(ValueError, match='Refusing to replace'):
        install(bundle, root)
    assert existing.read_bytes() == b'local science input'
    assert not (root / EXPECTED['voxel_grid.nc']).exists()


def test_corrupt_archive_is_rejected(bundle_copy):
    bundle, root = bundle_copy
    with (bundle / 'inputs.zip').open('ab') as handle:
        handle.write(b'corruption')
    with pytest.raises(ValueError, match='archive checksum'):
        install(bundle, root)
    assert not (root / 'data').exists()


def test_scene_change_is_rejected(bundle_copy):
    bundle, root = bundle_copy
    (root / 'db/seeds/scene/scene_manifest.json').write_text('{}')
    with pytest.raises(ValueError, match='geometry'):
        install(bundle, root)


@pytest.mark.parametrize('relative', ['../escape.nc', '/tmp/escape.nc', 'C:/escape.nc', r'data\escape.nc'])
def test_destinations_cannot_escape_root(tmp_path, relative):
    with pytest.raises(ValueError, match='Unsafe'):
        safe_destination(tmp_path, relative)


def test_manifest_cannot_redirect_output(bundle_copy):
    bundle, root = bundle_copy
    manifest = json.loads((bundle / 'manifest.json').read_text())
    manifest['files']['voxel_grid.nc']['destination'] = 'app/package.json'
    write_manifest(bundle, manifest)
    with pytest.raises(ValueError, match='destination'):
        install(bundle, root)


def test_file_digest_is_checked_even_with_valid_archive_digest(bundle_copy):
    bundle, root = bundle_copy
    manifest = json.loads((bundle / 'manifest.json').read_text())
    manifest['files']['voxel_grid.nc']['sha256'] = '0' * 64
    write_manifest(bundle, manifest)
    with pytest.raises(ValueError, match='file checksum'):
        install(bundle, root)


def test_duplicate_zip_member_is_rejected(bundle_copy):
    bundle, root = bundle_copy
    archive = bundle / 'inputs.zip'
    with zipfile.ZipFile(archive, 'a') as handle:
        with pytest.warns(UserWarning, match='Duplicate name'):
            handle.writestr('voxel_grid.nc', b'duplicate')
    manifest = json.loads((bundle / 'manifest.json').read_text())
    manifest['archive_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
    write_manifest(bundle, manifest)
    with pytest.raises(ValueError, match='duplicate'):
        install(bundle, root)
