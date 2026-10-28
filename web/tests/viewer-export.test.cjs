const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { parse } = createRequire(join(__dirname, "../../app/package.json"))(
  "csv-parse/sync",
);
const {
  csv,
  layerCsv,
  comparisonCsv,
  png,
  compose,
  comparisonLegend,
} = require("../viewer-export.js");
test("empty comparison must not be labelled as a measured zero delta", () => {
  const empty = {
    feature_collection: { features: [] },
    stats: { air_cells: 0, delta: { min_ug_m3: null, max_ug_m3: null } },
  };
  const legend = comparisonLegend(empty, "delta", String);
  assert.match(legend.title, /Không có dữ liệu/);
  assert.doesNotMatch(legend.categories[0].label, /bằng 0|trùng nhau/);
  const zero = {
    feature_collection: {
      features: [{ properties: { baseline_ug_m3: 0, comparison_ug_m3: 0 } }],
    },
    stats: { air_cells: 1, delta: { min_ug_m3: 0, max_ug_m3: 0 } },
  };
  assert.match(comparisonLegend(zero, "delta", String).title, /bằng 0/);
});
test("CSV quotes metadata and formulas while preserving numerical zero, negatives and null", () => {
  const data = parse(
    csv([["=formula", "a,b", 'a"b', "a\nb", 0, -0.125, null, " -danger"]]),
  );
  assert.deepEqual(data[0], [
    "'=formula",
    "a,b",
    'a"b',
    "a\nb",
    "0",
    "-0.125",
    "",
    "' -danger",
  ]);
});
test("summary export uses actual summary z_m contract, exact numbers and grid intervals", () => {
  const report = {
    metadata: { run_id: "r", model_version: "v", input_hash: "h" },
    summary: {
      grid: { dz_m: 2 },
      units: "ug m-3",
      layers: [
        {
          z_m: 1,
          mean_ug_m3: 0.12494000047445297,
          max_ug_m3: null,
          air_cells: 8,
        },
      ],
    },
  };
  const rows = parse(layerCsv(report), { columns: true });
  assert.equal(rows[0].z_center_m, "1");
  assert.equal(rows[0].z_min_m, "0");
  assert.equal(rows[0].z_max_m, "2");
  assert.equal(Number(rows[0].mean_ug_m3), 0.12494000047445297);
  assert.equal(rows[0].max_ug_m3, "");
  assert.equal(rows[0].units, "ug m-3");
});
test("comparison CSV preserves signed delta and provenance for both runs", () => {
  const data = {
    baseline_run_id: "a",
    comparison_run_id: "b",
    baseline_version: "v1",
    comparison_version: "v2",
    baseline_input_hash: "h1",
    comparison_input_hash: "h2",
    requested_z_m: 1.5,
    z_center_m: 1,
    units: "ug m-3",
    feature_collection: {
      features: [
        {
          properties: {
            i: 1,
            j: 2,
            baseline_ug_m3: 2,
            comparison_ug_m3: 1,
            delta_ug_m3: -1,
          },
        },
      ],
    },
  };
  const [row] = parse(comparisonCsv(data), { columns: true });
  assert.equal(row.delta_ug_m3, "-1");
  assert.equal(row.comparison_input_hash, "h2");
  assert.equal(row.requested_z_m, "1.5");
});
test("PNG encoding reports null blob and cross-origin failures rather than success", async () => {
  await assert.rejects(png({ toBlob: (fn) => fn(null) }), /Không tạo/);
  await assert.rejects(
    png({
      toBlob() {
        throw new Error("SecurityError");
      },
    }),
    /CORS/,
  );
});
test("report canvas contains legend, attribution and snapshot context, not sidebar DOM", () => {
  const labels = [],
    draws = [];
  const c = {
    fillRect() {},
    fillText(s) {
      labels.push(s);
    },
    drawImage(...args) {
      draws.push(args);
    },
    measureText: (s) => ({ width: s.length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  const doc = { createElement: () => ({ getContext: () => c }) };
  const report = {
    title: "Test",
    mode: "Gốc",
    metadata: {
      run_id: "r",
      z_min_m: 0,
      z_max_m: 2,
      z_center_m: 1,
      model_version: "v",
      input_hash: "h",
      camera: { zoom: 16 },
      exported_at: "now",
    },
    legend: {
      title: "Nồng độ (µg/m³, log)",
      stops: [
        [0, "#fff"],
        [1, "#000"],
      ],
      labels: ["0.1", "1"],
    },
    notice: "Minh họa",
    attribution: "© OpenStreetMap",
  };
  const canvas = compose(
    doc,
    { width: 1000, height: 500 },
    { width: 1000, height: 500 },
    report,
  );
  assert.equal(draws.length, 2);
  assert.ok(labels.some((s) => s.includes("OpenStreetMap")));
  assert.ok(labels.some((s) => s.includes("Run: r")));
  assert.ok(canvas.height > 500);
  report.legend = {
    title: "Vùng vượt ngưỡng",
    categories: [{ label: "WHO: > 15", color: "#ae925b" }],
    labels: [],
  };
  compose(doc, { width: 1000, height: 500 }, null, report);
  assert.ok(
    labels.includes("WHO: > 15"),
    "categorical threshold export must not reuse the concentration gradient",
  );
});
