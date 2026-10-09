const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  createField,
  createParticles,
  advance,
  rasterStyle,
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
