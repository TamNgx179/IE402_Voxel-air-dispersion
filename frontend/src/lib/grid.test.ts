// Ported from web/tests/viewer-grid.test.cjs, plus node/geoAt checks.
import { describe, expect, test } from 'vitest';
import { buildCells, buildNodes, cornersFromBounds, geoAt, lines, outline, validCell, voxelIndex, zCentres } from './grid';

const grid = { nx: 100, ny: 100 },
  node = (i: number, j: number): [number, number] => [106 + i * 0.00001, 10 + j * 0.00001];

describe('grid', () => {
  test('every grid boundary is drawn once, including outer edges, with 10-cell divisions', () => {
    const data = lines(grid, node);
    expect(data.length).toBe(202);
    expect(data.filter((d) => d.major).length).toBe(22);
    expect(data[100].path).toEqual([node(100, 0), node(100, 100)]);
  });

  test('selected cell outline is closed, aligned to all four grid nodes and current altitude', () => {
    const path = outline({ i: 4, j: 8 }, node, 15.08);
    expect(path.length).toBe(5);
    expect(path[0]).toEqual(path[4]);
    expect(path[2]).toEqual([...node(5, 9), 15.08]);
    expect(path.every((p) => p[2] === 15.08)).toBe(true);
  });

  test('coordinate picker rejects out-of-range, fractional and invalid indices', () => {
    expect(validCell(grid, 0, 0)).toBe(true);
    expect(validCell(grid, 99, 99)).toBe(true);
    for (const [i, j] of [
      [100, 0],
      [-1, 0],
      [0, 100],
      [0.5, 0],
      [NaN, 1],
    ])
      expect(validCell(grid, i, j)).toBe(false);
  });

  test('nodes are bilinear in the corners and match geoAt inside the domain', () => {
    const corners = cornersFromBounds([106.7, 10.77, 106.71, 10.78]);
    const { node: n } = buildNodes({ nx: 4, ny: 2 }, corners);
    expect(n(0, 0)).toEqual([106.7, 10.77]);
    expect(n(4, 2)).toEqual([106.71, 10.78]);
    const mid = n(2, 1);
    expect(mid[0]).toBeCloseTo(106.705, 12);
    expect(mid[1]).toBeCloseTo(10.775, 12);
    const g = geoAt(corners, 0.5, 0.5);
    expect(g[0]).toBeCloseTo(mid[0], 12);
    expect(g[1]).toBeCloseTo(mid[1], 12);
  });

  test('cells, C-order index and cell-centre heights', () => {
    expect(buildCells({ nx: 3, ny: 2 })).toEqual([
      { i: 0, j: 0 },
      { i: 1, j: 0 },
      { i: 2, j: 0 },
      { i: 0, j: 1 },
      { i: 1, j: 1 },
      { i: 2, j: 1 },
    ]);
    expect(voxelIndex({ nx: 3, ny: 2 }, 1, 1, 2)).toBe(11);
    expect(zCentres({ nz: 3, dz_m: 2 })).toEqual([1, 3, 5]);
  });
});
