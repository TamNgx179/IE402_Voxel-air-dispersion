import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  FAKE_SOLVER,
  prepareTestDatabase,
  waitFor,
} from './support/test-db.js';

/**
 * Full executor cycle against PostGIS with a fake solver (same CLI and
 * contract as `python -m src.solver`, test/fixtures/fake-solver.mjs).
 */

const db = await prepareTestDatabase();
const TIMEOUT_S = 3;

describe.skipIf(!db.ok)('SimulationExecutor (e2e, fake solver)', () => {
  let app: INestApplication;
  let artifactDir: string;
  const pool = db.ok ? db.pool : (undefined as never);
  const http = () => request(app.getHttpServer());

  const env = () => ({
    DATABASE_URL: db.ok ? db.url : '',
    EXECUTOR_ENABLED: 'true',
    EXECUTOR_POLL_MS: '50',
    SOLVER_MODE: 'mock',
    SOLVER_TIMEOUT_S: String(TIMEOUT_S),
    SOLVER_CMD: JSON.stringify([process.execPath, FAKE_SOLVER]),
    ARTIFACT_DIR: artifactDir,
  });

  const getRun = async (id: string) =>
    (await http().get(`/api/runs/${id}`).expect(200)).body;
  const finished = (r: any) =>
    ['succeeded', 'failed', 'stale'].includes(r.status);

  async function submit(
    behavior = 'ok',
    body: object = { scenario_id: 'dry_nov_apr' },
  ) {
    process.env.FAKE_SOLVER_BEHAVIOR = behavior;
    const res = await http().post('/api/runs').send(body).expect(202);
    return res.body.run_id as string;
  }

  async function runToEnd(behavior: string, timeoutMs = 15_000) {
    const id = await submit(behavior);
    const run = await waitFor(() => getRun(id), finished, timeoutMs);
    return { id, run };
  }

  beforeAll(async () => {
    artifactDir = mkdtempSync(join(tmpdir(), 'voxel-artifacts-'));
    app = await createTestApp(env());
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    delete process.env.FAKE_SOLVER_BEHAVIOR;
    delete process.env.FAKE_SOLVER_DELAY_MS;
    if (artifactDir) rmSync(artifactDir, { recursive: true, force: true });
  });

  it('queued → running → succeeded, persisting metrics, checks and artifacts', async () => {
    process.env.FAKE_SOLVER_DELAY_MS = '600';
    const id = await submit('ok');
    const running = await waitFor(
      () => getRun(id),
      (r) => r.status === 'running' && r.progress > 0,
    );
    expect(running.started_at).not.toBeNull();
    expect(running.progress).toBeGreaterThan(0);
    expect(running.progress).toBeLessThan(1);
    const run = await waitFor(() => getRun(id), finished);
    delete process.env.FAKE_SOLVER_DELAY_MS;

    expect(run).toMatchObject({
      status: 'succeeded',
      progress: 1,
      attempt: 1,
      error: null,
      model_version: '0.0.0+fake',
      input_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      // A mock result must never look like a model result (BR-30).
      warnings: ['mock run: synthetic field, not a model result'],
      finished_at: expect.any(String),
      metrics: {
        dt_s: 0.5,
        courant: 0.5,
        steps: 1200,
        simulated_s: 600,
        emitted_kg: 1,
        remaining_kg: 0.4,
        escaped_kg: 0.6,
        correction_kg: 0,
        stopping_criterion: 'fixed_time',
      },
      verification: { status: 'pass' },
    });
    expect(run.verification.checks.map((c: any) => c.name).sort()).toEqual([
      'cfl',
      'face_divergence',
      'mass_balance',
      'positivity',
      'wall_flux',
    ]);

    const artifacts = await pool.query(
      'SELECT kind, path, sha256, size_bytes FROM artifacts WHERE run_id = $1 ORDER BY kind',
      [id],
    );
    expect(artifacts.rows.map((a) => a.kind)).toEqual([
      'columns',
      'concentration',
      'config',
      'log',
      'manifest',
      'metrics',
      'wind',
    ]);
    expect(artifacts.rows.find((a) => a.kind === 'wind').path).toBe(
      `${id}/wind.nc`,
    );

    // config.yaml = project config + run block, also kept in config_snapshot.
    const configYaml = readFileSync(
      join(artifactDir, id, 'config.yaml'),
      'utf8',
    );
    expect(configYaml).toMatch(
      new RegExp(
        `^run:\\n  run_id: ${id}\\n  scenario_id: dry_nov_apr\\n  model: fv`,
        'm',
      ),
    );
    expect(configYaml).toMatch(/^meteorology:/m);
    const snap = await pool.query(
      'SELECT config_snapshot FROM simulation_runs WHERE id = $1',
      [id],
    );
    expect(snap.rows[0].config_snapshot.run.run_id).toBe(id);
    const cols = await pool.query(
      'SELECT count(*)::int AS n FROM concentration_columns WHERE run_id = $1',
      [id],
    );
    expect(cols.rows[0].n).toBe(4);

    const slice = await http().get(`/api/runs/${id}/slices?z_m=1`).expect(200);
    expect(slice.body.feature_collection.features.length).toBeGreaterThan(0);
    const profile = await http()
      .get(`/api/runs/${id}/profile?i=1&j=0`)
      .expect(200);
    expect(profile.body.levels).toHaveLength(4);

    await http().post(`/api/runs/${id}/retry`).expect(409);
  });

  it.each([
    ['input', 'input', /exited with code 2[\s\S]*input error/],
    ['system', 'system', /exited with code 4[\s\S]*Traceback/],
    [
      'bad-checksum',
      'system',
      /exited 0 but the run was rejected: .*wind.*checksum mismatch/,
    ],
    ['wrong-run-id', 'system', /does not match run/],
    ['no-manifest', 'system', /manifest\.json is missing/],
    ['verification-fail-exit0', 'model', /verification failed: mass_balance/],
  ])('behavior %s → failed/%s', async (behavior, kind, message) => {
    const { id, run } = await runToEnd(behavior);
    expect(run.status).toBe('failed');
    expect(run.error.kind).toBe(kind);
    expect(run.error.message).toMatch(message);
    expect(run.finished_at).not.toBeNull();
    const a = await pool.query(
      'SELECT count(*)::int AS n FROM artifacts WHERE run_id = $1',
      [id],
    );
    expect(a.rows[0].n).toBe(0); // AC-13: no "successful" artifacts
    expect(
      await pool.query('SELECT 1 FROM run_metrics WHERE run_id = $1', [id]),
    ).toMatchObject({ rowCount: 0 });
  });

  it('exit 3 → failed/model, keeping the failed checks for diagnosis', async () => {
    const { id, run } = await runToEnd('model');
    expect(run).toMatchObject({
      status: 'failed',
      error: { kind: 'model' },
      metrics: null,
    });
    expect(run.error.message).toMatch(/exited with code 3/);
    expect(run.verification.status).toBe('fail');
    expect(
      run.verification.checks.find((c: any) => c.name === 'mass_balance')
        .status,
    ).toBe('fail');
    const a = await pool.query(
      'SELECT count(*)::int AS n FROM artifacts WHERE run_id = $1',
      [id],
    );
    expect(a.rows[0].n).toBe(0);
  });

  it(`a hung solver is killed after SOLVER_TIMEOUT_S → failed/timeout`, async () => {
    const started = Date.now();
    const { run } = await runToEnd('hang', 20_000);
    expect(run.status).toBe('failed');
    expect(run.error.kind).toBe('timeout');
    expect(run.error.message).toMatch(/timeout/);
    expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_S * 1000 - 200);
  }, 30_000);

  it('retry of a failed run re-runs it under the same run_id with attempt 2', async () => {
    const { id, run } = await runToEnd('input');
    expect(run.status).toBe('failed');
    process.env.FAKE_SOLVER_BEHAVIOR = 'ok';
    const res = await http().post(`/api/runs/${id}/retry`).expect(202);
    expect(res.body).toEqual({ run_id: id, status: 'queued', attempt: 2 });
    const again = await waitFor(() => getRun(id), finished);
    expect(again).toMatchObject({
      status: 'succeeded',
      attempt: 2,
      error: null,
    });
    await http().post(`/api/runs/${id}/retry`).expect(409);
  });

  it('runs one solver at a time (concurrency 1, AC-17)', async () => {
    process.env.FAKE_SOLVER_DELAY_MS = '300';
    const ids = [await submit('ok'), await submit('ok'), await submit('ok')];
    let maxRunning = 0;
    await waitFor(
      async () => {
        const r = await pool.query(
          `SELECT count(*) FILTER (WHERE status = 'running')::int AS running,
                  count(*) FILTER (WHERE status IN ('succeeded', 'failed'))::int AS done
           FROM simulation_runs WHERE id = ANY($1::uuid[])`,
          [ids],
        );
        maxRunning = Math.max(maxRunning, r.rows[0].running);
        return r.rows[0];
      },
      (r) => r.done === ids.length,
      20_000,
      20,
    );
    delete process.env.FAKE_SOLVER_DELAY_MS;
    expect(maxRunning).toBe(1);
    const statuses = await pool.query(
      `SELECT status, started_at, finished_at FROM simulation_runs WHERE id = ANY($1::uuid[]) ORDER BY started_at`,
      [ids],
    );
    expect(statuses.rows.every((r) => r.status === 'succeeded')).toBe(true);
    for (let k = 1; k < statuses.rows.length; k++) {
      expect(
        statuses.rows[k].started_at >= statuses.rows[k - 1].finished_at,
      ).toBe(true);
    }
  }, 30_000);

  it('on restart a run left running becomes stale and can be retried (BR-21)', async () => {
    await app.close();
    const id = (
      await pool.query(
        `INSERT INTO simulation_runs (scenario_id, status, started_at) VALUES ('dry_nov_apr', 'running', now()) RETURNING id`,
      )
    ).rows[0].id as string;
    app = await createTestApp(env());
    const run = await waitFor(
      () => getRun(id),
      (r) => r.status === 'stale',
    );
    expect(run.error.message).toMatch(/restarted/);
    process.env.FAKE_SOLVER_BEHAVIOR = 'ok';
    await http().post(`/api/runs/${id}/retry`).expect(202);
    const done = await waitFor(() => getRun(id), finished);
    // No snapshot was stored for this hand-made row: the executor takes one.
    expect(done.status).toBe('succeeded');
    expect(existsSync(join(artifactDir, id, 'config.yaml'))).toBe(true);
  }, 30_000);
});
