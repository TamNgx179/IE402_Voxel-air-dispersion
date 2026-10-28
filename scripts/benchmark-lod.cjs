// Đo CPU chuẩn bị geometry, không gọi đây là FPS/GPU benchmark.
const { performance } = require("node:perf_hooks");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { build } = require("../web/building-appearance.js");
const { prepare, select } = require("../web/viewer-lod.js");
const { layerCsv } = require("../web/viewer-export.js");
async function main() {
  const base = process.env.VIEWER_URL || "http://127.0.0.1:3001";
  async function get(path) {
    const r = await fetch(base + "/api" + path);
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  const [area] = await get("/study-areas"),
    scene = await get(`/study-areas/${area.id}/scene`);
  const before = JSON.stringify(scene.buildings),
    appearance = build(scene.buildings),
    prepared = prepare(scene.buildings, appearance);
  const baseVertices =
    (appearance.windows.length + appearance.frames.length) * 4;
  const quantile = (xs, q) =>
    xs.slice().sort((a, b) => a - b)[
      Math.min(xs.length - 1, Math.floor(xs.length * q))
    ];
  const rows = [];
  for (const level of ["overview", "medium", "detail"]) {
    const times = [];
    let plan;
    for (let n = 0; n < 220; n++) {
      const t = performance.now();
      plan = select(prepared, level, null);
      if (n >= 20) times.push(performance.now() - t);
    }
    rows.push({
      level,
      legacy_vertices: baseVertices,
      vertices: plan.vertices,
      polygons: plan.polygons,
      reduction_percent: 100 * (1 - plan.vertices / baseVertices),
      select_cpu_p50_ms: quantile(times, 0.5),
      select_cpu_p95_ms: quantile(times, 0.95),
    });
  }
  const [west, south, east, north] = area.bounds;
  const partial = select(prepared, "detail", [
    west,
    south,
    (west + east) / 2,
    (south + north) / 2,
  ]);
  const [run] = await get("/runs?status=succeeded&limit=1");
  if (!run)
    throw new Error("Cần ít nhất một run thành công để kiểm bất biến query.");
  const url = `/runs/${run.run_id}/summary`,
    queryBefore = await get(url);
  const i = Math.floor(queryBefore.grid.nx / 2),
    j = Math.floor(queryBefore.grid.ny / 2);
  const profilePath = `/runs/${run.run_id}/profile?i=${i}&j=${j}`;
  const profileBefore = await get(profilePath);
  const transectBody = {
    line: {
      type: "LineString",
      coordinates: [
        [(west + east) / 2 - (east - west) / 100, (south + north) / 2],
        [(west + east) / 2 + (east - west) / 100, (south + north) / 2],
      ],
    },
    z_min_m: 0,
    z_max_m: Math.min(10, queryBefore.grid.nz * queryBefore.grid.dz_m),
  };
  async function readTransectCsv() {
    const response = await fetch(
      base + `/api/runs/${run.run_id}/transect/csv`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transectBody),
      },
    );
    if (!response.ok) throw new Error(`transect CSV: ${response.status}`);
    return response.text();
  }
  const serverCsvBefore = await readTransectCsv();
  const report = {
    metadata: {
      run_id: run.run_id,
      model_version: queryBefore.model_version,
      input_hash: queryBefore.input_hash,
    },
    summary: queryBefore,
  };
  const csvBefore = layerCsv(report);
  for (const row of rows)
    select(prepared, row.level, [west, south, east, north]);
  const queryAfter = await get(url);
  // PostgreSQL parallel AVG có thể khác vài ulp giữa hai request dù không đổi DB.
  // Kiểm raw profile và CSV từ cùng snapshot phải khớp tuyệt đối; báo riêng độ lệch AVG.
  const maxMeanDrift = Math.max(
    ...queryBefore.layers.map((l, i) =>
      Math.abs((l.mean_ug_m3 ?? 0) - (queryAfter.layers[i].mean_ug_m3 ?? 0)),
    ),
  );
  const profileAfter = await get(profilePath);
  const serverCsvAfter = await readTransectCsv();
  const result = {
    at: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    scope:
      "CPU geometry selection; no FPS/GPU claim; legacy always submits full facade data",
    buildings: scene.buildings.features.length,
    rows,
    culling: {
      full_vertices: baseVertices,
      quarter_bounds_vertices: partial.vertices,
    },
    source_unchanged: before === JSON.stringify(scene.buildings),
    profile_unchanged:
      JSON.stringify(profileBefore) === JSON.stringify(profileAfter),
    csv_snapshot_unchanged: csvBefore === layerCsv(report),
    csv_unchanged: serverCsvBefore === serverCsvAfter,
    max_api_mean_roundoff: maxMeanDrift,
    run_id: run.run_id,
  };
  const directory = join(__dirname, "../artifacts/a9");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "lod-cpu.json"),
    JSON.stringify(result, null, 2),
  );
  if (
    !result.source_unchanged ||
    !result.profile_unchanged ||
    !result.csv_unchanged ||
    maxMeanDrift > 1e-12
  )
    throw new Error("LoD invariant failed.");
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
