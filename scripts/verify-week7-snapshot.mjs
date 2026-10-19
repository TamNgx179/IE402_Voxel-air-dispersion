/** Check a locally generated snapshot without rerunning solver or browser. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assert } from './lib/process.mjs';
import { verifyFreeze } from './check-freeze.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(await readFile(resolve(root, 'artifacts/week7/week7-candidate.json'), 'utf8'));
const freeze = await verifyFreeze();
assert(snapshot.schema_version === 1 && snapshot.status === 'candidate_pass', 'Snapshot schema/status invalid');
assert(snapshot.freeze.candidate_sha256 === freeze.candidate_sha256, 'Snapshot is for a different frozen model');
assert(snapshot.quality_gates.length === 10 && snapshot.quality_gates.every((gate) => gate.status === 'pass'), 'Snapshot contains a pending quality gate');
assert(snapshot.science.runs.length === 5 && snapshot.science.runs.every((run) => run.verification === 'pass'), 'Missing production evidence');
assert(snapshot.regression.python.failures === 0 && snapshot.regression.python.errors === 0 && snapshot.regression.python.skipped === 0, 'Python science evidence is incomplete');
assert(snapshot.regression.required_e2e.passed === snapshot.regression.required_e2e.total && snapshot.regression.required_e2e.skipped === 0, 'E2E evidence is incomplete');
for (const [name, expected] of Object.entries(snapshot.science.model_source_sha256)) {
  const raw = await readFile(resolve(root, name));
  assert(createHash('sha256').update(raw).digest('hex') === expected, `Snapshot source changed: ${name}`);
}
console.log(`Local candidate snapshot: ${snapshot.science.runs.length} production cases, 10/10 gates; freeze matches (not a new test run)`);
