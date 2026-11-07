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

  it.each([
    ['dry_nov_apr',1],['dry_nov_apr',0.8],['dry_nov_apr',0.6],
    ['wet_may_oct',1],['wet_may_oct',0.8],['wet_may_oct',0.6],
  ] as const)(
    'HTTP → real wind/FV → PostGIS → viewer contract (%s, source=%s)',
    async (scenario, multiplier) => {
      const accepted = await http()
        .post('/api/runs')
        .send({ scenario_id: scenario, model: 'fv', emission_multiplier: multiplier })
        .expect(202);
      const id = accepted.body.run_id as string;
      const run = await waitFor(
        async () => (await http().get(`/api/runs/${id}`).expect(200)).body,
        (value) => ['succeeded', 'failed'].includes(value.status),
        150_000,
        100,
      );
      expect(run.status, run.error?.message).toBe('succeeded');
      expect(run.scenario.id).toBe(scenario);
      expect(run.emission_multiplier).toBe(multiplier);
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
          'wind',
          'wind_vectors',
          'concentration',
          'columns',
          'metrics',
          'log',
          'config',
        ]),
      );
      const vectors = await http()
        .get(`/api/runs/${id}/artifacts/wind_vectors/download`)
        .expect(200);
      const vectorField = JSON.parse(
        vectors.text ?? Buffer.from(vectors.body).toString('utf8'),
      );
      expect(vectorField.run_id).toBe(id);
      expect(vectorField.source).toBe('corrected FV face velocities');
      const volume = await http().get(`/api/runs/${id}/volume`).expect(200);
      expect(volume.body).toMatchObject({
        run_id: id,
        axis_order: 'z,y,x',
        shape: [4, 2, 2],
      });
      expect(Buffer.from(volume.body.codes_base64, 'base64')).toHaveLength(16);
      const runs = await http()
        .get('/api/runs?status=succeeded&limit=20')
        .expect(200);
      expect(runs.body.find((item: any) => item.run_id === id)).toMatchObject({
        model: 'fv',
        scenario_id: scenario,
      });
      const summary = await http().get(`/api/runs/${id}/summary`).expect(200);
      expect(summary.body.emission_multiplier).toBe(multiplier);
      const manifestResponse = await http().get(`/api/runs/${id}/artifacts/manifest/download`).expect(200);
      const declared = JSON.parse(manifestResponse.text ?? Buffer.from(manifestResponse.body).toString('utf8'));
      expect(declared.scenario.emission_multiplier).toBe(multiplier);
      expect(summary.body.verification.status).toBe('pass');
      // Independent read of the saved float32 NetCDF: do not use rounded DB text as the oracle.
      const reference = spawnSync(
        python,
        [
          '-c',
          'import sys,json,numpy as np,xarray as xr; d=xr.open_dataset(sys.argv[1]); a=d["C"].values.astype(np.float64); print(json.dumps(np.where(np.isfinite(a),a,None).tolist()))',
          join(temporary, 'artifacts', id, 'concentration.nc'),
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      );
      expect(reference.status, reference.stderr).toBe(0);
      const exact = JSON.parse(reference.stdout);
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const profile = await http()
            .get(`/api/runs/${id}/profile?i=${i}&j=${j}`)
            .expect(200);
          expect(
            profile.body.levels.map((l: any) => l.concentration_ug_m3),
          ).toEqual(exact.map((layer: any) => layer[j][i]));
        }
      for (let k = 0; k < 4; k++) {
        const slice = await http()
          .get(`/api/runs/${id}/slices?z_m=${2 * k + 1}`)
          .expect(200);
        for (const feature of slice.body.feature_collection.features) {
          const p = feature.properties;
          expect(p.concentration_ug_m3).toBe(exact[k][p.j][p.i]);
        }
      }
      const persisted = await pool.query(
        'SELECT c_ug_m3::double precision[] AS c_ug_m3 FROM concentration_columns WHERE run_id = $1 AND i = 1 AND j = 0',
        [id],
      );
      const profile = await http()
        .get(`/api/runs/${id}/profile?i=1&j=0`)
        .expect(200);
      expect(
        profile.body.levels.map((level: any) => level.concentration_ug_m3),
      ).toEqual(persisted.rows[0].c_ug_m3);
      const slice = await http()
        .get(`/api/runs/${id}/slices?z_m=1`)
        .expect(200);
      const cell = slice.body.feature_collection.features.find(
        (feature: any) =>
          feature.properties.i === 1 && feature.properties.j === 0,
      );
      expect(cell.properties.concentration_ug_m3).toBe(
        persisted.rows[0].c_ug_m3[0],
      );
      const zeroThreshold = await http()
        .get(`/api/runs/${id}/exceedance?z_m=1&threshold=0`)
        .expect(200);
      expect(zeroThreshold.body.cell_count).toBeGreaterThan(0);
      expect(zeroThreshold.body.area_m2).toBe(
        zeroThreshold.body.cell_count * 25,
      );
      expect(zeroThreshold.body.volume_m3).toBe(
        zeroThreshold.body.cell_count * 50,
      );
    },
    170_000,
  );
});
