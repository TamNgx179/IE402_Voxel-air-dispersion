import type pg from 'pg';

/** Synthetic metadata for query fixtures only, never scientific verification. */
export async function publishFixtureRun(
  pool: pg.Pool | pg.PoolClient,
  id: string,
) {
  await pool.query(
    'INSERT INTO run_metrics(run_id) VALUES($1) ON CONFLICT DO NOTHING',
    [id],
  );
  await pool.query(
    `INSERT INTO verification_checks(run_id,check_name,status,value,tolerance)
     SELECT $1,n,'pass',0,0 FROM unnest(ARRAY['cfl','face_divergence','positivity','wall_flux','mass_balance']) n
     ON CONFLICT DO NOTHING`,
    [id],
  );
  await pool.query(
    `INSERT INTO artifacts(run_id,kind,path,sha256,size_bytes)
     SELECT $1,n,'synthetic-fixture/'||n,repeat('0',64),0
     FROM unnest(ARRAY['config','wind','concentration','columns','metrics','log','manifest']) n
     ON CONFLICT DO NOTHING`,
    [id],
  );
  await pool.query(
    `UPDATE simulation_runs SET status='succeeded',progress=1,
       model_version=COALESCE(model_version,'synthetic-fixture'),
       input_hash=COALESCE(input_hash,'sha256:synthetic-fixture'),finished_at=now()
     WHERE id=$1`,
    [id],
  );
}
