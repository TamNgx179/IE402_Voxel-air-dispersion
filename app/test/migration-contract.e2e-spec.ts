import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prepareTestDatabase, REPO_ROOT } from './support/test-db.js';
import { publishFixtureRun } from './support/published-run.js';

const db = await prepareTestDatabase();

describe.skipIf(!db.ok)(
  'Result contract upgrade with existing PostGIS data',
  () => {
    const pool = db.ok ? db.pool : (undefined as never);
    afterAll(async () => {
      await pool?.end();
    });

    it.each(['valid', 'negative', 'missing-grid', 'incomplete-publication'])(
      'upgrades or atomically refuses the %s legacy dataset',
      async (kind) => {
        const client = await pool.connect();
        const schema = `upgrade_${randomUUID().replaceAll('-', '')}`;
        try {
          await client.query('BEGIN');
          // A transactional private schema exercises the real old schema without
          // replacing the application's public schema or keeping test debris.
          await client.query(`CREATE SCHEMA ${schema}`);
          await client.query(`SET LOCAL search_path TO ${schema},public`);
          for (const file of [
            '0001_init.sql',
            '0003_production_results.sql',
            '0004_voxel_integrity.sql',
          ]) {
            await client.query(
              await readFile(join(REPO_ROOT, 'db/migrations', file), 'utf8'),
            );
          }
          const {
            rows: [area],
          } = await client.query(`INSERT INTO study_areas(name,geom,grid)
          VALUES('Upgrade fixture',ST_MakeEnvelope(0,0,5,5,32648),
            '{"origin_x_m":0,"origin_y_m":0,"dx_m":5,"dy_m":5,"dz_m":2,"nx":1,"ny":1,"nz":1}') RETURNING id`);
          await client.query(
            `INSERT INTO scenarios(id,study_area_id,name,wind_from_deg,wind_speed_m_s)
          VALUES('upgrade',$1,'Upgrade',0,1)`,
            [area.id],
          );
          await client.query(
            `INSERT INTO grid_cells(study_area_id,i,j,geom)
          VALUES($1,0,0,ST_MakeEnvelope(0,0,5,5,32648))`,
            [area.id],
          );
          const id = randomUUID();
          await client.query(
            "INSERT INTO simulation_runs(id,scenario_id,status) VALUES($1,'upgrade','running')",
            [id],
          );
          await client.query(
            `INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,0,$2)`,
            [id, [kind === 'negative' ? -1 : 0]],
          );
          await publishFixtureRun(client, id);
          if (kind === 'missing-grid')
            await client.query('DELETE FROM grid_cells');
          if (kind === 'incomplete-publication')
            await client.query('DELETE FROM artifacts');
          await client.query('SAVEPOINT before_upgrade');
          const sql = await readFile(
            join(REPO_ROOT, 'db/migrations/0005_result_contract.sql'),
            'utf8',
          );
          if (kind === 'valid') {
            await client.query(sql);
            const {
              rows: [column],
            } = await client.query(
              'SELECT study_area_id,c_ug_m3 FROM concentration_columns WHERE run_id=$1',
              [id],
            );
            expect(column).toEqual({ study_area_id: area.id, c_ug_m3: [0] });
          } else {
            await expect(client.query(sql)).rejects.toThrow();
            await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
            const { rows } = await client.query(
              `SELECT column_name FROM information_schema.columns
            WHERE table_schema=$1 AND table_name='concentration_columns' AND column_name='study_area_id'`,
              [schema],
            );
            expect(rows).toHaveLength(0);
            expect(
              (
                await client.query(
                  'SELECT c_ug_m3 FROM concentration_columns WHERE run_id=$1',
                  [id],
                )
              ).rows[0].c_ug_m3,
            ).toEqual([kind === 'negative' ? -1 : 0]);
          }
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );
  },
);
