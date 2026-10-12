// Release regression: missing PostGIS or skipped E2E tests must not look green.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report = resolve(appRoot, '../artifacts/a7-api-e2e.json');
mkdirSync(dirname(report), { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    resolve(appRoot, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    './vitest.config.e2e.ts',
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${report}`,
  ],
  {
    cwd: appRoot,
    env: { ...process.env, E2E_REQUIRE_DB: '1' },
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const summary = JSON.parse(readFileSync(report, 'utf8'));
if (
  !summary.success ||
  summary.numPendingTests !== 0 ||
  summary.numTotalTests === 0
) {
  throw new Error(
    'Required E2E failed: empty suite, pending/skipped tests, or unsuccessful report',
  );
}
console.log(
  `Required E2E: ${summary.numPassedTests}/${summary.numTotalTests} passed; no skips. Report: ${report}`,
);
