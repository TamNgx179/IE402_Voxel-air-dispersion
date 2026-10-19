/** Repair Windows line endings only when the repaired bytes match the existing freeze. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function normalizeFrozenText(root, apply = false) {
  root = resolve(root);
  const freeze = JSON.parse(await readFile(resolve(root, 'deploy/model-freeze.json'), 'utf8'));
  if (freeze.schema_version !== 1) throw new Error('Unsupported freeze schema');
  const repairs = [];
  for (const [name, expected] of Object.entries(freeze.files)) {
    const path = resolve(root, name);
    if (!path.startsWith(root + sep)) throw new Error(`Unsafe frozen path: ${name}`);
    const bytes = await readFile(path);
    if (digest(bytes) === expected) continue;
    const textFile = /^(?:src\/.*\.py|config\/.*\.(?:yaml|json)|pyproject\.toml|requirements-solver(?:-lock)?\.txt|deploy\/.*\.json)$/.test(name);
    const normalized = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
    if (!textFile || bytes.includes(0) || digest(normalized) !== expected) {
      throw new Error(`Content drift (not safe CRLF-only repair): ${name}`);
    }
    repairs.push({ name, path, normalized });
  }
  // Validate the entire inventory before touching any file. Never rewrite the lock.
  if (apply) for (const item of repairs) await writeFile(item.path, item.normalized);
  return { mode: apply ? 'applied' : 'audit', repaired_files: repairs.map((item) => item.name) };
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  normalizeFrozenText(resolve(dirname(fileURLToPath(import.meta.url)), '..'), process.argv.includes('--apply'))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
