import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DatabaseStatus } from '../../../database/database.service.js';
import { HealthService } from './health.service.js';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ie402-health-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function health(
  options: {
    artifactDir?: string;
    python?: string;
    database?: DatabaseStatus;
  } = {},
) {
  const values: Record<string, string> = {
    ARTIFACT_DIR: options.artifactDir ?? dir,
    // Node answers `--version` like Python does, so the probe needs no Python install.
    PYTHON_BIN: options.python ?? process.execPath,
  };
  const config = { get: (key: string) => values[key] };
  const database = {
    status: vi.fn(
      async () =>
        options.database ?? { configured: false, status: 'not_configured' },
    ),
  };
  return new HealthService(config as never, database as never);
}

describe('HealthService', () => {
  it('is ok in viewer-only mode with a writable artifact directory and a runtime', async () => {
    const report = await health().check();
    expect(report.status).toBe('ok');
    expect(report.app.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.artifactDir).toEqual({
      path: dir,
      exists: true,
      writable: true,
    });
    expect(report.python).toMatchObject({ bin: process.execPath, ok: true });
    expect(report.python).toHaveProperty('version', process.version);
  });

  it('is ok when the configured database is up', async () => {
    const report = await health({
      database: {
        configured: true,
        status: 'up',
        postgres: '16',
        postgis: '3.4',
      },
    }).check();
    expect(report.status).toBe('ok');
    expect(report.database).toMatchObject({ postgis: '3.4' });
  });

  it('degrades when a configured database is down', async () => {
    const report = await health({
      database: { configured: true, status: 'down', error: 'ECONNREFUSED' },
    }).check();
    expect(report.status).toBe('degraded');
    expect(report.database).toMatchObject({ error: 'ECONNREFUSED' });
  });

  it('degrades when the artifact directory is missing or is a file', async () => {
    const missing = await health({ artifactDir: join(dir, 'absent') }).check();
    expect(missing.status).toBe('degraded');
    expect(missing.artifactDir).toMatchObject({
      exists: false,
      writable: false,
    });

    const file = join(dir, 'artifact.txt');
    await writeFile(file, '');
    const notDir = await health({ artifactDir: file }).check();
    expect(notDir.artifactDir).toMatchObject({ exists: false });
  });

  it('degrades and reports the error when the Python binary cannot start', async () => {
    const report = await health({
      python: join(dir, 'no-such-python'),
    }).check();
    expect(report.status).toBe('degraded');
    expect(report.python).toMatchObject({ ok: false });
    expect(report.python).toHaveProperty(
      'error',
      expect.stringMatching(/ENOENT/),
    );
  });
});
