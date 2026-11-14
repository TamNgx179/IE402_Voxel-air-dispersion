/**
 * Grid geometry (port of web/map/viewer-grid.js plus the node/geoAt helpers of
 * web/app.js). Grid nodes are bilinear in the four exported WGS84 corners.
 */
import type { GridSpec } from '../api/types';

export type LngLat = [number, number];
export interface Corners {
  sw: LngLat;
  se: LngLat;
  ne: LngLat;
  nw: LngLat;
}
export interface Cell {
  i: number;
  j: number;
}
export type NodeFn = (i: number, j: number) => LngLat;

export function cornersFromBounds([west, south, east, north]: [number, number, number, number]): Corners {
  return { sw: [west, south], se: [east, south], ne: [east, north], nw: [west, north] };
}

export function validCell(grid: Pick<GridSpec, 'nx' | 'ny'>, i: number, j: number): boolean {
  return Number.isInteger(i) && Number.isInteger(j) && i >= 0 && j >= 0 && i < grid.nx && j < grid.ny;
}

export interface GridLine {
  major: boolean;
  path: LngLat[];
}

/** Every grid boundary once, including outer edges; every 10th line is major. */
export function lines(grid: Pick<GridSpec, 'nx' | 'ny'>, node: NodeFn): GridLine[] {
  const result: GridLine[] = [];
  for (let i = 0; i <= grid.nx; i++)
    result.push({ major: i % 10 === 0 || i === grid.nx, path: [node(i, 0), node(i, grid.ny)] });
  for (let j = 0; j <= grid.ny; j++)
    result.push({ major: j % 10 === 0 || j === grid.ny, path: [node(0, j), node(grid.nx, j)] });
  return result;
}

/** Closed outline of one cell at altitude z. */
export function outline(cell: Cell, node: NodeFn, z: number): Array<[number, number, number]> {
  const { i, j } = cell;
  return (
    [
      [i, j],
      [i + 1, j],
      [i + 1, j + 1],
      [i, j + 1],
      [i, j],
    ] as const
  ).map(([x, y]) => [...node(x, y), z] as [number, number, number]);
}

export interface GridNodes {
  lon: Float64Array;
  lat: Float64Array;
  node: NodeFn;
}

/** Grid node coordinates, bilinear in the corners (checked against pyproj in tests/test_web_export.py). */
export function buildNodes(grid: Pick<GridSpec, 'nx' | 'ny'>, c: Corners): GridNodes {
  const { nx, ny } = grid;
  const lon = new Float64Array((nx + 1) * (ny + 1));
  const lat = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j += 1) {
    const t = j / ny;
    for (let i = 0; i <= nx; i += 1) {
      const s = i / nx;
      const n = j * (nx + 1) + i;
      lon[n] = (1 - s) * (1 - t) * c.sw[0] + s * (1 - t) * c.se[0] + s * t * c.ne[0] + (1 - s) * t * c.nw[0];
      lat[n] = (1 - s) * (1 - t) * c.sw[1] + s * (1 - t) * c.se[1] + s * t * c.ne[1] + (1 - s) * t * c.nw[1];
    }
  }
  const node: NodeFn = (i, j) => {
    const n = j * (nx + 1) + i;
    return [lon[n], lat[n]];
  };
  return { lon, lat, node };
}

/** All cells in row-major (j outer, i inner) order. */
export function buildCells(grid: Pick<GridSpec, 'nx' | 'ny'>): Cell[] {
  const list: Cell[] = [];
  for (let j = 0; j < grid.ny; j += 1) for (let i = 0; i < grid.nx; i += 1) list.push({ i, j });
  return list;
}

/** WGS84 position at fractional grid coordinates (s, t) in [0, 1). */
export function geoAt(c: Corners, s: number, t: number): LngLat {
  const x = ((s % 1) + 1) % 1;
  const y = ((t % 1) + 1) % 1;
  return [
    (1 - x) * (1 - y) * c.sw[0] + x * (1 - y) * c.se[0] + x * y * c.ne[0] + (1 - x) * y * c.nw[0],
    (1 - x) * (1 - y) * c.sw[1] + x * (1 - y) * c.se[1] + x * y * c.ne[1] + (1 - x) * y * c.nw[1],
  ];
}

/** Flattened [z, y, x] C-order index. */
export function voxelIndex(grid: Pick<GridSpec, 'nx' | 'ny'>, k: number, j: number, i: number): number {
  return (k * grid.ny + j) * grid.nx + i;
}

/** Cell-centre heights (k + 0.5) * dz. */
export function zCentres(grid: Pick<GridSpec, 'nz' | 'dz_m'>): number[] {
  return Array.from({ length: grid.nz }, (_, k) => (k + 0.5) * grid.dz_m);
}
