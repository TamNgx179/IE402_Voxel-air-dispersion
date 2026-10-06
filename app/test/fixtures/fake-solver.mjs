#!/usr/bin/env node
// Fake Python solver for app tests. Same CLI and contract as `python -m
// src.solver` (docs/spec.md D2), no Python needed:
//
//   node fake-solver.mjs run --run-id <uuid> --config <yaml> --out <dir>
//        [--mock] [--mock-fail input|model|system]
//
// FAKE_SOLVER_BEHAVIOR (env) adds cases the real mock cannot produce:
//   ok (default) · input · model · system · hang (until killed) ·
//   bad-checksum (exit 0, wind.nc rewritten after hashing, same size) ·
//   wrong-run-id (exit 0, manifest for another run) ·
//   verification-fail-exit0 (exit 0 but verification.status = "fail") ·
//   no-manifest (exit 0, no manifest.json)
// FAKE_SOLVER_DELAY_MS (env) pauses mid-run.

import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (argv[0] !== 'run') {
  console.error('usage: fake-solver run --run-id … --config … --out …');
  process.exit(2);
}
const runId = opt('--run-id');
const configPath = opt('--config');
const out = opt('--out');
const behavior = opt('--mock-fail') ?? process.env.FAKE_SOLVER_BEHAVIOR ?? 'ok';

mkdirSync(out, { recursive: true });
const logPath = join(out, 'solver.log');
const log = (msg) =>
  appendFileSync(logPath, `${new Date().toISOString()} | ${msg}\n`);
const progress = (stage, fraction) =>
  process.stdout.write(
    JSON.stringify({ event: 'progress', stage, fraction }) + '\n',
  );
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

log(`fake solver run ${runId} behavior=${behavior}`);
process.stdout.write('this line is not JSON and must be ignored\n');

const config = readFileSync(configPath, 'utf8');
// The run block is written by the monolith as plain YAML: run:\n  run_id: …
const runBlock = config.slice(config.search(/^run:/m));
const field = (k) =>
  (runBlock.match(new RegExp(`^\\s+${k}:\\s*(\\S+)`, 'm')) ?? [])[1];
const scenarioId = field('scenario_id');
const model = field('model') ?? 'fv';

progress('setup', 1);
if (behavior === 'input') {
  log('mock failure requested: input');
  console.error('input error: mock failure requested');
  process.exit(2);
}
progress('wind', 0.5);
progress('wind', 1);
if (behavior === 'system') {
  console.error('Traceback (most recent call last):\n  fake system failure');
  process.exit(4);
}
if (behavior === 'hang') {
  progress('transport', 0.1);
  setInterval(() => undefined, 1000);
  await new Promise(() => undefined);
}
// FAKE_SOLVER_DELAY_MS slows the run down so tests can observe 'running'.
await new Promise((r) =>
  setTimeout(r, Number(process.env.FAKE_SOLVER_DELAY_MS ?? 0)),
);
progress('transport', 0.5);
progress('transport', 1);
progress('export', 0.5);

const nz = 4;
writeFileSync(join(out, 'wind.nc'), Buffer.from('fake wind netcdf'));
writeFileSync(
  join(out, 'concentration.nc'),
  Buffer.from('fake concentration netcdf'),
);
const rows = ['i,j,c_ug_m3'];
for (let j = 0; j < 2; j++) {
  for (let i = 0; i < 2; i++) {
    const solid = (i === 0 && j === 0) || (i === 1 && j === 1);
    const col = Array.from({ length: nz }, (_, k) =>
      solid && k < 2 ? 'NULL' : (10 / (k + 1)).toFixed(3),
    );
    rows.push(`${i},${j},"{${col.join(',')}}"`);
  }
}
writeFileSync(join(out, 'columns.csv.gz'), gzipSync(rows.join('\n') + '\n'));
writeFileSync(
  join(out, 'metrics.json'),
  JSON.stringify({
    dt_s: 0.5,
    courant: 0.5,
    steps: 1200,
    simulated_s: 600,
    wall_clock_s: 0.1,
    emitted_kg: 1,
    remaining_kg: 0.4,
    escaped_kg: 0.6,
    correction_kg: 0,
    stopping_criterion: 'fixed_time',
    mock: true,
  }),
);

const modelFail =
  behavior === 'model' || behavior === 'verification-fail-exit0';
const check = (status, value, tolerance) => ({ status, value, tolerance });
const checks = {
  cfl: check('pass', 0.5, 0.5),
  face_divergence: check('pass', 0, 1e-5),
  positivity: check('pass', 0, 1e-9),
  wall_flux: check('pass', 0, 0),
  mass_balance: check(modelFail ? 'fail' : 'pass', modelFail ? 0.02 : 0, 1e-9),
};
progress('export', 1);
log('artifacts written');

const files = {
  config: resolve(configPath),
  wind: join(out, 'wind.nc'),
  concentration: join(out, 'concentration.nc'),
  columns: join(out, 'columns.csv.gz'),
  metrics: join(out, 'metrics.json'),
  log: logPath,
};
const artifacts = Object.entries(files)
  .filter(([, p]) => dirname(p) === resolve(out))
  .map(([kind, p]) => ({
    kind,
    path: basename(p),
    sha256: sha(p),
    size_bytes: statSync(p).size,
  }));

const now = new Date().toISOString();
const manifest = {
  schema_version: '1.0',
  run_id: behavior === 'wrong-run-id' ? randomUUID() : runId,
  model,
  model_version: '0.0.0+fake',
  input_hash: `sha256:${createHash('sha256').update(config).digest('hex')}`,
  scenario: { id: scenarioId, wind_from_deg: 112, wind_speed_m_s: 1.62 },
  grid: {
    crs: 'EPSG:32648',
    axis_order: 'z,y,x',
    origin_x_m: 686000,
    origin_y_m: 1191300,
    dx_m: 5,
    dy_m: 5,
    dz_m: 2,
    nx: 2,
    ny: 2,
    nz,
  },
  units: { concentration: 'ug m-3', velocity: 'm s-1' },
  thresholds: { qcvn_24h: { value_ug_m3: 45, label: 'QCVN 05:2023 · 24 h' } },
  stopping: {
    criterion: 'fixed_time',
    simulated_s: 600,
    steps: 1200,
    residual: null,
  },
  artifacts,
  verification: { status: modelFail ? 'fail' : 'pass', checks },
  warnings: ['mock run: synthetic field, not a model result'],
  started_at: now,
  finished_at: now,
};

if (behavior !== 'no-manifest') {
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
}
if (behavior === 'bad-checksum') {
  // Same size, different bytes: only the checksum can catch it.
  writeFileSync(join(out, 'wind.nc'), Buffer.from('FAKE wind netcdf'));
}
process.exit(behavior === 'model' ? 3 : 0);
