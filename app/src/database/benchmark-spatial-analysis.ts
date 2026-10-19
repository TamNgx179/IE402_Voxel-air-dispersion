import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import {
  COMPARISON_SQL,
  REGION_SQL,
} from '../modules/results/repositories/spatial-analysis.repository.js';

// Same local DB default as benchmark-results.ts; do not print credentials.
const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://ie402:ie402@localhost:5433/ie402',
  max: 1,
});
try {
  const { rows: runs } = await pool.query(
    `SELECT r.id,r.model,r.model_version,r.input_hash,r.warnings,s.study_area_id,sa.grid
    FROM simulation_runs r JOIN scenarios s ON s.id=r.scenario_id JOIN study_areas sa ON sa.id=s.study_area_id
    WHERE r.status='succeeded' AND r.model='fv' AND NOT EXISTS(SELECT 1 FROM unnest(r.warnings) w WHERE w LIKE '%mock run%')
      AND ($1::uuid IS NULL OR r.id=$1) ORDER BY r.finished_at DESC LIMIT 1`,
    [process.env.BENCHMARK_RUN_ID ?? null],
  );
  if (!runs.length) throw new Error('Need a succeeded non-mock FV run');
  const run = runs[0],
    g = run.grid;
  const { rows: polygons } = await pool.query(
    `SELECT ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope($1,$2,$3,$4,32648),4326),15)::json AS polygon`,
    [
      g.origin_x_m + g.dx_m * 0.2,
      g.origin_y_m + g.dy_m * 0.2,
      g.origin_x_m + g.dx_m * g.nx * 0.8,
      g.origin_y_m + g.dy_m * g.ny * 0.8,
    ],
  );
  const polygon = polygons[0].polygon;
  const cases = [
    {
      name: 'comparison_sql_self',
      sql: COMPARISON_SQL,
      values: [run.id, run.id, run.study_area_id, 1],
    },
    {
      name: 'region_sql',
      sql: REGION_SQL,
      values: [
        run.id,
        run.study_area_id,
        JSON.stringify(polygon),
        1,
        Math.min(15, g.nz * g.dz_m),
        g.dz_m,
        15,
      ],
    },
  ];
  const queries: Record<string, unknown> = {};
  for (const item of cases) {
    for (let n = 0; n < 3; n++) await pool.query(item.sql, item.values);
    const times = [];
    for (let n = 0; n < 20; n++) {
      const t = performance.now();
      await pool.query(item.sql, item.values);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const plan = await pool.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${item.sql}`,
      item.values,
    );
    queries[item.name] = {
      p50_ms: times[10],
      p95_ms: times[19],
      plan: plan.rows[0]['QUERY PLAN'][0],
    };
  }
  const report = {
    generated_at: new Date().toISOString(),
    scope:
      'Read-only SQL timings, not API end-to-end latency or SLA; self comparison baseline',
    run_id: run.id,
    model: run.model,
    model_version: run.model_version,
    input_hash: run.input_hash,
    warnings: run.warnings,
    grid: g,
    environment: {
      platform: platform(),
      node: process.version,
      cpu: cpus()[0]?.model,
      memory_bytes: totalmem(),
    },
    samples: 20,
    warmup: 3,
    polygon,
    z_min_m: 1,
    z_max_m: Math.min(15, g.nz * g.dz_m),
    queries,
  };
  const output = resolve(
    process.env.BENCHMARK_OUTPUT ?? '../artifacts/a8-spatial-benchmark.json',
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        output,
        run_id: run.id,
        grid: g,
        queries: Object.fromEntries(
          Object.entries(queries).map(([k, v]) => [
            k,
            { p50_ms: (v as any).p50_ms, p95_ms: (v as any).p95_ms },
          ]),
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
