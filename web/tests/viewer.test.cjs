const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  createField,
  createParticles,
  advance,
  rasterStyle,
  streamlet,
} = require("../viewer-flow.js");
const grid = { nx: 10, ny: 10, nz: 2, dx_m: 5, dy_m: 5, dz_m: 2 };
function field(u = 1, v = 0, air = () => true) {
  const layers = [0, 1].map((k) => ({
    k,
    z_m: (k + 0.5) * 2,
    vectors: [2, 7].flatMap((j) => [2, 7].map((i) => [i, j, 0, 0, u, v, 0])),
  }));
  return createField({ stride: 5, layers }, grid, air);
}
test("motion follows solver u/v with correct units; no background fallback", () => {
  const f = field(),
    particles = createParticles(f, 0);
  const x = particles[0].x;
  advance(f, particles, 1);
  assert.ok(Math.abs(particles[0].x - x - 1) < 1e-9);
  assert.equal(particles[0].z, 1);
  const wet = field(0, -2),
    p = createParticles(wet, 0),
    y = p[0].y;
  advance(wet, p, 0.5);
  assert.ok(Math.abs(p[0].y - y + 1) < 1e-9);
  assert.equal(
    createField(null, grid, () => true),
    null,
  );
});
test("particles cannot tunnel through solid or leave simulation domain", () => {
  const f = field(20, 0, (x) => x < 15 || x >= 20),
    p = createParticles(f, 0);
  advance(f, p, 1);
  assert.ok(p.every((a) => a.x >= 0 && a.x < 50 && (a.x < 15 || a.x >= 20)));
  assert.equal(p[0].x, p[0].seed.x);
});
test("layer switch creates particles at that layer; zero wind stays finite", () => {
  const f = field(0, 0),
    p = createParticles(f, 1);
  advance(f, p, 0.2);
  assert.ok(p.every((a) => a.z === 3 && Number.isFinite(a.x)));
  assert.equal(createParticles(f, 9).length, 0);
});
test("steady wind does not reset particles at an arbitrary 18-second lifetime", () => {
  const f = field(0.01, 0),
    p = createParticles(f, 0);
  const x = p[0].x;
  for (let n = 0; n < 200; n++) advance(f, p, 0.1);
  assert.ok(Math.abs(p[0].x - x - 0.2) < 1e-8);
});
test("raster fallback covers whole map, includes attribution, not study-area bounds", () => {
  const style = rasterStyle();
  assert.equal(style.version, 8);
  assert.equal(style.sources.context.type, "raster");
  assert.equal(style.sources.context.bounds, undefined);
  assert.match(style.sources.context.tiles[0], /tile.openstreetmap.org/);
  assert.match(style.sources.context.attribution, /OpenStreetMap/);
});
test("pause button receives clicks even though wind HUD passes map gestures through", () => {
  const css = readFileSync(join(__dirname, "../styles.css"), "utf8");
  assert.match(css, /\.wind-hud \.icon-button\s*\{[^}]*pointer-events:\s*auto/);
});
test("wind streamlet aligns with solver, remains bounded and has no zero-speed fallback", () => {
  const points = streamlet(field(1, 0), { x: 25, y: 25, z: 1 });
  assert.ok(points.length > 3 && points.length <= 48);
  assert.ok(
    points.every((p) => p[1] === 25 && p[2] === 1 && p[0] >= 0 && p[0] < 50),
  );
  assert.ok(points.slice(1).every((p, i) => p[0] > points[i][0]));
  assert.deepEqual(streamlet(field(0, 0), { x: 25, y: 25, z: 1 }), []);
});
test("upstream wind trace stops at solid cells instead of drawing through buildings", () => {
  const points = streamlet(
    field(1, 0, (x) => x >= 20),
    { x: 25, y: 25, z: 1 },
  );
  assert.ok(points.length > 1);
  assert.ok(points.every((p) => p[0] >= 20));
});
test("curved streamlets follow the field without invented decorative waves", () => {
  const f = {
    grid,
    maxSpeed: 2,
    air: (x, y, z) => x >= 0 && y >= 0 && z >= 0,
    sample: (x, y, z) => (x >= 0 && y >= 0 && z >= 0 ? [1, x / 25, 0] : null),
  };
  const points = streamlet(f, { x: 25, y: 25, z: 1 });
  const slopes = points
    .slice(1)
    .map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
  assert.ok(slopes.at(-1) > slopes[0]);
  assert.ok(points.every((p) => p.every(Number.isFinite)));
});
test("viewer does not load photo textures or render wind arrowheads", () => {
  const source = readFileSync(join(__dirname, "../app.js"), "utf8");
  assert.doesNotMatch(source, /wind-arrowheads|facade-photo-|image\.decode\(/);
  assert.match(source, /ViewerFlow\.streamlet/);
});
test("compact sidebar keeps primary controls ahead of collapsed advanced settings", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, "control IDs must remain unique");
  for (const id of ["scenario-list", "height-slider", "legend", "show-grid", "profile", "cell-picker-form", "run-button", "query-retry", "threshold-list", "show-wind", "multiplier"]) {
    assert.ok(ids.includes(id), `preserve ${id}`);
  }
  assert.ok(html.indexOf('id="height-slider"') < html.indexOf('id="run-button"'));
  assert.ok(html.indexOf('id="profile"') < html.indexOf('id="threshold-list"'));
  const sections = Array.from(html.matchAll(/<details\b[^>]*class="sidebar-section[^\"]*"[^>]*>/g), (m) => m[0]);
  assert.equal(sections.length, 4);
  assert.ok(sections.every((tag) => !/\bopen\b/.test(tag)));
  const feedback = html.slice(html.indexOf('<div class="query-feedback">'), html.indexOf('<section class="simulation-section"'));
  assert.match(feedback, /id="query-retry"/);
});
test("all sidebar disclosures share one readable chevron style without grid swatches", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  const css = readFileSync(join(__dirname, "../styles.css"), "utf8");
  assert.doesNotMatch(html, /grid-legend|grid-swatch|selected-swatch/);
  assert.match(html, /id="show-grid"/);
  assert.match(css, /\.panel details > summary\s*\{[^}]*color:var\(--text\)[^}]*font-size:12px; font-weight:500/);
  assert.match(css, /\.panel details > summary::before\s*\{[^}]*currentColor/);
  assert.match(css, /\.panel details\[open\] > summary::before\s*\{[^}]*rotate\(45deg\)/);
  assert.match(css, /summary::-webkit-details-marker\s*\{\s*display:none/);
});
