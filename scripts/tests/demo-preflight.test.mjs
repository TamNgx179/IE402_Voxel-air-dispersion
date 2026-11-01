import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyScene, verifyApi } from '../demo-preflight.mjs';

async function sceneFixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'voxel-demo-preflight-'));
  try {
    const dir = join(root, 'db/seeds/scene');
    await mkdir(dir, { recursive: true });
    const data = 'id,height_m\n1,10\n';
    const manifest = { files: { 'buildings.csv': createHash('sha256').update(data).digest('hex') },
      counts: { buildings: 1 }, grid: { nx: 2, ny: 2, nz: 4 } };
    await writeFile(join(dir, 'buildings.csv'), data);
    await writeFile(join(dir, 'scene_manifest.json'), JSON.stringify(manifest));
    await action(root, dir, manifest);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('scene check verifies bytes without modifying files', () => sceneFixture(async (root, dir) => {
  const before = await readFile(join(dir, 'buildings.csv'));
  const report = await verifyScene(root);
  assert.equal(report.file_count, 1);
  assert.equal(report.counts.buildings, 1);
  assert.deepEqual(await readFile(join(dir, 'buildings.csv')), before);
}));
test('changed scene refuses checksum instead of relocking it', () => sceneFixture(async (root, dir) => {
  const before = await readFile(join(dir, 'scene_manifest.json'));
  await writeFile(join(dir, 'buildings.csv'), 'tampered');
  await assert.rejects(verifyScene(root), /Checksum scene/);
  assert.deepEqual(await readFile(join(dir, 'scene_manifest.json')), before);
}));
test('scene refuses traversal outside packaged directory', () => sceneFixture(async (root, dir, manifest) => {
  await writeFile(join(root, 'outside.csv'), 'secret');
  manifest.files = { '../../../outside.csv': '0'.repeat(64) };
  await writeFile(join(dir, 'scene_manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyScene(root), /ngoài thư mục/);
}));
test('missing scene inventory is not accepted', () => sceneFixture(async (root, dir) => {
  await writeFile(join(dir, 'scene_manifest.json'), '{}');
  await assert.rejects(verifyScene(root), /thiếu danh sách/);
}));

const healthy = () => ({ status: 'ok', database: { status: 'up', password: 'do-not-export' },
  python: { ok: true, version: 'Python 3.12', bin: '/private/python' },
  artifactDir: { exists: true, writable: true, path: '/private/artifacts' } });
function api(health, areas = [{}], scenarios = [{}]) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([url.pathname, options.method]);
    return Response.json({ '/api/health': health, '/api/study-areas': areas, '/api/scenarios': scenarios }[url.pathname]);
  };
  return { fetcher, calls };
}
test('API probe only reads and exports safe health fields', async () => {
  const { fetcher, calls } = api(healthy());
  const report = await verifyApi('http://127.0.0.1:3001', fetcher);
  assert.equal(report.study_area_count, 1);
  assert.deepEqual(calls, [['/api/health', 'GET'], ['/api/study-areas', 'GET'], ['/api/scenarios', 'GET']]);
  assert.doesNotMatch(JSON.stringify(report), /private|password|do-not-export/);
});
for (const [name, alter] of [
  ['HTTP 200 degraded', (h) => { h.status = 'degraded'; }],
  ['unconfigured database despite ok status', (h) => { h.database.status = 'not_configured'; }],
  ['unavailable Python', (h) => { h.python.ok = false; }],
  ['unwritable artifacts', (h) => { h.artifactDir.writable = false; }],
]) test(`API refuses ${name}`, async () => {
  const h = healthy(); alter(h);
  const { fetcher, calls } = api(h);
  await assert.rejects(verifyApi('http://localhost', fetcher), /chưa sẵn sàng/);
  assert.equal(calls.length, 1);
});
test('API refuses missing seed data', async () => {
  for (const [areas, scenarios] of [[[], [{}]], [[{}], []]])
    await assert.rejects(verifyApi('http://localhost', api(healthy(), areas, scenarios).fetcher), /migration và seed/);
});
test('demo API must match local scene hash, grid and actual feature counts', async () => {
  const expected = { manifest_sha256: 'abc', grid: { nx: 100 }, counts: { buildings: 1, roads: 0, water: 0, green: 0 } };
  const area = { id: 'demo', provenance: { scene_manifest_sha256: 'abc' }, grid: { nx: 100 } };
  const scene = Object.fromEntries(['buildings', 'roads', 'water', 'green'].map((layer) =>
    [layer, { features: layer === 'buildings' ? [{}] : [] }]));
  const fetcher = async (url) => Response.json({ '/api/health': healthy(), '/api/study-areas': [area],
    '/api/scenarios': [{}], '/api/study-areas/demo/scene': scene }[url.pathname]);
  await verifyApi('http://localhost', fetcher, expected);
  area.provenance.scene_manifest_sha256 = 'old';
  await assert.rejects(verifyApi('http://localhost', fetcher, expected), /Scene hoặc lưới/);
  area.provenance.scene_manifest_sha256 = 'abc';
  area.grid.nx = 2;
  await assert.rejects(verifyApi('http://localhost', fetcher, expected), /Scene hoặc lưới/);
  area.grid.nx = 100;
  scene.buildings.features = [];
  await assert.rejects(verifyApi('http://localhost', fetcher, expected), /buildings.*số lượng/);
});
test('API handles HTTP and connection failures', async () => {
  await assert.rejects(verifyApi('http://localhost', async () => new Response('', { status: 503 })), /HTTP 503/);
  await assert.rejects(verifyApi('http://localhost', async () => { throw new Error('secret connection details'); }), /Không kết nối được ứng dụng/);
});
test('URL rejects embedded credentials and non-HTTP schemes before fetching', async () => {
  let called = false;
  for (const url of ['file:///tmp/demo', 'http://user:password@localhost', 'http://localhost?token=secret'])
    await assert.rejects(verifyApi(url, () => { called = true; }), /URL ứng dụng/);
  assert.equal(called, false);
});
