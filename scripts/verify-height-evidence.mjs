/** Match exact slices, profiles and transect CSV to one completed production run. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assert, request, writeJson } from './lib/process.mjs';

const { parse } = createRequire(new URL('../app/package.json', import.meta.url))('csv-parse/sync');
const rehearsalPath = process.argv[2];
assert(rehearsalPath, 'Usage: node scripts/verify-height-evidence.mjs <rehearsal.json>');
const rehearsal = JSON.parse(await readFile(rehearsalPath, 'utf8'));
const base = new URL(rehearsal.base_url);
assert(['127.0.0.1', 'localhost'].includes(base.hostname), 'Use the local rehearsal endpoint');
const run = rehearsal.runs.find(({ scenario }) => scenario === 'dry_nov_apr');
assert(run?.verification === 'pass', 'A verified dry-season run is required');
const prefix = `/api/runs/${run.run_id}`;
const output = dirname(rehearsalPath);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const value = (feature) => feature.properties.concentration_ug_m3;
const key = ({ i, j }) => `${i},${j}`;

const [low, high, manifest] = await Promise.all([
  request(base, `${prefix}/slices?z_m=1`),
  request(base, `${prefix}/slices?z_m=15`),
  readFile(join(output, 'dry_nov_apr-manifest.json')),
]);
assert(low.z_center_m === 1 && high.z_center_m === 15, 'Unexpected layer centres');
for (const slice of [low, high]) {
  assert(slice.run_id === run.run_id && slice.model_version === run.model_version, 'Slice run mismatch');
}
const highCells = new Map(high.feature_collection.features.map((feature) => [key(feature.properties), feature]));
const paired = low.feature_collection.features.flatMap((feature) => {
  const { i, j } = feature.properties;
  const above = highCells.get(key({ i, j }));
  if (!above) return [];
  const lowValue = value(feature);
  const highValue = value(above);
  return [{ i, j, low: lowValue, high: highValue, delta: highValue - lowValue,
    ratio: lowValue > 0 ? highValue / lowValue : null, geometry: feature.geometry }];
});
assert(paired.length > 0, 'No cells have air data at both heights');
const ratios = paired.flatMap(({ ratio }) => ratio === null ? [] : [ratio]).sort((a, b) => a - b);
assert(ratios.length, 'No positive low-layer concentrations');
const median = (ratios[Math.floor((ratios.length - 1) / 2)] + ratios[Math.floor(ratios.length / 2)]) / 2;
const increases = paired.filter(({ delta }) => delta > 0).sort((a, b) => b.delta - a.delta);
const decreases = paired.filter(({ delta }) => delta < 0).sort((a, b) => a.delta - b.delta);
const examples = [...increases.slice(0, 3), ...decreases.slice(0, 1)];
assert(examples.length >= 2, 'Expected contrasting columns for the section');
for (const cell of examples) {
  const profile = await request(base, `${prefix}/profile?i=${cell.i}&j=${cell.j}`);
  assert(profile.run_id === run.run_id &&
    profile.levels[low.k].concentration_ug_m3 === cell.low &&
    profile.levels[high.k].concentration_ug_m3 === cell.high, 'Profile differs from slices');
}

// A straight line through two contrasting cell centres makes the section independently checkable.
function centre({ geometry }) {
  const vertices = geometry.coordinates[0].slice(0, -1);
  return [0, 1].map((axis) => vertices.reduce((sum, point) => sum + point[axis], 0) / vertices.length);
}
const first = examples[0];
const last = examples.at(-1);
const body = { line: { type: 'LineString', coordinates: [centre(first), centre(last)] },
  z_min_m: 0, z_max_m: 16, step_m: 5 };
const section = await request(base, `${prefix}/transect`, { method: 'POST', body });
const response = await fetch(new URL(`${prefix}/transect/csv`, base), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});
assert(response.ok && response.headers.get('content-type')?.includes('text/csv'), 'Missing transect CSV');
const csv = await response.text();
const rows = parse(csv, { columns: true });
assert(section.run_id === run.run_id && section.input_hash === run.input_hash, 'Section run identity mismatch');
assert(rows.length === section.samples.length * section.layers.length, 'Section CSV sample count mismatch');
let index = 0;
for (const sample of section.samples) {
  for (const [layerIndex, cell] of sample.cells.entries()) {
    const row = rows[index++];
    const concentration = row.concentration_ug_m3 === '' ? null : Number(row.concentration_ug_m3);
    assert(row.run_id === run.run_id && row.input_hash === run.input_hash && row.model_version === run.model_version &&
      Number(row.i) === sample.i && Number(row.j) === sample.j && Number(row.k) === cell.k &&
      Number(row.distance_m) === sample.distance_m && Number(row.z_center_m) === section.layers[layerIndex].z_center_m &&
      row.status === cell.status && concentration === cell.concentration_ug_m3, `Section CSV mismatch on row ${index}`);
  }
}
for (const [sample, expected] of [[section.samples[0], first], [section.samples.at(-1), last]]) {
  assert(sample.i === expected.i && sample.j === expected.j &&
    sample.cells.find(({ k }) => k === low.k)?.concentration_ug_m3 === expected.low &&
    sample.cells.find(({ k }) => k === high.k)?.concentration_ug_m3 === expected.high,
  'Section endpoints disagree with exact slices');
}

await writeFile(join(output, 'height-pairs.csv'), [
  'i,j,c_1m_ug_m3,c_15m_ug_m3,delta_ug_m3,ratio',
  ...paired.map(({ i, j, low, high, delta, ratio }) => [i, j, low, high, delta, ratio].join(',')),
].join('\n') + '\n');
await writeFile(join(output, 'height-section.csv'), csv);
await writeJson(join(output, 'height-section.json'), section);
const evidence = { revision: rehearsal.source_revision, run_id: run.run_id, input_hash: run.input_hash,
  manifest_sha256: hash(manifest), section_csv_sha256: hash(csv), paired_columns: paired.length,
  columns_with_ratio: ratios.length, median_ratio: median, increasing_columns: increases.length,
  decreasing_columns: decreases.length, unchanged_columns: paired.length - increases.length - decreases.length,
  examples: examples.map(({ geometry, ...cell }) => cell), section_rows_verified: rows.length };
await writeJson(join(output, 'height-evidence.json'), evidence);
console.log(JSON.stringify(evidence, null, 2));
