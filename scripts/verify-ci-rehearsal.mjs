/** Accept the independent API/Compose scope without relabelling skipped UI as passed. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredChecks = [
  'Validate isolated Compose configuration',
  'Build and boot fresh volumes',
  'Health, fixed seed, and empty run database',
  'HTTP → real solver → PostGIS → queries: dry_nov_apr',
  'HTTP → real solver → PostGIS → queries: wet_may_oct',
  'Production query benchmark and EXPLAIN',
  'Restart retains verified runs and query results',
];

export function verifyCiRehearsal(report, expectedRevision) {
  assert.match(expectedRevision, /^[0-9a-f]{40}$/i, 'Expected full checkout SHA');
  assert.match(report.source_revision || '', /^[0-9a-f]{7,40}$/i, 'Invalid/dirty source revision');
  assert(expectedRevision.startsWith(report.source_revision), 'Report revision differs from checkout');
  assert.equal(report.host_input_mounts, false, 'Host input caches must not be mounted');
  assert.equal(report.cleanup, 'pass', 'Owned CI stack cleanup did not pass');
  assert.equal(report.status, 'partial', 'Expected the explicit API-only rehearsal scope');
  assert(Array.isArray(report.checks), 'Missing checks');
  assert.equal(report.checks.length, requiredChecks.length + 1, 'Unexpected or missing checks');
  assert.equal(new Set(report.checks.map((check) => check.name)).size, report.checks.length, 'Duplicate checks');
  for (const name of requiredChecks)
    assert.equal(report.checks.find((check) => check.name === name)?.status, 'pass', `Required check failed: ${name}`);
  const browser = report.checks.find((check) => check.name === 'Browser viewer');
  assert.equal(browser?.status, 'skipped', 'UI scope must stay explicit');
  assert.equal(browser.reason, '--skip-browser supplied', 'Unexpected browser skip');
  assert.equal(report.runs?.length, 2, 'Expected two actual runs');
  assert.equal(new Set(report.runs.map((run) => run.run_id)).size, 2, 'Run IDs must be distinct');
  assert.deepEqual(report.runs.map((run) => run.scenario).sort(), ['dry_nov_apr', 'wet_may_oct']);
  for (const run of report.runs) {
    assert.match(run.run_id, /^[0-9a-f-]{36}$/i, 'Invalid run identity');
    assert.equal(run.verification, 'pass', 'Scientific checks did not pass');
    assert.match(run.input_hash, /^sha256:[0-9a-f]{64}$/i, 'Missing input hash');
    assert(run.model_version?.endsWith('+' + report.source_revision), 'Wrong model revision');
  }
  return { status: 'pass', scope: 'independent_runner_api_compose', checkout: expectedRevision,
    required_checks: requiredChecks.length, real_runs: report.runs.length,
    browser_automated: 'not_checked', second_personal_physical_machine: 'not_checked' };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const report = JSON.parse(await readFile(process.argv[2], 'utf8'));
    console.log(JSON.stringify(verifyCiRehearsal(report, process.argv[3]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
