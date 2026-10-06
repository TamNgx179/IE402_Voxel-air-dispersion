import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ROOT } from '../config/env.validation.js';
import { loadScenePackage, ScenePackageError } from './scene-package.js';

const FIXTURE = join(APP_ROOT, 'test', 'fixtures', 'scene');

describe('loadScenePackage', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voxel-scene-'));
    cpSync(FIXTURE, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads the fixture package', async () => {
    const scene = await loadScenePackage(FIXTURE);
    expect(scene.manifest.study_area.srid).toBe(32648);
    expect(scene.buildings).toHaveLength(2);
    expect(scene.roads).toHaveLength(1);
    expect(scene.water).toHaveLength(0);
    expect(scene.green).toHaveLength(1);
    expect(scene.gridCells).toHaveLength(4);
    expect(scene.gridCells.find((c) => c.i === 1 && c.j === 0)).toMatchObject({
      solid_from_k: null,
      solid_to_k: null,
    });
    expect(scene.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a file whose checksum does not match', async () => {
    writeFileSync(
      join(dir, 'roads.csv'),
      readFileSync(join(dir, 'roads.csv'), 'utf8').replace(
        'primary',
        'tertiar',
      ),
    );
    await expect(loadScenePackage(dir)).rejects.toThrow(
      /checksum mismatch for roads\.csv/,
    );
  });

  it('refuses a package whose manifest lacks a required file', async () => {
    const m = JSON.parse(
      readFileSync(join(dir, 'scene_manifest.json'), 'utf8'),
    );
    delete m.files['green.csv'];
    writeFileSync(join(dir, 'scene_manifest.json'), JSON.stringify(m));
    await expect(loadScenePackage(dir)).rejects.toThrow(
      /files\.green\.csv is missing/,
    );
  });

  it('refuses counts that do not match the CSV', async () => {
    const m = JSON.parse(
      readFileSync(join(dir, 'scene_manifest.json'), 'utf8'),
    );
    m.counts.buildings = 3;
    writeFileSync(join(dir, 'scene_manifest.json'), JSON.stringify(m));
    await expect(loadScenePackage(dir)).rejects.toThrow(
      /counts\.buildings = 3/,
    );
  });

  it('accepts "sha256:" prefixed digests', async () => {
    const m = JSON.parse(
      readFileSync(join(dir, 'scene_manifest.json'), 'utf8'),
    );
    for (const k of Object.keys(m.files)) m.files[k] = `sha256:${m.files[k]}`;
    writeFileSync(join(dir, 'scene_manifest.json'), JSON.stringify(m));
    await expect(loadScenePackage(dir)).resolves.toBeTruthy();
  });

  it('fails with a clear message when the package does not exist', async () => {
    const missing = join(dir, 'nope');
    await expect(loadScenePackage(missing)).rejects.toThrow(ScenePackageError);
    await expect(loadScenePackage(missing)).rejects.toThrow(
      /scene_manifest\.json not found.*07_export_scene/,
    );
  });
});
