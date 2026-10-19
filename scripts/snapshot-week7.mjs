/** Generate a local candidate snapshot; reports stay outside product docs. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, writeJson } from './lib/process.mjs';
import { verifyFreeze } from './check-freeze.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  index: 'artifacts/week7/evidence-index.json',
  science: 'artifacts/week7/production/report-assets.json',
  regression: 'artifacts/week7/checks/checks.json',
  cleanroom: 'artifacts/week7/cleanroom/rehearsal.json',
  browser: 'artifacts/week7/cleanroom/browser/browser-report.json',
  queries: 'artifacts/week7/cleanroom/query-benchmark.json',
  e2e: 'artifacts/a7-api-e2e.json',
};
const data = {};
const sourceReports = {};
for (const [name, path] of Object.entries(files)) {
  const raw = await readFile(resolve(root, path));
  data[name] = JSON.parse(raw);
  sourceReports[name] = { path, sha256: createHash('sha256').update(raw).digest('hex') };
}
const freeze = await verifyFreeze();
assert(data.index.status === 'candidate_pass' && data.index.gates.length === 10
  && data.index.gates.every((gate) => gate.status === 'pass'), 'Candidate gates are not all pass');
assert(data.science.status === 'candidate_pass' && data.science.runs.length === 5, 'Scientific report incomplete');
assert(data.regression.status === 'pass' && data.regression.suites.every((suite) => suite.status === 'pass'), 'Regression incomplete');
assert(data.cleanroom.status === 'pass' && data.cleanroom.runs.length === 2, 'Cleanroom incomplete');
assert(data.browser.status === 'pass' && data.browser.exceptions.length === 0, 'Browser incomplete');
assert(data.e2e.success && data.e2e.numPendingTests === 0 && data.e2e.numTotalTests > 0, 'Required E2E incomplete');
assert(data.index.freeze.candidate_sha256 === freeze.candidate_sha256, 'Evidence uses a different model freeze');
for (const run of data.science.runs) {
  assert(data.index.runs.some((item) => item.run_id === run.run_id && item.input_hash === run.input_hash), 'Science/index identity mismatch');
}
const snapshot = {
  schema_version: 1,
  milestone: 'M6 candidate / week 7',
  status: 'candidate_pass',
  recorded_at: new Date().toISOString(),
  source_reports: sourceReports,
  freeze,
  regression: {
    source_revision: data.regression.source_revision,
    dirty: data.regression.dirty,
    note: 'Verification ran on the week-7 candidate before commit; source/config hashes, not the previous commit alone, identify the model.',
    python: data.index.python,
    unit: data.regression.unit,
    required_e2e: { passed: data.e2e.numPassedTests, total: data.e2e.numTotalTests, skipped: data.e2e.numPendingTests },
    suites: data.regression.suites,
  },
  cleanroom: {
    source_revision: data.cleanroom.source_revision,
    host_input_mounts: data.cleanroom.host_input_mounts,
    status: data.cleanroom.status,
    checks: data.cleanroom.checks,
    runs: data.cleanroom.runs,
    browser: data.browser,
  },
  query_benchmark: {
    run_id: data.queries.run_id,
    model: data.queries.model,
    model_version: data.queries.model_version,
    samples: data.queries.samples,
    storage: data.queries.storage,
    queries: Object.fromEntries(Object.entries(data.queries.queries).map(([name, value]) => [name, {
      p50_ms: value.p50_ms, p95_ms: value.p95_ms,
      root_plan_node: value.plan.Plan['Node Type'],
      full_plan_source: sourceReports.queries,
    }])),
  },
  science: data.science,
  quality_gates: data.index.gates,
  remaining_week8: [
    'Second-machine rehearsal and final demo timing',
    'Final report editing and scientific terminology review',
    'Release tag, final run bundle, and evidence packaging',
    'Backup video/screenshots and technical Q&A',
  ],
};
await writeJson(resolve(root, 'artifacts/week7/week7-candidate.json'), snapshot);
console.log('Local snapshot written: artifacts/week7/week7-candidate.json');
