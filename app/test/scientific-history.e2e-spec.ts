import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareTestDatabase, REPO_ROOT } from './support/test-db.js';
import { publishFixtureRun } from './support/published-run.js';

const db = await prepareTestDatabase();
describe.skipIf(!db.ok)(
  'Scientific history and coverage with real PostGIS',
  () => {
    const pool = db.ok ? db.pool : (undefined as never);
    afterAll(async () => {
      await pool?.end();
    });

    // A tiny independent scene keeps each negative case isolated and rolls it back.
    async function scene(c: pg.PoolClient) {
      const area = randomUUID(),
        scenario = randomUUID();
      await c.query(
        `INSERT INTO study_areas(id,name,geom,grid) VALUES($1,$2,
      ST_MakeEnvelope(0,0,5,5,32648),
      '{"origin_x_m":0,"origin_y_m":0,"dx_m":5,"dy_m":5,"dz_m":2,"nx":1,"ny":1,"nz":2}')`,
        [area, scenario],
      );
      await c.query(
        `INSERT INTO scenarios(id,study_area_id,name,wind_from_deg,wind_speed_m_s)
      VALUES($1,$2,'History fixture',0,1)`,
        [scenario, area],
      );
      await c.query(
        `INSERT INTO grid_cells(study_area_id,i,j,geom,solid_from_k,solid_to_k)
      VALUES($1,0,0,ST_MakeEnvelope(0,0,5,5,32648),0,0)`,
        [area],
      );
      await c.query(
        `INSERT INTO building_footprints(study_area_id,source_feature_id,geom,height_m,height_source)
      VALUES($1,'building',ST_Multi(ST_MakeEnvelope(0,0,2,2,32648)),2,'osm:height')`,
        [area],
      );
      await c.query(
        `INSERT INTO road_segments(study_area_id,source_feature_id,geom)
      VALUES($1,'road',ST_GeomFromText('LINESTRING(0 0,5 5)',32648))`,
        [area],
      );
      for (const table of ['water_features', 'green_features'])
        await c.query(
          `INSERT INTO ${table}(study_area_id,source_feature_id,geom) VALUES($1,'feature',ST_MakeEnvelope(0,0,1,1,32648))`,
          [area],
        );
      return { area, scenario };
    }
    async function run(
      c: pg.PoolClient,
      scenario: string,
      values: (number | null)[] = [null, 0],
    ) {
      const id = randomUUID();
      await c.query(
        "INSERT INTO simulation_runs(id,scenario_id,status) VALUES($1,$2,'running')",
        [id, scenario],
      );
      await c.query(
        'INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,0,$2)',
        [id, values],
      );
      return id;
    }
    async function rollback(work: (c: pg.PoolClient) => Promise<void>) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await work(c);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    }

    it.each([
      'UPDATE study_areas SET geom=ST_Translate(geom,1,0) WHERE id=$1',
      "UPDATE study_areas SET provenance='{}'::jsonb || '{\"changed\":true}' WHERE id=$1",
      'UPDATE grid_cells SET solid_to_k=1 WHERE study_area_id=$1',
      'UPDATE grid_cells SET geom=ST_Translate(geom,1,0) WHERE study_area_id=$1',
      'DELETE FROM grid_cells WHERE study_area_id=$1',
      'UPDATE building_footprints SET height_m=3 WHERE study_area_id=$1',
      'UPDATE road_segments SET emission_weight=5 WHERE study_area_id=$1',
      'DELETE FROM water_features WHERE study_area_id=$1',
      'DELETE FROM green_features WHERE study_area_id=$1',
      'UPDATE scenarios SET wind_speed_m_s=2 WHERE study_area_id=$1',
      'UPDATE thresholds SET value_ug_m3=value_ug_m3+1 WHERE key IS NOT NULL AND $1::uuid IS NOT NULL',
    ])('refuses a used scene mutation: %s', async (sql) => {
      await expect(
        rollback(async (c) => {
          const s = await scene(c);
          await run(c, s.scenario);
          await c.query(sql, [s.area]);
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('permits no-op writes, unused scene edits, a new scenario and whole-run cleanup', async () => {
      await rollback(async (c) => {
        const s = await scene(c);
        const id = await run(c, s.scenario);
        await publishFixtureRun(c, id);
        await c.query(
          'UPDATE grid_cells SET geom=geom WHERE study_area_id=$1',
          [s.area],
        );
        const unused = await scene(c);
        await c.query(
          'UPDATE grid_cells SET solid_to_k=1 WHERE study_area_id=$1',
          [unused.area],
        );
        await c.query(
          `INSERT INTO scenarios(id,study_area_id,name,wind_from_deg,wind_speed_m_s)
        VALUES($1,$2,'New scenario',0,2)`,
          [randomUUID(), s.area],
        );
        await c.query('DELETE FROM simulation_runs WHERE id=$1', [id]);
        await c.query(
          'UPDATE grid_cells SET solid_to_k=1 WHERE study_area_id=$1',
          [s.area],
        );
      });
    });
    it('refuses truncation of scientific tables while any run exists', async () => {
      await expect(
        rollback(async (c) => {
          const s = await scene(c);
          await run(c, s.scenario);
          await c.query('TRUNCATE road_segments');
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it.each([
      'TRUNCATE concentration_columns',
      'TRUNCATE run_metrics',
      'TRUNCATE verification_checks',
      'TRUNCATE artifacts',
      'TRUNCATE simulation_runs CASCADE',
    ])('refuses %s while a published run exists', async (sql) => {
      await expect(
        rollback(async (c) => {
          const s = await scene(c);
          await publishFixtureRun(c, await run(c, s.scenario));
          await c.query(sql);
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('permits result truncation and re-publication while no run is published', async () => {
      await rollback(async (c) => {
        // Whole-run DELETE is the supported cleanup; it leaves nothing published.
        await c.query('DELETE FROM simulation_runs');
        const s = await scene(c);
        const id = await run(c, s.scenario);
        await c.query('TRUNCATE concentration_columns');
        await c.query(
          'INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,0,$2)',
          [id, [null, 0]],
        );
        await publishFixtureRun(c, id);
        expect(
          (await c.query('SELECT count(*)::int n FROM concentration_columns'))
            .rows[0].n,
        ).toBe(1);
      });
    });
    it.each([
      ['complete', [null, 0], true],
      ['complete', [null, null], false],
      ['partial', [null, 3], true],
      ['partial', [null, null], false],
      ['partial', [1, 3], false],
      ['complete', [1, 0], false],
    ] as const)('validates %s coverage %j', async (policy, values, valid) => {
      const work = () =>
        rollback(async (c) => {
          const s = await scene(c);
          const id = await run(c, s.scenario, [...values]);
          await c.query(
            'UPDATE simulation_runs SET coverage_policy=$2 WHERE id=$1',
            [id, policy],
          );
          await publishFixtureRun(c, id);
        });
      if (valid) await work();
      else await expect(work()).rejects.toMatchObject({ code: '23514' });
    });
    it('accepts explicitly partial air data but refuses it under complete policy', async () => {
      await rollback(async (c) => {
        const s = await scene(c);
        // Extend the unused scene to two air layers so partial coverage has both a datum and a gap.
        await c.query(
          `UPDATE study_areas SET grid=jsonb_set(grid,'{nz}','3') WHERE id=$1`,
          [s.area],
        );
        const id = await run(c, s.scenario, [null, 0, null]);
        await c.query('SAVEPOINT coverage');
        await expect(publishFixtureRun(c, id)).rejects.toMatchObject({
          code: '23514',
        });
        await c.query('ROLLBACK TO SAVEPOINT coverage');
        await publishFixtureRun(c, id, { partial: true });
        expect(
          (
            await c.query(
              'SELECT coverage_policy FROM simulation_runs WHERE id=$1',
              [id],
            )
          ).rows[0].coverage_policy,
        ).toBe('partial');
      });
    });
    it.each([
      "status='running'",
      "coverage_policy='partial'",
      "input_hash='rewritten'",
    ])('protects published metadata: %s', async (assignment) => {
      await expect(
        rollback(async (c) => {
          const s = await scene(c);
          const id = await run(c, s.scenario);
          await publishFixtureRun(c, id);
          await c.query(
            `UPDATE simulation_runs SET ${assignment} WHERE id=$1`,
            [id],
          );
        }),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('fails closed for scientific writes under a retained repeatable-read snapshot', async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        await expect(
          c.query('UPDATE grid_cells SET geom=geom WHERE false'),
        ).rejects.toMatchObject({ code: '25001' });
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    });
    it('serializes first-run creation against a concurrent scene mutation', async () => {
      const a = await pool.connect(),
        b = await pool.connect();
      let s: Awaited<ReturnType<typeof scene>> | undefined;
      try {
        await a.query('BEGIN');
        s = await scene(a);
        await a.query('COMMIT');
        await a.query('BEGIN');
        await run(a, s.scenario);
        // A bounded wait proves the second connection really encounters the history lock.
        await b.query("SET lock_timeout='100ms'");
        await expect(
          b.query('UPDATE grid_cells SET solid_to_k=1 WHERE study_area_id=$1', [
            s.area,
          ]),
        ).rejects.toMatchObject({ code: '55P03' });
        await a.query('COMMIT');
        await expect(
          b.query('UPDATE grid_cells SET solid_to_k=1 WHERE study_area_id=$1', [
            s.area,
          ]),
        ).rejects.toMatchObject({ code: '23514' });
      } finally {
        await a.query('ROLLBACK');
        await b.query('RESET lock_timeout');
        if (s) {
          await a.query('DELETE FROM simulation_runs WHERE scenario_id=$1', [
            s.scenario,
          ]);
          await a.query('DELETE FROM scenarios WHERE id=$1', [s.scenario]);
          await a.query('DELETE FROM study_areas WHERE id=$1', [s.area]);
        }
        a.release();
        b.release();
      }
    });
    it.each(['valid', 'missing-air', 'solid-value'] as const)(
      'audits a %s legacy scene atomically',
      async (kind) => {
        const c = await pool.connect();
        const ns = 'history_' + randomUUID().replaceAll('-', '');
        try {
          await c.query('BEGIN');
          await c.query(`CREATE SCHEMA ${ns}`);
          await c.query(`SET LOCAL search_path TO ${ns},public`);
          for (const file of [
            '0001_init.sql',
            '0003_production_results.sql',
            '0004_voxel_integrity.sql',
            '0005_result_contract.sql',
          ])
            await c.query(
              await readFile(join(REPO_ROOT, 'db/migrations', file), 'utf8'),
            );
          const s = await scene(c);
          const id = await run(
            c,
            s.scenario,
            kind === 'valid'
              ? [null, 0]
              : kind === 'solid-value'
                ? [1, 0]
                : [null, null],
          );
          await publishFixtureRun(c, id);
          await c.query('SAVEPOINT upgrade');
          const sql = await readFile(
            join(
              REPO_ROOT,
              'db/migrations/0006_scene_history_and_coverage.sql',
            ),
            'utf8',
          );
          if (kind === 'valid') await c.query(sql);
          else {
            await expect(c.query(sql)).rejects.toMatchObject({ code: '23514' });
            await c.query('ROLLBACK TO SAVEPOINT upgrade');
            expect(
              (
                await c.query(
                  `SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='simulation_runs' AND column_name='coverage_policy'`,
                  [ns],
                )
              ).rowCount,
            ).toBe(0);
          }
        } finally {
          await c.query('ROLLBACK');
          c.release();
        }
      },
    );
  },
);
