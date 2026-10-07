import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { projectConfigPath } from '../src/common/project-config.js';
import { seed } from '../src/database/seed.js';
import {
  createTestApp,
  FIXTURE_SCENE,
  prepareTestDatabase,
  REPO_ROOT,
} from './support/test-db.js';

const db = await prepareTestDatabase();

describe.skipIf(!db.ok)('API with PostGIS (e2e, executor disabled)', () => {
  let app: INestApplication;
  const pool = db.ok ? db.pool : (undefined as never);
  const http = () => request(app.getHttpServer());
  const runCount = async () =>
    Number(
      (await pool.query('SELECT count(*) AS n FROM simulation_runs')).rows[0].n,
    );

  beforeAll(async () => {
    app = await createTestApp({
      DATABASE_URL: db.ok ? db.url : '',
      EXECUTOR_ENABLED: 'false',
    });
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  describe('schema (AC-14)', () => {
    it('has every table, the GiST indexes and the input_hash index', async () => {
      const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      expect(tables.rows.map((r) => r.table_name)).toEqual(
        expect.arrayContaining([
          'study_areas',
          'building_footprints',
          'road_segments',
          'water_features',
          'green_features',
          'grid_cells',
          'scenarios',
          'simulation_runs',
          'run_metrics',
          'verification_checks',
          'artifacts',
          'concentration_columns',
          'thresholds',
          'schema_migrations',
        ]),
      );
      const idx = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const defs = Object.fromEntries(
        idx.rows.map((r) => [r.indexname, r.indexdef]),
      );
      for (const t of [
        'study_areas',
        'building_footprints',
        'road_segments',
        'grid_cells',
        'water_features',
        'green_features',
      ]) {
        expect(defs[`${t}_geom_gist`]).toMatch(/USING gist/);
      }
      expect(defs.simulation_runs_status_created_idx).toMatch(
        /\(status, created_at\)/,
      );
      // Equal inputs may succeed many times: that is reproducibility evidence.
      expect(defs.simulation_runs_unique_success).toBeUndefined();
      expect(defs.simulation_runs_input_hash_idx).toMatch(/\(input_hash\)/);
      const srids = await pool.query(
        `SELECT DISTINCT srid FROM geometry_columns WHERE f_table_schema = 'public'`,
      );
      expect(srids.rows).toEqual([{ srid: 32648 }]);
    });

    it('rejects a concentration column whose length is not nz', async () => {
      const run = randomUUID();
      await pool.query(
        `INSERT INTO simulation_runs (id, scenario_id) VALUES ($1, 'dry_nov_apr')`,
        [run],
      );
      await expect(
        pool.query(
          `INSERT INTO concentration_columns VALUES ($1, 0, 0, '{1,2,3}')`,
          [run],
        ),
      ).rejects.toThrow(/nz = 4/);
      await expect(
        pool.query(
          `INSERT INTO concentration_columns VALUES ($1, 0, 0, '{1,NULL,3,4}')`,
          [run],
        ),
      ).resolves.toBeTruthy();
      await pool.query('DELETE FROM simulation_runs WHERE id = $1', [run]);
    });
  });

  describe('seed', () => {
    it('loaded the fixture scene and config', () => {
      expect(db.ok && db.seeded).toMatchObject({
        study_area: 'Fixture 2x2',
        buildings: 2,
        roads: 1,
        water: 0,
        green: 1,
        grid_cells: 4,
        scenarios: expect.arrayContaining(['dry_nov_apr', 'wet_may_oct']),
        thresholds: expect.arrayContaining(['qcvn_24h', 'who_24h']),
      });
    });

    it('is idempotent: re-running replaces, never duplicates', async () => {
      const count = async () =>
        (
          await pool.query(`SELECT
            (SELECT count(*) FROM study_areas)::int AS sa,
            (SELECT count(*) FROM building_footprints)::int AS b,
            (SELECT count(*) FROM road_segments)::int AS r,
            (SELECT count(*) FROM green_features)::int AS g,
            (SELECT count(*) FROM grid_cells)::int AS c,
            (SELECT count(*) FROM scenarios)::int AS s,
            (SELECT count(*) FROM thresholds)::int AS t`)
        ).rows[0];
      const before = await count();
      await seed(pool, {
        sceneDir: FIXTURE_SCENE,
        configPath: projectConfigPath(REPO_ROOT),
      });
      expect(await count()).toEqual(before);
      expect(before).toEqual({ sa: 1, b: 2, r: 1, g: 1, c: 4, s: 2, t: 2 });
    });

    it('stores thresholds with the config hash and grid cells with solid ranges', async () => {
      const t = await pool.query(`SELECT config_hash FROM thresholds`);
      expect(new Set(t.rows.map((r) => r.config_hash)).size).toBe(1);
      expect(t.rows[0].config_hash).toMatch(/^[0-9a-f]{64}$/);
      const c = await pool.query(
        `SELECT i, j, solid_from_k, solid_to_k, ST_Area(geom) AS area FROM grid_cells ORDER BY j, i`,
      );
      expect(c.rows[0]).toEqual({
        i: 0,
        j: 0,
        solid_from_k: 0,
        solid_to_k: 2,
        area: 25,
      });
      expect(c.rows[1]).toMatchObject({ i: 1, j: 0, solid_from_k: null });
    });
  });

  it('GET /api/health reports the database up with PostGIS', async () => {
    const res = await http().get('/api/health').expect(200);
    expect(res.body.database).toMatchObject({
      configured: true,
      status: 'up',
      postgis: expect.stringMatching(/^3\./),
    });
  });

  it('GET /api/study-areas returns grid, bounds and EPSG:4326 GeoJSON', async () => {
    const res = await http().get('/api/study-areas').expect(200);
    expect(res.body).toHaveLength(1);
    const sa = res.body[0];
    expect(sa).toMatchObject({
      id: expect.any(String),
      name: 'Fixture 2x2',
      srid: 32648,
      grid: { nx: 2, ny: 2, nz: 4, dx_m: 5, dy_m: 5, dz_m: 2 },
      geometry: { type: 'Polygon' },
      bounds_projected: [686000, 1191300, 686010, 1191310],
    });
    const [w, s, e, n] = sa.bounds;
    // UTM 48N near Nguyen Hue, Ho Chi Minh City.
    expect(w).toBeGreaterThan(106.6);
    expect(e).toBeLessThan(106.8);
    expect(s).toBeGreaterThan(10.7);
    expect(n).toBeLessThan(10.85);
    expect(e).toBeGreaterThan(w);
    expect(n).toBeGreaterThan(s);
    const [lon, lat] = sa.geometry.coordinates[0][0];
    expect(lon).toBeCloseTo(w, 4);
    expect(lat).toBeGreaterThan(10.7);
  });

  it('GET /api/scenarios lists the config scenarios', async () => {
    const res = await http().get('/api/scenarios').expect(200);
    const dry = res.body.find((s: any) => s.id === 'dry_nov_apr');
    expect(dry).toMatchObject({
      name: 'dry_nov_apr',
      wind_from_deg: 112,
      wind_speed_m_s: expect.closeTo(1.62, 5),
    });
    expect(res.body.map((s: any) => s.id)).toContain('wet_may_oct');
  });

  describe('POST /api/runs (BR-16, AC-11)', () => {
    it('creates a queued run with a config snapshot and answers 202', async () => {
      const res = await http()
        .post('/api/runs')
        .send({ scenario_id: 'dry_nov_apr' })
        .expect(202);
      expect(res.body).toEqual({
        run_id: expect.any(String),
        status: 'queued',
        attempt: 1,
      });
      const row = (
        await pool.query(
          'SELECT model, status, attempt, config_snapshot FROM simulation_runs WHERE id = $1',
          [res.body.run_id],
        )
      ).rows[0];
      expect(row).toMatchObject({ model: 'fv', status: 'queued', attempt: 1 });
      expect(row.config_snapshot.run).toEqual({
        run_id: res.body.run_id,
        scenario_id: 'dry_nov_apr',
        model: 'fv',
      });
      expect(
        row.config_snapshot.meteorology.scenarios.dry_nov_apr,
      ).toBeDefined();
    });

    it('accepts model "gaussian"', async () => {
      const res = await http()
        .post('/api/runs')
        .send({ scenario_id: 'wet_may_oct', model: 'gaussian' })
        .expect(202);
      const got = await http().get(`/api/runs/${res.body.run_id}`).expect(200);
      expect(got.body.model).toBe('gaussian');
    });

    it.each([
      [{}],
      [{ scenario_id: '' }],
      [{ scenario_id: 5 }],
      [{ scenario_id: 'dry_nov_apr', model: 'cfd' }],
      [{ scenario_id: 'dry_nov_apr', extra: true }],
      [{ scenario_id: "x'; DROP TABLE simulation_runs; --" }],
    ])('rejects %j with 400 and creates nothing', async (body) => {
      const before = await runCount();
      const res = await http().post('/api/runs').send(body).expect(400);
      expect(res.body.message).toBeDefined();
      expect(await runCount()).toBe(before);
    });

    it('rejects an unknown scenario with 404 and creates nothing', async () => {
      const before = await runCount();
      const res = await http()
        .post('/api/runs')
        .send({ scenario_id: 'no_such_scenario' })
        .expect(404);
      expect(res.body.message).toMatch(/no_such_scenario/);
      expect(await runCount()).toBe(before);
    });
  });

  describe('GET /api/runs/:id', () => {
    it('returns the run view of a queued run', async () => {
      const { body } = await http()
        .post('/api/runs')
        .send({ scenario_id: 'dry_nov_apr' })
        .expect(202);
      const res = await http().get(`/api/runs/${body.run_id}`).expect(200);
      expect(res.body).toMatchObject({
        run_id: body.run_id,
        status: 'queued',
        progress: 0,
        attempt: 1,
        model: 'fv',
        scenario: { id: 'dry_nov_apr', wind_from_deg: 112 },
        error: null,
        metrics: null,
        verification: null,
        started_at: null,
        finished_at: null,
        created_at: expect.any(String),
      });
    });

    it('400 for a non-UUID id, 404 for an unknown run', async () => {
      await http().get('/api/runs/not-a-uuid').expect(400);
      await http().get(`/api/runs/${randomUUID()}`).expect(404);
    });
  });

  describe('POST /api/runs/:id/retry', () => {
    let id: string;
    beforeEach(async () => {
      id = (
        await http()
          .post('/api/runs')
          .send({ scenario_id: 'dry_nov_apr' })
          .expect(202)
      ).body.run_id;
    });

    it('409 for queued, running and succeeded runs', async () => {
      await http().post(`/api/runs/${id}/retry`).expect(409);
      await pool.query(
        `UPDATE simulation_runs SET status = 'running' WHERE id = $1`,
        [id],
      );
      await http().post(`/api/runs/${id}/retry`).expect(409);
      await pool.query(
        `UPDATE simulation_runs SET status = 'succeeded', model_version = 'x', input_hash = $2, finished_at = now() WHERE id = $1`,
        [id, `sha256:${id}`],
      );
      const res = await http().post(`/api/runs/${id}/retry`).expect(409);
      expect(res.body.message).toMatch(/succeeded/);
    });

    it('failed → queued with attempt + 1, error cleared', async () => {
      await pool.query(
        `UPDATE simulation_runs SET status = 'failed', error_kind = 'system', error_message = 'boom', finished_at = now() WHERE id = $1`,
        [id],
      );
      const res = await http().post(`/api/runs/${id}/retry`).expect(202);
      expect(res.body).toEqual({ run_id: id, status: 'queued', attempt: 2 });
      const got = await http().get(`/api/runs/${id}`).expect(200);
      expect(got.body).toMatchObject({
        status: 'queued',
        attempt: 2,
        error: null,
        finished_at: null,
      });
    });

    it('stale → queued', async () => {
      await pool.query(
        `UPDATE simulation_runs SET status = 'stale' WHERE id = $1`,
        [id],
      );
      await http().post(`/api/runs/${id}/retry`).expect(202);
    });

    it('404 for an unknown run, 400 for a bad id', async () => {
      await http().post(`/api/runs/${randomUUID()}/retry`).expect(404);
      await http().post('/api/runs/123/retry').expect(400);
    });
  });

  it('serves slice, exceedance, profile, summary and compact volume (A5)', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO simulation_runs
         (id, scenario_id, status, model_version, input_hash, finished_at)
       VALUES ($1, 'dry_nov_apr', 'succeeded', 'test', $2, now())`,
      [id, `sha256:${'a'.repeat(64)}`],
    );
    await pool.query(
      `INSERT INTO concentration_columns (run_id, i, j, c_ug_m3) VALUES
       ($1, 0, 0, '{NULL,NULL,5,2}'),
       ($1, 1, 0, '{10,5,3,1}'),
       ($1, 0, 1, '{20,10,5,2}'),
       ($1, 1, 1, '{30,15,8,4}')`,
      [id],
    );

    const slice = await http().get(`/api/runs/${id}/slices?z_m=1`).expect(200);
    expect(slice.body).toMatchObject({ k: 0, z_m: 1, units: 'ug m-3' });
    expect(slice.body.feature_collection.features).toHaveLength(3);
    expect(slice.body.stats).toMatchObject({ air_cells: 3, max_ug_m3: 30 });

    const exceedance = await http()
      .get(`/api/runs/${id}/exceedance?z_m=1&threshold=15`)
      .expect(200);
    expect(exceedance.body).toMatchObject({
      cell_count: 2,
      area_m2: 50,
      volume_m3: 100,
    });

    const profile = await http()
      .get(`/api/runs/${id}/profile?i=1&j=0`)
      .expect(200);
    expect(
      profile.body.levels.map((level: any) => level.concentration_ug_m3),
    ).toEqual([10, 5, 3, 1]);

    const summary = await http().get(`/api/runs/${id}/summary`).expect(200);
    expect(summary.body.layers).toHaveLength(4);
    expect(summary.body.thresholds).toHaveLength(2);

    const volume = await http().get(`/api/runs/${id}/volume`).expect(200);
    expect(volume.body).toMatchObject({
      shape: [4, 2, 2],
      axis_order: 'z,y,x',
    });
    expect(Buffer.from(volume.body.codes_base64, 'base64')).toHaveLength(16);

    await http().get(`/api/runs/${id}/slices?z_m=999`).expect(400);
    await http().get(`/api/runs/${id}/profile?i=9&j=0`).expect(400);
  });
});
