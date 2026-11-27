import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Synthetic metadata for query fixtures only, never scientific verification. */
export async function publishFixtureRun(
  pool: pg.Pool | pg.PoolClient,
  id: string,
  options: { partial?: boolean } = {},
) {
  if (options.partial)
    await pool.query(
      "UPDATE simulation_runs SET coverage_policy='partial' WHERE id=$1",
      [id],
    );
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

/** Statuses whose stored values must never be served by a result query. */
export const UNPUBLISHED_STATUSES = [
  'queued',
  'running',
  'failed',
  'stale',
] as const;

/**
 * Column order of the committed 2x2 fixture scene: (0,0), (1,0), (0,1), (1,1).
 * Its solids are (0,0) k=0..2 and (1,1) k=0..3, so those voxels must be NULL.
 */
export const FIXTURE_CELLS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

export interface FixtureRunOptions {
  model?: string;
  scenario?: string;
  modelVersion?: string;
  /** Defaults to whether any non-solid voxel is NULL (missing air data). */
  partial?: boolean;
}

/**
 * Inserts a run with one Postgres array literal per FIXTURE_CELLS entry and
 * publishes it. A run the database refuses to publish is removed again.
 */
export async function insertPublishedRun(
  pool: pg.Pool,
  columns: readonly string[],
  options: FixtureRunOptions = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO simulation_runs(id,scenario_id,model,status,model_version,input_hash,finished_at)
     VALUES($1,$2,$3,'running',$4,$5,now())`,
    [
      id,
      options.scenario ?? 'dry_nov_apr',
      options.model ?? 'fv',
      options.modelVersion ?? 'synthetic-fixture',
      'sha256:' + id,
    ],
  );
  try {
    for (const [n, [i, j]] of FIXTURE_CELLS.entries())
      await pool.query(
        'INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,$2,$3,$4)',
        [id, i, j, columns[n]],
      );
    const partial =
      options.partial ??
      (
        await pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM concentration_columns c
             JOIN simulation_runs r ON r.id = c.run_id
             JOIN scenarios s ON s.id = r.scenario_id
             JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
             CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY u(v, k)
             WHERE c.run_id = $1 AND u.v IS NULL
               AND (g.solid_from_k IS NULL OR u.k - 1 NOT BETWEEN g.solid_from_k AND g.solid_to_k)
           ) AS partial`,
          [id],
        )
      ).rows[0].partial;
    await publishFixtureRun(pool, id, { partial });
  } catch (error) {
    await pool.query('DELETE FROM simulation_runs WHERE id=$1', [id]);
    throw error;
  }
  return id;
}

/** A run that never reached `succeeded`; failed runs carry an error kind. */
export async function insertRunWithStatus(
  pool: pg.Pool,
  status: (typeof UNPUBLISHED_STATUSES)[number],
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO simulation_runs(id,scenario_id,status,error_kind) VALUES($1,'dry_nov_apr',$2,$3)`,
    [id, status, status === 'failed' ? 'model' : null],
  );
  return id;
}

/** Reprojects a GeoJSON geometry given in EPSG:32648 metres to WGS84. */
export async function toWgs84(
  pool: pg.Pool,
  geometry: { type: string; coordinates: unknown },
) {
  return (
    await pool.query(
      `SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),32648),4326),15)::json AS g`,
      [JSON.stringify(geometry)],
    )
  ).rows[0].g;
}

/** Axis-aligned rectangle in EPSG:32648 metres, returned as a WGS84 Polygon. */
export function envelope(
  pool: pg.Pool,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  return toWgs84(pool, {
    type: 'Polygon',
    coordinates: [
      [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ],
    ],
  });
}
