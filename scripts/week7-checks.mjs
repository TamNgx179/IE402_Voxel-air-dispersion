/** Capture repeatable regression evidence; absent/skipped suites stay visible. */
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { command, assert, writeJson } from './lib/process.mjs';
import { verifyFreeze } from './check-freeze.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'app');
const out = join(root, 'artifacts/week7/checks');
const { values } = parseArgs({ options: {
  python: { type: 'string', default: process.env.PYTHON_BIN || join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') },
  'skip-e2e': { type: 'boolean', default: false },
} });
const report = { schema_version: 1, status: 'running', started_at: new Date().toISOString(), suites: [] };
async function run(name, executable, args, options = {}) {
  console.log(`[week7] ${name}`);
  const started = Date.now();
  const result = await command(executable, args, { cwd: root, log: join(out, `${name}.log`), allowFailure: true, ...options });
  report.suites.push({ name, status: result.code === 0 ? 'pass' : 'fail', exit_code: result.code, wall_s: (Date.now() - started) / 1000 });
  await writeJson(join(out, 'checks.json'), report);
  return result;
}
try {
  report.freeze = await verifyFreeze();
  const git = await command('git', ['rev-parse', 'HEAD'], { cwd: root });
  const status = await command('git', ['status', '--porcelain'], { cwd: root });
  report.source_revision = git.stdout.trim();
  report.dirty = Boolean(status.stdout.trim());
  const deps = await run('python-dependencies', values.python, ['-m', 'pip', 'list', '--format=json']);
  if (deps.code === 0) await writeJson(join(out, 'python-dependencies.json'), JSON.parse(deps.stdout));
  const webFiles = (await readdir(join(root, 'web/tests'))).filter((name) => name.endsWith('.test.cjs')).sort();
  await run('web', process.execPath, ['--test', '--test-reporter=tap', ...webFiles.map((name) => join(root, 'web/tests', name))]);
  await run('python', values.python, ['-m', 'pytest', '-p', 'no:cacheprovider',
    `--basetemp=${join(out, `pytest-temp-${Date.now()}`)}`, `--junitxml=${join(out, 'python-junit.xml')}`, '--tb=short'],
  { env: { MPLBACKEND: 'Agg' }, timeout: 600_000 });
  await run('unit', process.execPath, [join(app, 'node_modules/vitest/vitest.mjs'), 'run',
    '--reporter=default', '--reporter=json', `--outputFile=${join(out, 'unit.json')}`], { cwd: app });
  const unit = JSON.parse(await readFile(join(out, 'unit.json'), 'utf8'));
  report.unit = { passed: unit.numPassedTests, skipped: unit.numPendingTests, total: unit.numTotalTests };
  assert(unit.numTotalTests > 0, 'Empty unit suite');
  if (!values['skip-e2e']) {
    await run('e2e', process.execPath, [join(app, 'test/run-required-e2e.mjs')], { cwd: app, timeout: 300_000 });
  } else {
    report.suites.push({ name: 'e2e', status: 'skipped', reason: '--skip-e2e supplied' });
  }
  await run('lint', process.execPath, [join(app, 'node_modules/oxlint/bin/oxlint'), 'src/', 'test/'], { cwd: app });
  await run('build', process.execPath, [join(app, 'node_modules/@nestjs/cli/bin/nest.js'), 'build'], { cwd: app });
  await run('bundle', values.python, ['-m', 'src.demo_bundle', 'verify']);
  await run('diff', 'git', ['diff', '--check']);
  report.status = report.suites.some((suite) => suite.status === 'fail') ? 'fail'
    : report.suites.some((suite) => suite.status === 'skipped') ? 'partial' : 'pass';
  if (report.status === 'fail') process.exitCode = 1;
} catch (error) {
  report.status = 'fail';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  await writeJson(join(out, 'checks.json'), report);
  console.log(`[week7] ${report.status.toUpperCase()} — ${join(out, 'checks.json')}`);
}
