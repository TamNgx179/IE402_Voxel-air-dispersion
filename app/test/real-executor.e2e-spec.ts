import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  prepareTestDatabase,
  REPO_ROOT,
  waitFor,
} from './support/test-db.js';

const db = await prepareTestDatabase();

describe.skipIf(!db.ok)('SimulationExecutor (e2e, real Python solver)', () => {
  let app: INestApplication;
  let temporary: string;
  const pool = db.ok ? db.pool : (undefined as never);
  const python =
    process.env.PYTHON_BIN ??
    join(
      REPO_ROOT,
      '.venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    temporary = mkdtempSync(join(tmpdir(), 'ie402-real-e2e-'));
    const fixture = spawnSync(
      python,
      [
        join(REPO_ROOT, 'app/test/fixtures/create-real-solver-fixture.py'),
        temporary,
        join(REPO_ROOT, 'config/project.yaml'),
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    if (fixture.status !== 0)
      throw new Error(`cannot create real solver fixture: ${fixture.stderr}`);
    app = await createTestApp({
      DATABASE_URL: db.ok ? db.url : '',
      REPO_ROOT,
      PROJECT_CONFIG_PATH: join(temporary, 'project.yaml'),
      ARTIFACT_DIR: join(temporary, 'artifacts'),
      EXECUTOR_ENABLED: 'true',
      EXECUTOR_POLL_MS: '50',
      SOLVER_MODE: 'real',
      SOLVER_TIMEOUT_S: '120',
      SOLVER_CMD: JSON.stringify([python, '-m', 'src.solver']),
    });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  });

  it('HTTP → queue → real wind/FV subprocess → verified artifacts → PostGIS queries', async () => {
    const accepted = await http()
      .post('/api/runs')
      .send({ scenario_id: 'dry_nov_apr', model: 'fv' })
      .expect(202);
    const id = accepted.body.run_id as string;
    const run = await waitFor(
      async () => (await http().get(`/api/runs/${id}`).expect(200)).body,
      (value) => ['succeeded', 'failed'].includes(value.status),
      150_000,
      100,
    );
    expect(run.status, run.error?.message).toBe('succeeded');
    expect(run.model_version).toMatch(/^0\.1\.0/);
    expect(run.warnings.join(' ')).toMatch(/fixed-time run/);
    expect(run.verification.status).toBe('pass');
    expect(run.verification.checks.map((item: any) => item.name)).toContain(
      'sor_convergence',
    );
    const columns = await pool.query(
      'SELECT count(*)::int AS n FROM concentration_columns WHERE run_id = $1',
      [id],
    );
    expect(columns.rows[0].n).toBe(2 * 2);
    const artifacts = await http()
      .get(`/api/runs/${id}/artifacts`)
      .expect(200);
    expect(artifacts.body.artifacts.map((item: any) => item.kind)).toEqual(
      expect.arrayContaining([
        'wind', 'wind_vectors', 'concentration', 'columns', 'metrics', 'log', 'config',
      ]),
    );
    const vectors = await http().get(`/api/runs/${id}/artifacts/wind_vectors/download`).expect(200);
    const vectorField = JSON.parse(vectors.text ?? Buffer.from(vectors.body).toString('utf8'));
    expect(vectorField.run_id).toBe(id);
    expect(vectorField.source).toBe('corrected FV face velocities');
    const summary = await http()
      .get(`/api/runs/${id}/summary`)
      .expect(200);
    expect(summary.body.verification.status).toBe('pass');
    const persisted = await pool.query(
      'SELECT c_ug_m3 FROM concentration_columns WHERE run_id = $1 AND i = 1 AND j = 0',
      [id],
    );
    const profile = await http().get(`/api/runs/${id}/profile?i=1&j=0`).expect(200);
    expect(profile.body.levels.map((level: any) => level.concentration_ug_m3))
      .toEqual(persisted.rows[0].c_ug_m3);
    const slice = await http().get(`/api/runs/${id}/slices?z_m=1`).expect(200);
    const cell = slice.body.feature_collection.features.find((feature: any) =>
      feature.properties.i === 1 && feature.properties.j === 0);
    expect(cell.properties.concentration_ug_m3).toBe(persisted.rows[0].c_ug_m3[0]);
    const zeroThreshold = await http().get(`/api/runs/${id}/exceedance?z_m=1&threshold=0`).expect(200);
    expect(zeroThreshold.body.cell_count).toBeGreaterThan(0);
    expect(zeroThreshold.body.area_m2).toBe(zeroThreshold.body.cell_count * 25);
    expect(zeroThreshold.body.volume_m3).toBe(zeroThreshold.body.cell_count * 50);
  }, 170_000);
});
