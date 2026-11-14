import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import pg from 'pg';
import { ROAD_CORRIDOR_SQL } from '../modules/results/repositories/road-corridor.sql.js';
import { CONCENTRATION_SLICE_SQL, VERTICAL_PROFILE_SQL } from '../modules/results/repositories/simulation-results.repository.js';
import { TRANSECT_COLUMNS_SQL, TRANSECT_PROJECT_SQL } from '../modules/results/repositories/transect.repository.js';
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
    `SELECT r.id,r.scenario_id,r.model,r.model_version,r.input_hash,r.warnings,s.study_area_id,sa.grid
    FROM simulation_runs r JOIN scenarios s ON s.id=r.scenario_id JOIN study_areas sa ON sa.id=s.study_area_id
    WHERE r.status='succeeded' AND r.model='fv' AND NOT EXISTS(SELECT 1 FROM unnest(r.warnings) w WHERE w LIKE '%mock run%')
      AND ($1::uuid IS NULL OR r.id=$1) ORDER BY r.finished_at DESC LIMIT 1`,
    [process.env.BENCHMARK_RUN_ID ?? null],
  );
  if (!runs.length) throw new Error('Need a succeeded non-mock FV run');
  const run = runs[0],
    g = run.grid;
  const { rows: indexes } = await pool.query(
    `SELECT tablename, indexname, indexdef,
            pg_relation_size(format('%I.%I', schemaname, indexname)::regclass) AS size_bytes
     FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename IN ('study_areas', 'road_segments', 'grid_cells', 'concentration_columns',
                         'simulation_runs', 'scenarios')
     ORDER BY tablename, indexname`,
  );
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
  const { rows: roads } = await pool.query<{ source_feature_id: string }>(
    `SELECT DISTINCT source_feature_id FROM road_segments
     WHERE study_area_id = $1 ORDER BY source_feature_id LIMIT 50`,
    [run.study_area_id],
  );
  const roadIds = roads.map((road) => road.source_feature_id);
  const sampleCount = g.nx;
  const indices = Array.from({ length: sampleCount }, (_, i) => i);
  const sampleRow = Math.floor(g.ny / 2);
  const rows = indices.map(() => sampleRow);
  const xs = indices.map((i) => g.origin_x_m + (i + 0.5) * g.dx_m);
  const ys = rows.map((j) => g.origin_y_m + (j + 0.5) * g.dy_m);
  const { rows: [line] } = await pool.query(
    `SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_MakeLine(
       ST_MakePoint($1,$2), ST_MakePoint($3,$4)),32648),4326),15) AS geojson`,
    [xs[0], ys[0], xs.at(-1), ys.at(-1)],
  );
  const ring: [number, number][] = polygon.coordinates[0];
  const longitude = ring.map(([x]) => x);
  const latitude = ring.map(([, y]) => y);
  const bbox = [Math.min(...longitude), Math.min(...latitude), Math.max(...longitude), Math.max(...latitude)];
  const cases = [
    { name: 'slice_viewport', sql: CONCENTRATION_SLICE_SQL, values: [run.id, 1, ...bbox, run.scenario_id] },
    { name: 'slice_full', sql: CONCENTRATION_SLICE_SQL, values: [run.id, 1, null, null, null, null, run.scenario_id] },
    { name: 'profile', sql: VERTICAL_PROFILE_SQL, values: [run.id, 0, 0, run.scenario_id] },
    { name: 'transect_project', sql: TRANSECT_PROJECT_SQL, values: [line.geojson, run.study_area_id, 32648] },
    {
      name: 'transect_columns',
      sql: TRANSECT_COLUMNS_SQL,
      values: [run.id, run.study_area_id, xs, ys, indices, rows, 32648,
        g.origin_x_m, g.origin_y_m, g.dx_m, g.dy_m, 1, g.nz],
    },
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
  if (roadIds.length) {
    cases.push(
      {
        name: 'road_corridor_selective',
        sql: ROAD_CORRIDOR_SQL,
        values: [run.id, run.study_area_id, roadIds.slice(0, 1), [10, 25, 50], 1, 15, g.dz_m, 15],
      },
      {
        name: 'road_corridor_broad',
        sql: ROAD_CORRIDOR_SQL,
        values: [run.id, run.study_area_id, roadIds, [10, 25, 50], 0, g.nz * g.dz_m, g.dz_m, 15],
      },
    );
  }
  const queries: Record<string, unknown> = {};
  for (const item of cases) {
    for (let n = 0; n < 3; n++) await pool.query(item.sql, item.values);
    const times: number[] = [];
    let returnedRows = 0;
    for (let n = 0; n < 20; n++) {
      const t = performance.now();
      const result = await pool.query(item.sql, item.values);
      times.push(performance.now() - t);
      returnedRows = result.rows.length;
    }
    times.sort((a, b) => a - b);
    const plan = await pool.query(
      `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${item.sql}`,
      item.values,
    );
    queries[item.name] = {
      // Nearest-rank percentiles: for 20 samples p95 is the 19th, not the maximum.
      p50_ms: times[Math.ceil(times.length * 0.5) - 1],
      p95_ms: times[Math.ceil(times.length * 0.95) - 1],
      returned_rows: returnedRows,
      parameters: item.values,
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
    indexes,
    environment: {
      platform: platform(),
      node: process.version,
      cpu: cpus()[0]?.model,
      memory_bytes: totalmem(),
    },
    samples: 20,
    warmup: 3,
    polygon,
    corridor_road_ids: roadIds,
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
