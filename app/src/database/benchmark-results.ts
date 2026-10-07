import { performance } from 'node:perf_hooks';
import pg from 'pg';

const url =
  process.env.DATABASE_URL ?? 'postgres://ie402:ie402@localhost:5433/ie402';
const pool = new pg.Pool({ connectionString: url, max: 1 });

// Bulk imports can leave the planner with stale row estimates. Refresh only
// the two query-facing tables so the captured plan represents a demo run.
await pool.query('ANALYZE concentration_columns');
await pool.query('ANALYZE grid_cells');

const latest = await pool.query<{
  id: string;
  scenario_id: string;
  study_area_id: string;
}>(
  `SELECT r.id, r.scenario_id, s.study_area_id
   FROM simulation_runs r JOIN scenarios s ON s.id = r.scenario_id
   WHERE r.status = 'succeeded' ORDER BY r.finished_at DESC LIMIT 1`,
);
if (latest.rowCount === 0)
  throw new Error('no succeeded run; create one before benchmarking');
const run = latest.rows[0];

const cases = [
  {
    name: 'slice',
    sql: `SELECT c.i, c.j, c.c_ug_m3[1], g.geom
          FROM concentration_columns c
          JOIN grid_cells g ON g.study_area_id = $2 AND g.i = c.i AND g.j = c.j
          WHERE c.run_id = $1 AND c.c_ug_m3[1] IS NOT NULL`,
    values: [run.id, run.study_area_id],
  },
  {
    name: 'exceedance',
    sql: `SELECT count(*) FROM concentration_columns c
          CROSS JOIN LATERAL unnest(c.c_ug_m3) AS u(value)
          WHERE c.run_id = $1 AND u.value > $2`,
    values: [run.id, 45],
  },
  {
    name: 'profile',
    sql: `SELECT c.c_ug_m3 FROM concentration_columns c
          WHERE c.run_id = $1 AND c.i = 0 AND c.j = 0`,
    values: [run.id],
  },
  {
    name: 'summary',
    sql: `SELECT u.ordinality, avg(u.value), max(u.value)
          FROM concentration_columns c
          CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY AS u(value, ordinality)
          WHERE c.run_id = $1 GROUP BY u.ordinality ORDER BY u.ordinality`,
    values: [run.id],
  },
];

const report: Record<string, unknown> = {
  generated_at: new Date().toISOString(),
  run_id: run.id,
  samples: 20,
  storage: {},
  queries: {},
};
const storage = await pool.query<{
  concentration_rows: number;
  concentration_bytes: string;
  grid_rows: number;
  grid_bytes: string;
}>(
  `SELECT
     (SELECT count(*)::int FROM concentration_columns WHERE run_id = $1) AS concentration_rows,
     pg_total_relation_size('concentration_columns')::text AS concentration_bytes,
     (SELECT count(*)::int FROM grid_cells WHERE study_area_id = $2) AS grid_rows,
     pg_total_relation_size('grid_cells')::text AS grid_bytes`,
  [run.id, run.study_area_id],
);
report.storage = {
  concentration_columns: {
    rows_for_run: storage.rows[0].concentration_rows,
    relation_bytes: Number(storage.rows[0].concentration_bytes),
  },
  grid_cells: {
    rows_for_study_area: storage.rows[0].grid_rows,
    relation_bytes: Number(storage.rows[0].grid_bytes),
  },
};
for (const item of cases) {
  for (let n = 0; n < 3; n += 1) await pool.query(item.sql, item.values);
  const times: number[] = [];
  for (let n = 0; n < 20; n += 1) {
    const start = performance.now();
    await pool.query(item.sql, item.values);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const explain = await pool.query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${item.sql}`,
    item.values,
  );
  (report.queries as Record<string, unknown>)[item.name] = {
    p50_ms: times[Math.floor(times.length * 0.5)],
    p95_ms: times[Math.floor(times.length * 0.95)],
    plan: explain.rows[0]['QUERY PLAN'][0],
  };
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await pool.end();
