// Ported from the flow tests in web/tests/viewer.test.cjs.
import { describe, expect, test } from 'vitest';
import { advance, compass, createField, createParticles, layerWind, rasterStyle, streamlet, type FlowField } from './flow';

const grid = { nx: 10, ny: 10, nz: 2, dx_m: 5, dy_m: 5, dz_m: 2 };

function field(u = 1, v = 0, air: (x: number, y: number, z: number) => boolean = () => true): FlowField {
  const layers = [0, 1].map((k) => ({
    k,
    z_m: (k + 0.5) * 2,
    vectors: [2, 7].flatMap((j) => [2, 7].map((i) => [i, j, 0, 0, u, v, 0])),
  }));
  return createField({ stride: 5, layers }, grid, air)!;
}

describe('wind flow', () => {
  test('motion follows solver u/v with correct units; no background fallback', () => {
    const f = field(),
      particles = createParticles(f, 0);
    const x = particles[0].x;
    advance(f, particles, 1);
    expect(Math.abs(particles[0].x - x - 1)).toBeLessThan(1e-9);
    expect(particles[0].z).toBe(1);
    const wet = field(0, -2),
      p = createParticles(wet, 0),
      y = p[0].y;
    advance(wet, p, 0.5);
    expect(Math.abs(p[0].y - y + 1)).toBeLessThan(1e-9);
    expect(createField(null, grid, () => true)).toBeNull();
  });

  test('particles cannot tunnel through solid or leave simulation domain', () => {
    const f = field(20, 0, (x) => x < 15 || x >= 20),
      p = createParticles(f, 0);
    advance(f, p, 1);
    expect(p.every((a) => a.x >= 0 && a.x < 50 && (a.x < 15 || a.x >= 20))).toBe(true);
    expect(p[0].x).toBe(p[0].seed.x);
  });

  test('layer switch creates particles at that layer; zero wind stays finite', () => {
    const f = field(0, 0),
      p = createParticles(f, 1);
    advance(f, p, 0.2);
    expect(p.every((a) => a.z === 3 && Number.isFinite(a.x))).toBe(true);
    expect(createParticles(f, 9).length).toBe(0);
  });

  test('steady wind does not reset particles at an arbitrary 18-second lifetime', () => {
    const f = field(0.01, 0),
      p = createParticles(f, 0);
    const x = p[0].x;
    for (let n = 0; n < 200; n++) advance(f, p, 0.1);
    expect(Math.abs(p[0].x - x - 0.2)).toBeLessThan(1e-8);
  });

  test('raster fallback covers whole map, includes attribution, not study-area bounds', () => {
    const style = rasterStyle();
    const source = style.sources.context as { type: string; bounds?: unknown; tiles: string[]; attribution: string };
    expect(style.version).toBe(8);
    expect(source.type).toBe('raster');
    expect(source.bounds).toBeUndefined();
    expect(source.tiles[0]).toMatch(/tile.openstreetmap.org/);
    expect(source.attribution).toMatch(/OpenStreetMap/);
  });

  test('wind streamlet aligns with solver, remains bounded and has no zero-speed fallback', () => {
    const points = streamlet(field(1, 0), { x: 25, y: 25, z: 1 });
    expect(points.length).toBeGreaterThan(3);
    expect(points.length).toBeLessThanOrEqual(48);
    expect(points.every((p) => p[1] === 25 && p[2] === 1 && p[0] >= 0 && p[0] < 50)).toBe(true);
    expect(points.slice(1).every((p, i) => p[0] > points[i][0])).toBe(true);
    expect(streamlet(field(0, 0), { x: 25, y: 25, z: 1 })).toEqual([]);
  });

  test('upstream wind trace stops at solid cells instead of drawing through buildings', () => {
    const points = streamlet(field(1, 0, (x) => x >= 20), { x: 25, y: 25, z: 1 });
    expect(points.length).toBeGreaterThan(1);
    expect(points.every((p) => p[0] >= 20)).toBe(true);
  });

  test('curved streamlets follow the field without invented decorative waves', () => {
    const f: FlowField = {
      grid,
      maxSpeed: 2,
      air: (x, y, z) => x >= 0 && y >= 0 && z >= 0,
      sample: (x, y, z) => (x >= 0 && y >= 0 && z >= 0 ? [1, x / 25, 0] : null),
    };
    const points = streamlet(f, { x: 25, y: 25, z: 1 });
    const slopes = points.slice(1).map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
    expect(slopes.at(-1)!).toBeGreaterThan(slopes[0]);
    expect(points.every((p) => p.every(Number.isFinite))).toBe(true);
  });

  test('layer wind summary and 16-point compass', () => {
    // Wind blowing toward +x (east) comes from the west.
    const east = layerWind([[0, 0, 0, 0, 2, 0, 0]])!;
    expect(east.speed).toBe(2);
    expect(east.fromDeg).toBeCloseTo(270);
    expect(compass(east.fromDeg)).toBe('W');
    expect(compass(0)).toBe('N');
    expect(compass(359)).toBe('N');
    expect(compass(22.5)).toBe('NNE');
    expect(compass(-90)).toBe('W');
    expect(layerWind([])).toBeNull();
  });
});
