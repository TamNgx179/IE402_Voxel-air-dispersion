/** Maintenance tool: inspect changes first, write only after parameter review. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { modelFiles } from './lib/model-files.mjs';
import { writeJson, assert } from './lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'deploy/model-freeze.json');
const { values } = parseArgs({ options: {
  write: { type: 'boolean', default: false },
  note: { type: 'string' },
} });
const previous = JSON.parse(await readFile(path, 'utf8'));
const files = {};
for (const name of await modelFiles(root)) {
  files[name] = createHash('sha256').update(await readFile(resolve(root, name))).digest('hex');
}
const changed = Object.keys(files).filter((name) => previous.files[name] !== files[name]);
const removed = Object.keys(previous.files).filter((name) => !files[name]);
console.log(JSON.stringify({ changed, removed }, null, 2));
if (values.write) {
  assert(values.note?.trim(), '--write requires --note describing the reviewed candidate change');
  await writeJson(path, {
    ...previous, files, status: 'candidate',
    frozen_on: new Date().toISOString().slice(0, 10),
    review_note: values.note.trim(),
    note: 'Source/config/runtime hashes are frozen; regenerate regression, production and cleanroom evidence after model changes. This is not a week-8 release tag.',
  });
  console.log('Candidate lock written. Regenerate evidence before accepting the new model.');
} else if (changed.length || removed.length) {
  process.exitCode = 1;
}
