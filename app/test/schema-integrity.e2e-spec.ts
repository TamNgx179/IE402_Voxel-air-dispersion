import { randomUUID } from 'node:crypto';
import { publishFixtureRun } from './support/published-run.js';
import type pg from 'pg';
import { prepareTestDatabase } from './support/test-db.js';

/**
 * The schema is the last line of defence: rows that bypass the API (imports,
 * manual SQL in an admin console) must still be rejected by PostgreSQL itself.
 * Every statement runs in a transaction that is rolled back, so the seeded
 * fixture stays intact for the other suites.
 */
const db = await prepareTestDatabase();
describe.skipIf(!db.ok)('Schema integrity with actual PostGIS', () => {
  const pool = db.ok ? db.pool : (undefined as never);
  let area: string;
  let grid: { nx: number; ny: number; nz: number };

  beforeAll(async () => {
    const { rows } = await pool.query<{
      id: string;
      grid: { nx: number; ny: number; nz: number };
    }>(
      `SELECT sa.id, sa.grid FROM scenarios s
       JOIN study_areas sa ON sa.id = s.study_area_id WHERE s.id = 'dry_nov_apr'`,
    );
    area = rows[0].id;
    grid = rows[0].grid;
  });

  /** Runs `work` in a transaction that is always rolled back. */
  async function rolledBack<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      return await work(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  async function insertRun(
    client: pg.PoolClient,
    columns: Record<string, unknown> = {},
  ) {
    const values = {
      id: randomUUID(),
      scenario_id: 'dry_nov_apr',
      status: 'queued',
      ...columns,
    };
    const keys = Object.keys(values);
    await client.query(
      `INSERT INTO simulation_runs(${keys.join(',')})
       VALUES(${keys.map((_, n) => `$${n + 1}`).join(',')})`,
      Object.values(values),
    );
    return values.id as string;
  }

  const fails = (
    work: (client: pg.PoolClient) => Promise<unknown>,
    expected: Record<string, unknown>,
  ) => expect(rolledBack(work)).rejects.toMatchObject(expected);

  describe('simulation runs', () => {
    it('accepts a queued run, but rejects publication without its result children', async () => {
      await rolledBack(async (client) => {
        await insertRun(client);
      });
      await fails(
        (client) =>
          insertRun(client, {
            status: 'succeeded',
            progress: 1,
            model_version: '0.1.0',
            input_hash: 'fixture',
            finished_at: new Date(),
          }),
        { code: '23514' },
      );
    });
    it.each([
      [{ status: 'cancelled' }, 'simulation_runs_status_check'],
      [{ model: 'rans' }, 'simulation_runs_model_check'],
      [{ progress: 1.5 }, 'simulation_runs_progress_check'],
      [{ attempt: 0 }, 'simulation_runs_attempt_check'],
      [{ status: 'failed' }, 'simulation_runs_failed_has_kind'],
      [
        { status: 'failed', error_kind: 'oom' },
        'simulation_runs_error_kind_check',
      ],
      [
        {
          status: 'succeeded',
          model_version: '0.1.0',
          finished_at: new Date(),
        },
        'simulation_runs_succeeded_complete',
      ],
    ])('rejects %o via %s', async (columns, constraint) => {
      await fails((client) => insertRun(client, columns), {
        code: '23514',
        constraint,
      });
    });

    it('requires an existing scenario and keeps scenarios that runs use', async () => {
      await fails((client) => insertRun(client, { scenario_id: 'monsoon' }), {
        code: '23503',
      });
      await fails(
        async (client) => {
          await insertRun(client);
          await client.query(`DELETE FROM scenarios WHERE id = 'dry_nov_apr'`);
        },
        { code: '23503' },
      );
    });

    it('deletes columns, checks and artifacts together with their run', async () => {
      const counts = await rolledBack(async (client) => {
        const id = await insertRun(client);
        await client.query(
          `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,0,$2)`,
          [id, Array(grid.nz).fill(1)],
        );
        await client.query(
          `INSERT INTO verification_checks(run_id,check_name,status) VALUES($1,'cfl','pass')`,
          [id],
        );
        await client.query(
          `INSERT INTO artifacts(run_id,kind,path,sha256,size_bytes)
           VALUES($1,'manifest','m.json',$2,10)`,
          [id, 'a'.repeat(64)],
        );
        await client.query('DELETE FROM simulation_runs WHERE id = $1', [id]);
        const { rows } = await client.query<{ n: string }>(
          `SELECT (SELECT count(*) FROM concentration_columns WHERE run_id=$1)
                + (SELECT count(*) FROM verification_checks WHERE run_id=$1)
                + (SELECT count(*) FROM artifacts WHERE run_id=$1) AS n`,
          [id],
        );
        return Number(rows[0].n);
      });
      expect(counts).toBe(0);
    });
  });

  describe('result rows', () => {
    it('rejects concentration columns that do not fit the run grid', async () => {
      const column = (i: number, j: number, length: number) =>
        fails(
          async (client) => {
            const id = await insertRun(client);
            await client.query(
              `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,$2,$3,$4)`,
              [id, i, j, Array(length).fill(0)],
            );
          },
          { code: 'P0001' },
        );
      await column(0, 0, grid.nz + 1);
      await column(grid.nx, 0, grid.nz);
      await column(0, grid.ny, grid.nz);
    });

    it('rejects a column for a run that does not exist', async () => {
      await fails(
        (client) =>
          client.query(
            `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,0,$2)`,
            [randomUUID(), Array(grid.nz).fill(0)],
          ),
        { code: 'P0001' },
      );
    });

    it('keeps NULL (missing or solid) and zero as different stored values', async () => {
      const stored = await rolledBack(async (client) => {
        const id = await insertRun(client);
        const values = Array(grid.nz).fill(0);
        values[0] = null;
        await client.query(
          `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,0,$2)`,
          [id, values],
        );
        const { rows } = await client.query<{ first: null; second: number }>(
          `SELECT c_ug_m3[1] AS first, c_ug_m3[2]::float8 AS second
           FROM concentration_columns WHERE run_id = $1`,
          [id],
        );
        return rows[0];
      });
      expect(stored).toEqual({ first: null, second: 0 });
    });

    it.each([
      ['an uppercase digest', 'A'.repeat(64), 1],
      ['a short digest', 'a'.repeat(63), 1],
      ['a negative size', 'a'.repeat(64), -1],
    ])('rejects an artifact with %s', async (_name, sha256, size) => {
      await fails(
        async (client) => {
          const id = await insertRun(client);
          await client.query(
            `INSERT INTO artifacts(run_id,kind,path,sha256,size_bytes)
             VALUES($1,'manifest','m.json',$2,$3)`,
            [id, sha256, size],
          );
        },
        { code: '23514' },
      );
    });

    it('accepts only the verification checks the solver reports', async () => {
      await fails(
        async (client) => {
          const id = await insertRun(client);
          await client.query(
            `INSERT INTO verification_checks(run_id,check_name,status) VALUES($1,'looks_fine','pass')`,
            [id],
          );
        },
        { code: '23514', constraint: 'verification_checks_check_name_check' },
      );
    });
  });

  describe('scene geometry', () => {
    const square =
      'POLYGON((686000 1191000,686010 1191000,686010 1191010,686000 1191010,686000 1191000))';
    const bowtie =
      'POLYGON((686000 1191000,686010 1191010,686010 1191000,686000 1191010,686000 1191000))';

    async function building(height: number, source: string, wkt = square) {
      await fails(
        (client) =>
          client.query(
            `INSERT INTO building_footprints(study_area_id,source_feature_id,height_m,height_source,geom)
             VALUES($1,'way/test',$2,$3,ST_Multi(ST_GeomFromText($4,32648)))`,
            [area, height, source, wkt],
          ),
        { code: '23514' },
      );
    }

    it('rejects invalid footprints, non-positive heights and unknown height sources', async () => {
      await building(20, 'gob:building_height', bowtie);
      await building(0, 'gob:building_height');
      await building(20, 'guess');
    });

    it('rejects a geometry in another CRS', async () => {
      await fails(
        (client) =>
          client.query(
            `INSERT INTO building_footprints(study_area_id,source_feature_id,height_m,height_source,geom)
             VALUES($1,'way/test',20,'gob:building_height',
               ST_Multi(ST_GeomFromText('POLYGON((106.7 10.77,106.71 10.77,106.71 10.78,106.7 10.77))',4326)))`,
            [area],
          ),
        { code: '22023' },
      );
    });

    it('rejects negative road emission weights and grid indices', async () => {
      await fails(
        (client) =>
          client.query(
            `INSERT INTO road_segments(study_area_id,source_feature_id,emission_weight,geom)
             VALUES($1,'way/test',-1,ST_GeomFromText('LINESTRING(686000 1191000,686010 1191000)',32648))`,
            [area],
          ),
        { code: '23514' },
      );
      await fails(
        (client) =>
          client.query(
            `INSERT INTO grid_cells(study_area_id,i,j,geom)
             VALUES($1,-1,0,ST_GeomFromText($2,32648))`,
            [area, square],
          ),
        { code: '23514' },
      );
    });

    it('rejects scenario winds outside 0–360° and negative speeds', async () => {
      for (const [from, speed] of [
        [360, 1],
        [-1, 1],
        [90, -0.1],
      ])
        await fails(
          (client) =>
            client.query(
              `INSERT INTO scenarios(id,study_area_id,name,wind_from_deg,wind_speed_m_s)
               VALUES('bad',$1,'Bad',$2,$3)`,
              [area, from, speed],
            ),
          { code: '23514' },
        );
    });
  });

  describe('scientific publication contract', () => {
    /** Populate the real grid and synthetic metadata before publication. */
    async function complete(client: pg.PoolClient) {
      const id = await insertRun(client, { status: 'running' });
      await client.query(
        `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3)
        SELECT $1,i,j,array_fill(0::real,ARRAY[$2::int]) FROM grid_cells WHERE study_area_id=$3`,
        [id, grid.nz, area],
      );
      await publishFixtureRun(client, id);
      return id;
    }

    it.each(['-1', 'NaN', 'Infinity', '-Infinity'])(
      'rejects %s in direct SQL arrays',
      async (value) => {
        await fails(
          async (client) => {
            const id = await insertRun(client);
            await client.query(
              `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3)
          VALUES($1,0,0,array_fill($2::real,ARRAY[$3::int]))`,
              [id, value, grid.nz],
            );
          },
          {
            code: '23514',
            constraint: 'concentration_columns_finite_nonnegative',
          },
        );
      },
    );

    it('derives a real grid FK and rejects a column whose grid row is absent', async () => {
      await fails(
        async (client) => {
          await client.query(
            'DELETE FROM grid_cells WHERE study_area_id=$1 AND i=0 AND j=0',
            [area],
          );
          const id = await insertRun(client);
          await client.query(
            `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3)
          VALUES($1,0,0,array_fill(0::real,ARRAY[$2::int]))`,
            [id, grid.nz],
          );
        },
        { code: '23503', constraint: 'concentration_columns_grid_fk' },
      );
    });

    it('prevents deletion of a referenced grid row, but permits deleting its parent run', async () => {
      await fails(
        async (client) => {
          await complete(client);
          await client.query(
            'DELETE FROM grid_cells WHERE study_area_id=$1 AND i=0 AND j=0',
            [area],
          );
        },
        { code: '23503' },
      );
      await rolledBack(async (client) => {
        const id = await complete(client);
        await client.query('DELETE FROM simulation_runs WHERE id=$1', [id]);
        expect(
          (
            await client.query(
              'SELECT 1 FROM concentration_columns WHERE run_id=$1',
              [id],
            )
          ).rowCount,
        ).toBe(0);
      });
    });

    it.each([
      'run_metrics',
      'verification_checks',
      'artifacts',
      'concentration_columns',
    ])('protects published %s from direct deletion', async (table) => {
      await fails(
        async (client) => {
          const id = await complete(client);
          await client.query(`DELETE FROM ${table} WHERE run_id=$1`, [id]);
        },
        { code: '23514' },
      );
    });

    it('publishes all children atomically and enforces complete XY coverage', async () => {
      await rolledBack(async (client) => {
        const id = await complete(client);
        const {
          rows: [r],
        } = await client.query(
          'SELECT status,progress FROM simulation_runs WHERE id=$1',
          [id],
        );
        expect(r).toEqual({ status: 'succeeded', progress: 1 });
      });
      await fails(
        async (client) => {
          const id = await insertRun(client, { status: 'running' });
          await publishFixtureRun(client, id);
        },
        { code: '23514' },
      );
    });

    it.each(['metrics', 'artifacts', 'checks', 'failed-check'])(
      'rejects publication with missing or invalid %s',
      async (missing) => {
        await fails(
          async (client) => {
            const id = await insertRun(client, { status: 'running' });
            await client.query(
              `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3)
            SELECT $1,i,j,array_fill(0::real,ARRAY[$2::int]) FROM grid_cells WHERE study_area_id=$3`,
              [id, grid.nz, area],
            );
            // Queue synthetic children, then deliberately damage the unpublished set.
            await client.query('SAVEPOINT fixture_ready');
            // Avoid calling the helper's publication until the incomplete set is ready.
            await client.query('INSERT INTO run_metrics(run_id) VALUES($1)', [
              id,
            ]);
            await client.query(
              `INSERT INTO verification_checks(run_id,check_name,status)
            SELECT $1,n,'pass' FROM unnest(ARRAY['cfl','face_divergence','positivity','wall_flux','mass_balance']) n`,
              [id],
            );
            await client.query(
              `INSERT INTO artifacts(run_id,kind,path,sha256,size_bytes)
            SELECT $1,n,n,repeat('0',64),0 FROM unnest(ARRAY['config','wind','concentration','columns','metrics','log','manifest']) n`,
              [id],
            );
            if (missing === 'metrics')
              await client.query('DELETE FROM run_metrics WHERE run_id=$1', [
                id,
              ]);
            if (missing === 'artifacts')
              await client.query(
                "DELETE FROM artifacts WHERE run_id=$1 AND kind='manifest'",
                [id],
              );
            if (missing === 'checks')
              await client.query(
                "DELETE FROM verification_checks WHERE run_id=$1 AND check_name='mass_balance'",
                [id],
              );
            if (missing === 'failed-check')
              await client.query(
                "UPDATE verification_checks SET status='fail' WHERE run_id=$1 AND check_name='mass_balance'",
                [id],
              );
            await client.query(
              `UPDATE simulation_runs SET status='succeeded',progress=1,model_version='fixture',input_hash='fixture',finished_at=now() WHERE id=$1`,
              [id],
            );
          },
          { code: '23514' },
        );
      },
    );

    it('rejects out-of-range grid indices and incomplete grid metadata', async () => {
      await fails(
        (client) =>
          client.query(
            `INSERT INTO grid_cells(study_area_id,i,j,geom)
        SELECT study_area_id,$2,0,geom FROM grid_cells WHERE study_area_id=$1 LIMIT 1`,
            [area, grid.nx],
          ),
        { code: '23514' },
      );
      await fails(
        (client) =>
          client.query(
            "UPDATE study_areas SET grid=jsonb_set(grid,'{nz}','0') WHERE id=$1",
            [area],
          ),
        { code: '23514' },
      );
    });

    it('serializes a concurrent child deletion with publication', async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO simulation_runs(id,scenario_id,status) VALUES($1,'dry_nov_apr','running')",
        [id],
      );
      await pool.query(
        `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3)
        SELECT $1,i,j,array_fill(0::real,ARRAY[$2::int]) FROM grid_cells WHERE study_area_id=$3`,
        [id, grid.nz, area],
      );
      const publisher = await pool.connect();
      const writer = await pool.connect();
      try {
        await publisher.query('BEGIN');
        await publishFixtureRun(publisher, id);
        await writer.query("SET lock_timeout='3s'");
        const deletion = writer
          .query(
            'DELETE FROM concentration_columns WHERE run_id=$1 AND i=0 AND j=0',
            [id],
          )
          .then(
            () => null,
            (error) => error as { code: string },
          );
        await publisher.query('COMMIT');
        expect(await deletion).toMatchObject({ code: '23514' });
        expect(
          (
            await pool.query(
              'SELECT 1 FROM concentration_columns WHERE run_id=$1',
              [id],
            )
          ).rowCount,
        ).toBe(grid.nx * grid.ny);
      } finally {
        await publisher.query('ROLLBACK');
        await writer.query('RESET lock_timeout');
        publisher.release();
        writer.release();
        await pool.query('DELETE FROM simulation_runs WHERE id=$1', [id]);
      }
    });
  });
});
