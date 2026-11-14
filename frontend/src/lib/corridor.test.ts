import { describe, expect, it } from 'vitest';
import { ApiError, AppError } from '../api/client';
import type { Geometry } from '../api/geojson';
import { translate } from '../i18n';
import {
  MAX_ROADS,
  bandColor,
  corridorErrorKey,
  corridorRequest,
  lift,
  nearestRoad,
  parseDistances,
  roadClass,
  roadLabelParts,
  roadLength,
} from './corridor';

const keyOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).messageKey;
  }
  throw new Error('expected a throw');
};

describe('parseDistances', () => {
  it('accepts 1-5 strictly increasing values inside the API range', () => {
    expect(parseDistances('10, 25;50')).toEqual([10, 25, 50]);
    expect(parseDistances(' 0.1 100 ')).toEqual([0.1, 100]);
    const cases: Array<[string, string]> = [
      ['', 'analysis.corridor.distanceCount'],
      ['1,2,3,4,5,6', 'analysis.corridor.distanceCount'],
      ['10,10', 'analysis.corridor.distanceOrder'],
      ['25,10', 'analysis.corridor.distanceOrder'],
      ['0,10', 'analysis.corridor.distanceRange'],
      ['10,101', 'analysis.corridor.distanceRange'],
      ['a,10', 'analysis.corridor.distanceRange'],
    ];
    for (const [bad, key] of cases) expect(keyOf(() => parseDistances(bad)), bad).toBe(key);
    expect(keyOf(() => parseDistances(null))).toBe('analysis.corridor.distanceCount');
  });
});

describe('corridorRequest', () => {
  const ok = { roadIds: ['r1'], distances: '10,25', min: '0', max: '15', threshold: '15', height: 250 };
  it('builds the exact body', () => {
    expect(corridorRequest(ok)).toEqual({
      road_ids: ['r1'],
      distances_m: [10, 25],
      z_min_m: 0,
      z_max_m: 15,
      threshold_ug_m3: 15,
    });
  });
  it('guards roads, altitude interval and threshold before any network call', () => {
    expect(keyOf(() => corridorRequest({ ...ok, roadIds: [] }))).toBe('analysis.corridor.noRoads');
    expect(MAX_ROADS).toBe(50);
    try {
      corridorRequest({ ...ok, roadIds: Array.from({ length: 51 }, (_, i) => `r${i}`) });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as AppError).messageKey).toBe('analysis.corridor.maxRoads');
      expect((error as AppError).params).toEqual({ max: 50 });
      expect(translate('vi', 'analysis.corridor.maxRoads', (error as AppError).params)).toMatch(/tối đa 50/);
    }
    expect(corridorRequest({ ...ok, roadIds: Array.from({ length: 50 }, (_, i) => `r${i}`) }).road_ids).toHaveLength(50);
    for (const patch of [{ min: '15', max: '15' }, { max: '300' }, { max: '' }])
      expect(keyOf(() => corridorRequest({ ...ok, ...patch }))).toBe('analysis.validation.heightRange');
    expect(keyOf(() => corridorRequest({ ...ok, threshold: '-1' }))).toBe('analysis.validation.threshold');
    expect(keyOf(() => corridorRequest({ ...ok, distances: '25,10' }))).toBe('analysis.corridor.distanceOrder');
  });
  it('copies the road id list', () => {
    const roadIds = ['a'];
    const body = corridorRequest({ ...ok, roadIds });
    expect(body.road_ids).not.toBe(roadIds);
  });
});

const roads = [
  {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString',
      coordinates: [
        [106.7, 10.77],
        [106.701, 10.77],
      ],
    } as Geometry,
    properties: { source_feature_id: 'a', road_class: 'primary' },
  },
  {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString',
      coordinates: [
        [106.7, 10.771],
        [106.701, 10.771],
      ],
    } as Geometry,
    properties: { source_feature_id: 'b', road_class: 'residential' },
  },
];

describe('roads', () => {
  it('nearest road uses metric distance to segments and respects the click tolerance', () => {
    // ~11 m north of road a, ~100 m south of road b.
    expect(nearestRoad(roads, [106.7005, 10.7701], 15)?.properties.source_feature_id).toBe('a');
    expect(nearestRoad(roads, [106.7005, 10.7701], 5)).toBeNull();
    expect(nearestRoad(roads, [106.7005, 10.7709], 15)?.properties.source_feature_id).toBe('b');
    expect(nearestRoad(null, [106.7, 10.77], 15)).toBeNull();
  });
  it('labels a road by index, class and metric length (legacy roadLabel)', () => {
    const parts = roadLabelParts(roads[0], 0);
    expect(parts.index).toBe(1);
    expect(parts.lengthM).toBeGreaterThanOrEqual(100);
    expect(parts.lengthM).toBeLessThan(110);
    expect(roadClass(roads[0])).toEqual({ key: 'analysis.corridor.class.primary' });
    const label = translate('vi', 'analysis.corridor.roadLabel', {
      index: parts.index,
      kind: translate('vi', 'analysis.corridor.class.primary'),
      length: Math.round(parts.lengthM),
    });
    expect(label).toMatch(/^Đoạn 1 · đường chính · 10\d m$/);
    expect(roadClass({ geometry: null, properties: { road_class: 'track' } })).toEqual({ text: 'track' });
    expect(roadClass({ geometry: null, properties: {} })).toEqual({ key: 'analysis.corridor.class.default' });
    expect(roadClass({ geometry: null, properties: { road_class: 'toString' } })).toEqual({ text: 'toString' });
  });
  it('measures MultiLineString roads and skips degenerate parts', () => {
    const single = roadLength(roads[0]);
    const multi = roadLength({
      geometry: { type: 'MultiLineString', coordinates: [roads[0].geometry.coordinates as number[][], [[106.7, 10.77]]] },
    });
    expect(multi).toBeCloseTo(single, 9);
    expect(roadLength({ geometry: { type: 'Point', coordinates: [0, 0] } })).toBe(0);
  });
});

describe('display helpers', () => {
  it('lifts band geometry for display and draws missing means as neutral gray', () => {
    const lifted = lift(
      {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        ],
      },
      3,
    );
    expect(lifted?.type).toBe('MultiPolygon');
    expect((lifted?.coordinates as number[][][][])[0][0][1]).toEqual([1, 0, 3]);
    expect(
      lift(
        {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [0, 0],
            ],
          ],
        },
        2,
      )?.coordinates[0][1],
    ).toEqual([1, 0, 2]);
    expect(lift({ type: 'GeometryCollection' }, 3)).toBeNull();
    expect(bandColor(null, 0, 1)).toEqual([140, 140, 140, 70]);
    expect(bandColor(undefined, 0, 1)).toEqual([140, 140, 140, 70]);
    expect(bandColor(1, 0, 1)).toEqual([112, 53, 65, 150]);
    expect(bandColor(0, 0, 0)).toEqual([248, 238, 211, 150]);
    expect(bandColor('1', 0, 1)).toEqual([112, 53, 65, 150]);
  });
});

describe('corridorErrorKey', () => {
  it('maps a server-side road mismatch to a recoverable key', () => {
    const error = new ApiError('validation', 400);
    error.detail = 'One or more road IDs are absent from the run scene';
    expect(corridorErrorKey(error)).toEqual({ key: 'analysis.error.corridor.roadMismatch' });
    expect(translate('vi', corridorErrorKey(error).key)).toMatch(/không thuộc cảnh/);
  });
  it('maps strictly-increasing errors and falls back to the analysis classifier', () => {
    expect(corridorErrorKey({ status: 400, message: 'distances_m must be strictly increasing' }).key).toBe(
      'analysis.corridor.distanceOrder',
    );
    expect(corridorErrorKey({ status: 500 }).key).toBe('analysis.error.server');
    expect(corridorErrorKey(new AppError('analysis.corridor.noRoads')).key).toBe('analysis.corridor.noRoads');
  });
});
