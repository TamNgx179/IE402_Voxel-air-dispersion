// Ported from web/tests/viewer-lod.test.cjs.
import { describe, expect, test } from 'vitest';
import type { BuildingProperties, Feature } from '../api/types';
import { build } from './buildingAppearance';
import { controller, levelForZoom, paddedBounds, prepare, select, type LodCamera } from './lod';

const feature = (id: string, x: number): Feature<BuildingProperties> => ({
  type: 'Feature',
  properties: { source_feature_id: id, height_m: 30 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, 10],
        [x + 0.0002, 10],
        [x + 0.0002, 10.0002],
        [x, 10.0002],
        [x, 10],
      ],
    ],
  },
});

describe('facade LoD', () => {
  test('three LoD levels reduce actual vertices and never mutate source geometry or appearance', () => {
    const scene = { features: [feature('a', 106), feature('b', 107)] },
      before = JSON.stringify(scene),
      appearance = build(scene),
      original = JSON.stringify(appearance.windows);
    const p = prepare(scene, appearance),
      far = select(p, 'overview'),
      middle = select(p, 'medium'),
      near = select(p, 'detail');
    expect(far.vertices).toBe(0);
    expect(middle.vertices).toBeGreaterThan(0);
    expect(middle.vertices).toBeLessThan(near.vertices / 2);
    expect(near.polygons).toBe(appearance.windows.length + appearance.frames.length);
    expect(JSON.stringify(scene)).toBe(before);
    expect(JSON.stringify(appearance.windows)).toBe(original);
    const cut = select(p, 'detail', [105.9, 9.9, 106.1, 10.1]);
    expect(cut.polygons > 0 && cut.polygons < near.polygons).toBe(true);
    expect(cut.windows.every((w) => w.id === 'a')).toBe(true);
    expect(select(p, 'detail', [0, 0, 1, 1]).vertices).toBe(0);
  });

  test('hysteresis and camera cache prevent buffer churn at zoom boundaries', () => {
    expect(levelForZoom(16)).toBe('overview');
    expect(levelForZoom(17)).toBe('medium');
    expect(levelForZoom(18)).toBe('detail');
    expect(levelForZoom(16.55, 'overview')).toBe('overview');
    expect(levelForZoom(17.4, 'detail')).toBe('detail');
    const map: LodCamera = {
      getZoom: () => 18,
      getPitch: () => 55,
      getBounds: () => ({ getSouth: () => 9.9, getNorth: () => 10.1, getWest: () => 105.9, getEast: () => 106.1 }),
    };
    const get = controller(prepare({ features: [feature('a', 106)] }, build({ features: [feature('a', 106)] })));
    expect(get(map)).toBe(get(map));
    expect(paddedBounds(map, 91)[0]).toBeLessThan(105.9);
    const first = get(map);
    map.getBounds = () => ({ getSouth: () => 9.91, getNorth: () => 10.11, getWest: () => 105.91, getEast: () => 106.11 });
    // Camera moved but the same visible buildings must reuse GPU data arrays.
    expect(get(map)).toBe(first);
  });

  test('courtyards and multipolygons remain byte-identical through culling', () => {
    const f = feature('a', 106);
    (f.geometry.coordinates as number[][][]).push([
      [106.00005, 10.00005],
      [106.0001, 10.00005],
      [106.0001, 10.0001],
      [106.00005, 10.00005],
    ]);
    const m: Feature<BuildingProperties> = {
      ...feature('b', 107),
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          feature('c', 107).geometry.coordinates as number[][][],
          feature('d', 108).geometry.coordinates as number[][][],
        ],
      },
    };
    const scene = { features: [f, m] },
      before = JSON.stringify(scene),
      p = prepare(scene, build(scene));
    for (const mode of ['overview', 'medium', 'detail'] as const) select(p, mode, [105, 9, 109, 11]);
    expect(JSON.stringify(scene)).toBe(before);
  });
});
