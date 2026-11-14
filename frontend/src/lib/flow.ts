/**
 * Pure wind view-model math (port of web/map/viewer-flow.js). Visual particles
 * sample the solver wind; they are not PM2.5 mass.
 */
import type { StyleSpecification } from 'maplibre-gl';
import type { GridSpec, WindField } from '../api/types';

export type Vec3 = [number, number, number];
type FlowGrid = Pick<GridSpec, 'nx' | 'ny' | 'nz' | 'dx_m' | 'dy_m' | 'dz_m'>;

export function rasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      context: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
    },
    layers: [{ id: 'context', type: 'raster', source: 'context', paint: { 'raster-saturation': -0.65 } }],
  };
}

export interface FlowLayer {
  k: number;
  z_m: number;
  vectors: number[][];
  samples: Map<string, number[]>;
}

export interface FlowField {
  grid: FlowGrid;
  layers?: Map<number, FlowLayer>;
  air: (x: number, y: number, z: number) => boolean;
  sample: (x: number, y: number, z: number) => number[] | null;
  maxSpeed: number;
}

export function createField(
  data: Pick<WindField, 'stride' | 'layers'> | null | undefined,
  grid: FlowGrid,
  isAir: (x: number, y: number, z: number) => boolean,
): FlowField | null {
  if (!data) return null;
  const layers = new Map<number, FlowLayer>();
  let maxSpeed = 0;
  for (const layer of data.layers) {
    const samples = new Map<string, number[]>();
    for (const row of layer.vectors) {
      samples.set(`${row[0]},${row[1]}`, row.slice(4, 7));
      maxSpeed = Math.max(maxSpeed, Math.hypot(...row.slice(4, 7)));
    }
    layers.set(layer.k, { ...layer, samples });
  }
  const air = (x: number, y: number, z: number) =>
    x >= 0 &&
    y >= 0 &&
    z >= 0 &&
    x < grid.nx * grid.dx_m &&
    y < grid.ny * grid.dy_m &&
    z < grid.nz * grid.dz_m &&
    isAir(x, y, z);
  function sample(x: number, y: number, z: number): number[] | null {
    if (!air(x, y, z)) return null;
    const layer = layers.get(Math.floor(z / grid.dz_m));
    if (!layer) return null;
    const origin = Math.floor(data!.stride / 2),
      stride = data!.stride;
    const gx = (x / grid.dx_m - 0.5 - origin) / stride,
      gy = (y / grid.dy_m - 0.5 - origin) / stride;
    const ix = Math.floor(gx),
      iy = Math.floor(gy),
      fx = gx - ix,
      fy = gy - iy;
    const velocity = [0, 0, 0];
    let total = 0;
    for (const [a, wx] of [
      [ix, 1 - fx],
      [ix + 1, fx],
    ])
      for (const [b, wy] of [
        [iy, 1 - fy],
        [iy + 1, fy],
      ]) {
        const vector = layer.samples.get(`${origin + a * stride},${origin + b * stride}`),
          weight = wx * wy;
        if (!vector || weight <= 0) continue;
        total += weight;
        vector.forEach((v, n) => (velocity[n] += v * weight));
      }
    return total ? velocity.map((v) => v / total) : null;
  }
  return { grid, layers, air, sample, maxSpeed };
}

export interface Particle {
  x: number;
  y: number;
  z: number;
  seed: { x: number; y: number; z: number };
  age: number;
  fade: number;
  history: Vec3[];
}

export function createParticles(field: FlowField | null, k: number): Particle[] {
  const layer = field?.layers?.get(k);
  if (!field || !layer) return [];
  const stride = Math.max(1, Math.ceil(layer.vectors.length / 140));
  return layer.vectors
    .filter((_, n) => n % stride === 0)
    .map((row, n) => {
      const seed = { x: (row[0] + 0.5) * field.grid.dx_m, y: (row[1] + 0.5) * field.grid.dy_m, z: layer.z_m };
      return { ...seed, seed, age: (((n * 37) % 101) / 101) * 18, fade: 1, history: [] };
    });
}

function reset(particle: Particle) {
  Object.assign(particle, particle.seed, { age: 0, history: [], fade: 0 });
}

export function advance(field: FlowField | null, particles: Particle[], seconds: number): void {
  if (!field || !Number.isFinite(seconds) || seconds <= 0) return;
  const subdivisions = Math.max(
    1,
    Math.ceil((seconds * field.maxSpeed) / (Math.min(field.grid.dx_m, field.grid.dy_m, field.grid.dz_m) * 0.4)),
  );
  const dt = seconds / subdivisions;
  for (const p of particles) {
    p.history.push([p.x, p.y, p.z]);
    if (p.history.length > 6) p.history.shift();
    for (let step = 0; step < subdivisions; step++) {
      const velocity = field.sample(p.x, p.y, p.z);
      if (!velocity) {
        reset(p);
        break;
      }
      const next: Vec3 = [p.x + velocity[0] * dt, p.y + velocity[1] * dt, p.z + velocity[2] * dt];
      if (!field.air(...next)) {
        reset(p);
        break;
      }
      [p.x, p.y, p.z] = next;
      p.age += dt;
      p.fade = Math.min(1, p.fade + dt / 3);
    }
  }
}

/**
 * Short upstream streamlet, integrated through the same sampled velocity.
 * Geometry is display-only; no random curls or invented turbulent eddies.
 */
export function streamlet(field: FlowField | null, particle: { x: number; y: number; z: number }): Vec3[] {
  if (!field) return [];
  let point: Vec3 = [particle.x, particle.y, particle.z];
  const velocity = field.sample(...point);
  if (!velocity || Math.hypot(...velocity) < 1e-6) return [];
  const length = Math.min(24, 10 + Math.hypot(...velocity) * 8);
  const step = Math.min(1, field.grid.dx_m * 0.25, field.grid.dy_m * 0.25, field.grid.dz_m * 0.25);
  const points: Vec3[] = [point];
  // Bound rendering work even for very fine grids.
  for (let distance = step; distance <= length && points.length < 48; distance += step) {
    const v = field.sample(...point),
      speed = v && Math.hypot(...v);
    if (!v || !speed || speed < 1e-6) break;
    const midpoint = point.map((n, i) => n - (v[i] / speed) * step * 0.5) as Vec3;
    const midV = field.sample(...midpoint),
      midSpeed = midV && Math.hypot(...midV);
    if (!midV || !midSpeed || midSpeed < 1e-6) break;
    const next = point.map((n, i) => n - (midV[i] / midSpeed) * step) as Vec3;
    if (!field.air(...next)) break;
    points.push(next);
    point = next;
  }
  return points.reverse();
}

/** Mean layer wind → speed and meteorological "from" direction (legacy updateWindHud). */
export function layerWind(vectors: number[][]): { speed: number; fromDeg: number; toDeg: number } | null {
  if (!vectors.length) return null;
  const u = vectors.reduce((sum, row) => sum + row[4], 0) / vectors.length;
  const v = vectors.reduce((sum, row) => sum + row[5], 0) / vectors.length;
  const fromDeg = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed: Math.hypot(u, v), fromDeg, toDeg: (fromDeg + 180) % 360 };
}

export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** 16-point compass code; translate with `t('viewer.compass' + code)`. */
export function compass(deg: number): CompassPoint {
  return COMPASS_POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
