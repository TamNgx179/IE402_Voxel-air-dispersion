/** B7.6 candidate evidence matrix; fail/partial cannot silently become PASS. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyFreeze } from './check-freeze.mjs';
import { writeJson } from './lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  study: { type: 'string', default: 'artifacts/week7/production' },
  rehearsal: { type: 'string', default: 'artifacts/week7/cleanroom' },
  checks: { type: 'string', default: 'artifacts/week7/checks' },
  out: { type: 'string', default: 'artifacts/week7/evidence-index.json' },
} });
const sources = {};
const missing = [];
async function load(name, path, json = true) {
  try {
    const raw = await readFile(resolve(root, path));
    sources[name] = { path, sha256: createHash('sha256').update(raw).digest('hex') };
    return json ? JSON.parse(raw) : raw.toString();
  } catch (error) {
    missing.push({ name, path, reason: error.message });
    return null;
  }
}
const regression = await load('regression', `${values.checks}/checks.json`);
const cleanroom = await load('cleanroom', `${values.rehearsal}/rehearsal.json`);
const study = await load('study', `${values.study}/analysis.json`);
const benchmark = await load('query_benchmark', `${values.rehearsal}/query-benchmark.json`);
const junit = await load('python_tests', `${values.checks}/python-junit.xml`, false);
const testsuite = junit?.match(/<testsuite\s[^>]*>/)?.[0] || '';
const count = (key) => Number(testsuite.match(new RegExp(`${key}="(\\d+)"`))?.[1] ?? -1);
const python = { tests: count('tests'), failures: count('failures'), errors: count('errors'), skipped: count('skipped') };
let freeze;
try { freeze = await verifyFreeze(); } catch (error) { missing.push({ name: 'freeze', reason: error.message }); }
const runs = study?.runs || [];
const production = runs.length === 5 && runs.every((run) => run.verification?.status === 'pass'
  && run.stopping?.criterion === 'steady_state' && run.metrics?.steady_state_converged === true);
const lock = JSON.parse(await readFile(resolve(root, 'deploy/model-freeze.json'), 'utf8'));
const scientificSourceMatches = study?.model_source_sha256 && Object.entries(study.model_source_sha256)
  .every(([name, digest]) => lock.files[name] === digest);
const geometry = study?.geometry_audit;
const gates = [];
function gate(id, title, condition, evidence, limitation) {
  gates.push({ id, title, status: condition ? 'pass' : 'pending', evidence, limitation });
}
gate('QG-1', 'FV voxel 3D is the primary result', cleanroom?.runs?.length === 2 && cleanroom.runs.every((run) => run.verification === 'pass'),
  ['cleanroom', 'study'], 'Browser evidence checks the default FV run; Gaussian remains a comparison model.');
gate('QG-2', 'Corrected face velocities and divergence', production && runs.every((run) => run.verification.checks.face_divergence?.status === 'pass'),
  ['study', 'python_tests'], 'Tolerance is frozen in project configuration; no field-wind validation is implied.');
gate('QG-3', 'No hidden concentration or mass correction', production && runs.every((run) => run.metrics.correction_kg === 0 && run.verification.checks.positivity?.status === 'pass'),
  ['study', 'python_tests'], 'Masking solid cells for export is distinct from clipping negative air concentrations.');
gate('QG-4', 'Verification and independent analytic solution', production && python.tests > 0 && python.failures === 0 && python.errors === 0 && python.skipped === 0
  && study.analytic_cross_check.relative_error <= study.analytic_cross_check.tolerance,
  ['study', 'python_tests'], 'Analytic diffusion is verification, not observed ground truth.');
gate('QG-5', 'Real PostGIS queries and query plans', cleanroom?.status === 'pass' && benchmark?.queries
  && ['slice', 'exceedance', 'profile', 'summary'].every((name) => benchmark.queries[name]?.plan && benchmark.queries[name].p95_ms >= 0),
  ['cleanroom', 'query_benchmark'], 'Latency is measured on this machine and is not an SLA.');
gate('QG-6', 'GIS geometry matches voxel mask', production && geometry?.occupancy_mismatch_voxels === 0
  && geometry.independent_footprint_mismatch_cells === 0 && geometry.independent_roof_rounding_voxels === 0,
  ['study'], 'OSM coverage and GOB height uncertainty remain; facade materials are illustrative.');
gate('QG-7', 'Height sensitivity and analytic cross-check', production && study.sensitivity?.some((item) => item.case === 'height_low')
  && study.sensitivity.some((item) => item.case === 'height_high') && study.analytic_cross_check.relative_error <= .01,
  ['study'], 'Not a wind-tunnel or field observation benchmark; no claim of grid convergence.');
gate('QG-8', 'Fresh volumes through Compose to browser', cleanroom?.status === 'pass' && cleanroom.host_input_mounts === false && cleanroom.browser?.status === 'pass',
  ['cleanroom'], 'Fresh-volume/container rehearsal on the current host; a second physical machine remains part of release rehearsal.');
gate('QG-9', 'Frozen config, thresholds, versions and report', Boolean(freeze) && regression?.status === 'pass' && production && scientificSourceMatches,
  ['regression', 'study', 'cleanroom'], 'Candidate freeze; final report and release tag are week 8 tasks.');
gate('QG-10', 'Quantitative height difference and 3D profile', production && runs.filter((run) => ['dry', 'wet'].includes(run.case)).every((run) =>
  run.summary.layers.length === 2 && Math.abs(run.summary.layers[0].mean_ug_m3 - run.summary.layers[1].mean_ug_m3) > 1e-6
  && run.summary.vertical_share.length === 50 && run.summary.exceedance_volume_m3),
  ['study', 'cleanroom'], 'Zero exceedance is a model result, not evidence that real air is safe.');

const report = {
  schema_version: 1, milestone: 'B7.6', generated_at: new Date().toISOString(),
  status: gates.every((item) => item.status === 'pass') ? 'candidate_pass' : 'incomplete',
  freeze, python, gates, sources, missing,
  runs: runs.map((run) => ({ case: run.case, run_id: run.run_id, input_hash: run.input_hash,
    model_version: run.manifest_model_version || 'See run manifest', verification: run.verification.status,
    solver_wall_s: run.metrics.wall_clock_s, layers: run.summary.layers })),
  release_note: 'This week-7 candidate audit does not create a week-8 release or final report.',
};
await writeJson(resolve(root, values.out), report);
const markdown = [
  '# Week 7 candidate evidence', '', `Status: **${report.status}**`, '',
  '| Gate | Status | Evidence |', '|---|---|---|',
  ...gates.map((item) => `| ${item.id}: ${item.title} | ${item.status} | ${item.evidence.join(', ')} |`), '',
  '## Source reports', '', ...Object.entries(sources).map(([name, source]) => `- ${name}: ${source.path} (SHA-256 ${source.sha256})`), '',
  '## Limits', '', ...gates.map((item) => `- ${item.id}: ${item.limitation}`), '',
];
const { writeFile } = await import('node:fs/promises');
await writeFile(join(dirname(resolve(root, values.out)), 'evidence-index.md'), markdown.join('\n'));
console.log(`${report.status}: ${gates.filter((item) => item.status === 'pass').length}/10 candidate gates; ${values.out}`);
if (report.status === 'incomplete') process.exitCode = 1;
