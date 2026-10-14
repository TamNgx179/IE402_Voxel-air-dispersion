/** Verify the candidate model's inputs/code/config against B7.2. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, writeJson } from './lib/process.mjs';
import { modelFiles } from './lib/model-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyFreeze() {
  const freeze = JSON.parse(await readFile(resolve(root, 'deploy/model-freeze.json'), 'utf8'));
  assert(freeze.schema_version === 1, 'Unsupported model freeze schema');
  const names = await modelFiles(root);
  assert(names.every((name) => freeze.files[name]) && Object.keys(freeze.files).length === names.length,
    'Candidate freeze omits or retains a model file; inspect the inventory before updating it');
  const changes = [];
  for (const [name, expected] of Object.entries(freeze.files)) {
    assert(resolve(root, name).startsWith(root + (process.platform === 'win32' ? '\\' : '/')), 'Invalid frozen file path');
    const actual = createHash('sha256').update(await readFile(resolve(root, name))).digest('hex');
    if (actual !== expected) changes.push(name);
  }
  assert(changes.length === 0, `Model freeze changed: ${changes.join(', ')}. Review parameters and regenerate evidence before updating the lock.`);
  return { status: 'pass', milestone: 'B7.2', file_count: Object.keys(freeze.files).length,
    candidate_sha256: createHash('sha256').update(JSON.stringify(freeze.files)).digest('hex') };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  verifyFreeze().then(async (report) => {
    await writeJson(resolve(root, 'artifacts/week7/freeze-report.json'), report);
    console.log(JSON.stringify(report));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
