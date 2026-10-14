/** A7.6: new Compose project, empty volumes, two production HTTP runs. */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assert, command, numericClose, request, waitUntil, writeJson } from './lib/process.mjs';
import { browserSmoke } from './viewer-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  port: { type: 'string', default: '3107' },
  out: { type: 'string', default: 'artifacts/week7/cleanroom' },
  'skip-build': { type: 'boolean', default: false },
  'skip-browser': { type: 'boolean', default: false },
  keep: { type: 'boolean', default: false },
} });
const port = Number(values.port);
assert(Number.isInteger(port) && port > 1024 && port <= 65535, '--port must be 1025..65535');
const out = resolve(root, values.out);
assert(out.startsWith(resolve(root, 'artifacts') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')),
  'Rehearsal output must be inside repository artifacts/');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'compose.log'), '');
const project = `ie402-rehearsal-${randomBytes(5).toString('hex')}`;
const base = `http://127.0.0.1:${port}`;
const composeArgs = ['compose', '-p', project, '-f', 'docker-compose.yml', '-f', 'deploy/compose.cleanroom.yml'];
const git = await command('git', ['rev-parse', '--short', 'HEAD'], { cwd: root });
const status = await command('git', ['status', '--porcelain'], { cwd: root });
const revision = `${git.stdout.trim()}${status.stdout.trim() ? '-dirty' : ''}`;
const env = {
  REHEARSAL_PORT: String(port),
  SOURCE_REVISION: revision,
  POSTGRES_USER: 'ie402',
  POSTGRES_PASSWORD: 'ie402',
  POSTGRES_DB: 'ie402',
};
const report = {
  schema_version: 1,
  milestone: 'A7.6',
  status: 'running',
  started_at: new Date().toISOString(),
  source_revision: revision,
  compose_project: project,
  base_url: base,
  host_input_mounts: false,
  checks: [],
  runs: [],
};
let ownedStack = false;
const compose = (args, options = {}) => command('docker', [...composeArgs, ...args], {
  cwd: root, env, log: join(out, 'compose.log'), ...options,
});
async function check(name, action) {
  const start = Date.now();
  console.log(`[week7] ${name}`);
  const value = await action();
  report.checks.push({ name, status: 'pass', wall_s: (Date.now() - start) / 1000 });
  await writeJson(join(out, 'rehearsal.json'), report);
  return value;
}
async function verifyRun(scenario) {
  const accepted = await request(base, '/api/runs', {
    method: 'POST', expected: 202, body: { scenario_id: scenario, model: 'fv' },
  });
  assert(accepted.status === 'queued', 'New run must start queued');
  const id = accepted.run_id;
  let nextProgress = Date.now();
  const run = await waitUntil(() => request(base, `/api/runs/${id}`),
    (value) => ['succeeded', 'failed', 'stale'].includes(value.status), {
      timeout: 930_000, name: `${scenario} production run`,
      onProgress(value) {
        if (Date.now() >= nextProgress) {
          console.log(`[week7] ${scenario} ${value.status}, ${Math.round(value.progress * 100)}%`);
          nextProgress = Date.now() + 30_000;
        }
      },
    });
  await writeJson(join(out, `${scenario}-run.json`), run);
  assert(run.status === 'succeeded', `${scenario} failed: ${run.error?.message}`);
  assert(!run.warnings.some((warning) => /mock run|fixed-time run/i.test(warning)), 'Expected steady real run');
  const summary = await request(base, `/api/runs/${id}/summary`);
  const prefix = `/api/runs/${id}`;
  await writeJson(join(out, `${scenario}-summary.json`), summary);
  assert(summary.run_id === id && summary.model === 'fv', 'Summary identity mismatch');
  assert(summary.model_version.endsWith(`+${revision}`), 'Container must report its build revision');
  assert(/^sha256:[0-9a-f]{64}$/.test(summary.input_hash), 'Input hash missing');
  assert(summary.grid.nx * summary.grid.ny * summary.grid.nz === 500_000, 'Expected full production grid');
  assert(summary.verification.status === 'pass' && summary.verification.checks.length >= 7, 'Verification gates missing');
  assert(summary.verification.checks.every((gate) => gate.status === 'pass'), 'One or more gates failed');
  assert(summary.metrics.stopping_criterion === 'steady_state' &&
    summary.verification.checks.some((gate) => gate.name === 'steady_state' && gate.status === 'pass'),
    'Production run must converge');
  assert(summary.metrics.correction_kg === 0, 'Do not mask mass errors');
  numericClose(summary.metrics.emitted_kg,
    summary.metrics.remaining_kg + summary.metrics.escaped_kg, 'Mass balance', 1e-6);
  for (const height of [1.5, 15]) {
    const slice = await request(base, `${prefix}/slices?z_m=${height}`);
    const layer = summary.layers[slice.k];
    const cells = slice.feature_collection.features;
    assert(cells.length === layer.air_cells, 'Slice air-cell count differs from DB summary');
    const mean = cells.reduce((sum, cell) => sum + cell.properties.concentration_ug_m3, 0) / cells.length;
    numericClose(mean, layer.mean_ug_m3, 'Slice mean');
    const selected = cells.find((cell) => cell.properties.concentration_ug_m3 > 0);
    assert(selected, 'Expected a source-influenced air column');
    const { i, j, concentration_ug_m3 } = selected.properties;
    const profile = await request(base, `${prefix}/profile?i=${i}&j=${j}`);
    assert(profile.levels.length === summary.grid.nz, 'Profile must cover all heights');
    numericClose(profile.levels[slice.k].concentration_ug_m3, concentration_ug_m3, 'Profile vs slice');
    const exceedance = await request(base, `${prefix}/exceedance?z_m=${height}&threshold=0`);
    const positive = cells.filter((cell) => cell.properties.concentration_ug_m3 > 0).length;
    assert(exceedance.cell_count === positive, 'Exceedance count differs from exact slice');
    await writeJson(join(out, `${scenario}-z${height}-profile.json`), profile);
    await writeJson(join(out, `${scenario}-z${height}-slice-stats.json`), {
      ...slice, feature_collection: { type: 'FeatureCollection', features: [selected] },
      evidence_note: 'One selected feature retained; full slice checked in memory against DB summary',
    });
  }
  const volume = await request(base, `${prefix}/volume`);
  assert(Buffer.from(volume.codes_base64, 'base64').length === 500_000, 'Volume payload shape mismatch');
  const artifacts = await request(base, `${prefix}/artifacts`);
  await writeJson(join(out, `${scenario}-artifacts.json`), artifacts);
  for (const item of artifacts.artifacts) {
    const response = await fetch(new URL(item.download_url, base), { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `Cannot download ${item.kind}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length === item.size_bytes, `${item.kind} size mismatch`);
    assert(createHash('sha256').update(bytes).digest('hex') === item.sha256, `${item.kind} checksum mismatch`);
    if (item.kind === 'manifest') await writeFile(join(out, `${scenario}-manifest.json`), bytes);
    if (item.kind === 'wind_vectors') {
      const vectors = JSON.parse(bytes.toString());
      assert(vectors.run_id === id && vectors.units === 'm s-1', 'Wind artifact identity mismatch');
    }
  }
  await request(base, `${prefix}/slices?z_m=100`, { expected: 400 });
  await request(base, `${prefix}/profile?i=100&j=0`, { expected: 400 });
  await request(base, `${prefix}/retry`, { method: 'POST', expected: 409 });
  const result = { scenario, run_id: id, input_hash: summary.input_hash, model_version: summary.model_version,
    verification: summary.verification.status, solver_wall_s: summary.metrics.wall_clock_s,
    layers: [summary.layers[0], summary.layers[7]] };
  report.runs.push(result);
  return result;
}

try {
  await check('Validate isolated Compose configuration', async () => {
    const existing = await command('docker', ['compose', 'ls', '--format', 'json'], { cwd: root });
    assert(!JSON.parse(existing.stdout).some((entry) => entry.Name === project), 'Project name collision');
    const config = JSON.parse((await compose(['config', '--format', 'json'])).stdout);
    assert(config.services.db.ports?.length === 0 || !config.services.db.ports, 'Rehearsal DB must not bind a host port');
    assert(config.services.app.volumes.every((volume) => volume.type === 'volume'), 'Cleanroom forbids host mounts');
    await writeJson(join(out, 'compose-config.json'), config);
  });
  await check('Build and boot fresh volumes', async () => {
    ownedStack = true;
    await compose(['up', '-d', ...(values['skip-build'] ? [] : ['--build']), '--wait', '--wait-timeout', '180'], { timeout: 900_000 });
  });
  await check('Health, fixed seed, and empty run database', async () => {
    report.health = await request(base, '/api/health');
    assert(report.health.status === 'ok', 'App health degraded');
    const areas = await request(base, '/api/study-areas');
    assert(areas.length === 1 && areas[0].grid.nz === 50, 'Unexpected seeded study area');
    const runs = await request(base, '/api/runs?limit=20');
    assert(runs.length === 0, 'Cleanroom database is not empty');
    const scene = await request(base, `/api/study-areas/${areas[0].id}/scene`);
    assert(scene.buildings.features.length === 62, 'Seed geometry count mismatch');
    await compose(['exec', '-T', 'app', 'node', 'dist/database/cli.js', 'seed']);
    assert((await request(base, '/api/study-areas')).length === 1, 'Seed is not idempotent');
    const index = await fetch(base);
    const html = await index.text();
    assert(index.ok && html.includes('viewer-evidence.js'), 'Viewer dashboard missing from image');
    const config = await readFile(join(root, 'config/project.yaml'));
    report.config_sha256 = createHash('sha256').update(config).digest('hex');
  });
  for (const scenario of ['dry_nov_apr', 'wet_may_oct']) {
    await check(`HTTP → real solver → PostGIS → queries: ${scenario}`, () => verifyRun(scenario));
  }
  await check('Production query benchmark and EXPLAIN', async () => {
    const runId = report.runs[0].run_id;
    await compose(['exec', '-T', '-e', `BENCHMARK_RUN_ID=${runId}`, '-e', 'BENCHMARK_OUTPUT=/opt/project/artifacts/week7-query-benchmark.json',
      'app', 'node', 'dist/database/benchmark-results.js']);
    await compose(['cp', 'app:/opt/project/artifacts/week7-query-benchmark.json', join(out, 'query-benchmark.json')]);
  });
  await check('Restart retains verified runs and query results', async () => {
    await compose(['restart', 'app']);
    await waitUntil(() => request(base, '/api/health'), (health) => health.status === 'ok', { name: 'restart health' });
    for (const run of report.runs) {
      assert((await request(base, `/api/runs/${run.run_id}`)).status === 'succeeded', 'Restart lost completed run');
      assert((await request(base, `/api/runs/${run.run_id}/summary`)).input_hash === run.input_hash, 'Restart changed input identity');
    }
  });
  if (!values['skip-browser']) {
    report.browser = await check('Browser: scene, run, height, profile, evidence dashboard',
      () => browserSmoke({ base, out: join(out, 'browser') }));
  } else {
    report.checks.push({ name: 'Browser viewer', status: 'skipped', reason: '--skip-browser supplied' });
  }
  report.status = report.checks.some((item) => item.status === 'skipped') ? 'partial' : 'pass';
} catch (error) {
  report.status = 'fail';
  report.error = error.message;
  console.error(`[week7] FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  if (ownedStack) {
    const logs = await compose(['logs', '--no-color'], { allowFailure: true });
    await writeFile(join(out, 'services.log'), logs.stdout + logs.stderr);
    if (!values.keep) {
      // This generated project was checked absent before up; cleanup never
      // targets the development project or an existing user-owned volume.
      const cleanup = await compose(['down', '--volumes', '--remove-orphans'], { allowFailure: true });
      report.cleanup = cleanup.code === 0 ? 'pass' : 'fail';
      if (cleanup.code !== 0) { report.status = 'fail'; process.exitCode = 1; }
    } else {
      report.cleanup = 'kept';
      console.log(`[week7] Stack kept: ${project}, ${base}`);
    }
  }
  await writeJson(join(out, 'rehearsal.json'), report);
  console.log(`[week7] ${report.status.toUpperCase()} — ${join(out, 'rehearsal.json')}`);
}
