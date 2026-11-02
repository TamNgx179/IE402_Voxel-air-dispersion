import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredChecks, verifyCiRehearsal } from '../verify-ci-rehearsal.mjs';

const sha = 'a'.repeat(40);
function report() {
  return { source_revision: sha.slice(0, 7), host_input_mounts: false, cleanup: 'pass', status: 'partial',
    checks: [...requiredChecks.map((name) => ({ name, status: 'pass' })),
      { name: 'Browser viewer', status: 'skipped', reason: '--skip-browser supplied' }],
    runs: ['dry_nov_apr', 'wet_may_oct'].map((scenario, index) => ({
      scenario, run_id: `00000000-0000-4000-8000-00000000000${index}`, verification: 'pass',
      input_hash: 'sha256:' + 'b'.repeat(64), model_version: '0.1.0+' + sha.slice(0, 7),
    })) };
}
test('API scope accepts all checks while preserving browser and hardware limits', () => {
  const input = report();
  const result = verifyCiRehearsal(input, sha);
  assert.equal(result.status, 'pass');
  assert.equal(result.browser_automated, 'not_checked');
  assert.equal(result.second_personal_physical_machine, 'not_checked');
  assert.equal(input.status, 'partial');
});
for (const [name, change] of [
  ['missing required check', (r) => r.checks.splice(0, 1)],
  ['failed check', (r) => { r.checks[0].status = 'fail'; }],
  ['required check skipped', (r) => { r.checks[0].status = 'skipped'; }],
  ['duplicate check', (r) => { r.checks[0] = r.checks[1]; }],
  ['unexpected extra skip', (r) => r.checks.push({ name: 'other', status: 'skipped' })],
  ['dirty revision', (r) => { r.source_revision += '-dirty'; }],
  ['different revision', (r) => { r.source_revision = 'b'.repeat(7); }],
  ['mounted host inputs', (r) => { r.host_input_mounts = true; }],
  ['cleanup failure', (r) => { r.cleanup = 'fail'; }],
  ['hidden partial UI', (r) => { r.status = 'pass'; }],
  ['duplicate runs', (r) => { r.runs[1].run_id = r.runs[0].run_id; }],
  ['wrong scenario pair', (r) => { r.runs[1].scenario = r.runs[0].scenario; }],
  ['failed verification', (r) => { r.runs[0].verification = 'fail'; }],
  ['wrong solver revision', (r) => { r.runs[0].model_version = '0.1.0+old'; }],
  ['missing input hash', (r) => { delete r.runs[0].input_hash; }],
]) test(`CI acceptance refuses ${name}`, () => {
  const input = report(); change(input);
  assert.throws(() => verifyCiRehearsal(input, sha));
});
