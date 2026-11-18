import { randomUUID } from 'node:crypto';
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
    it('accepts a queued run and a complete succeeded run', async () => {
      await rolledBack(async (client) => {
        await insertRun(client);
        await insertRun(client, {
          status: 'succeeded',
          model_version: '0.1.0',
          input_hash: 'sha256:abc',
          finished_at: new Date(),
        });
      });
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
});
