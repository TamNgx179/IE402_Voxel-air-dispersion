import { describe, expect, test } from 'vitest';
import { dataQuality } from './evidence';
import { milestones } from './heightMarks';

// Unknown tags must not silently be described as measured or fallback heights.
describe('scene data quality', () => {
  test('distinguishes satellite, tagged, derived, fallback and unknown', () => {
    const scene = {
      features: ['gob:building_height', 'direct:height', 'levels:building:levels', 'fallback:fixed', 'unresolved', 'new-provider'].map(
        (height_source) => ({ properties: { height_source, height_m: 20 } }),
      ),
    };
    const q = dataQuality(scene, { buildings: { footprint: 'OpenStreetMap contributors' } });
    expect(q.total).toBe(6);
    expect(q.groups.map((g) => [g.key, g.count])).toEqual([
      ['gob', 1],
      ['tagged', 1],
      ['levels', 1],
      ['fallback', 1],
      ['unknown', 2],
    ]);
    expect(q.footprint_source).toBe('OpenStreetMap contributors');
    expect(q.terrain).toBe('flat');
    expect(dataQuality(null).total).toBeNull();
    expect(dataQuality({ features: [] }).state).toBe('empty');
    expect(dataQuality({ features: [{ properties: { height_source: 'gob:x', height_m: null } }] }).groups[0].key).toBe('unknown');
  });

  test('upstream OSM and derived-median provenance tags are classified explicitly', () => {
    for (const [height_source, key] of [
      ['osm:height', 'tagged'],
      ['osm:building:levels', 'levels'],
      ['derived:median', 'fallback'],
    ])
      expect(dataQuality({ features: [{ properties: { height_source, height_m: 12 } }] }).groups[0].key).toBe(key);
  });
});

describe('height milestones', () => {
  test('altitude milestones are actual voxel centres at proportional slider positions', () => {
    const list = milestones(Array.from({ length: 50 }, (_, k) => k * 2 + 1));
    expect(list.map((x) => x.index)).toEqual([0, 12, 25, 37, 49]);
    expect(list.map((x) => x.label)).toEqual(['1 m', '25 m', '51 m', '75 m', '99 m']);
    expect(list[1].position).toBe((12 / 49) * 100);
    expect(list[2].position).toBe((25 / 49) * 100);
    expect(milestones([1]).length).toBe(1);
    expect(milestones([1, 3]).length).toBe(2);
    expect(milestones([])).toEqual([]);
  });

  test('labels follow the locale decimal separator', () => {
    expect(milestones([2.5, 7.5], 'en').map((m) => m.label)).toEqual(['2.5 m', '7.5 m']);
    expect(milestones([2.5, 7.5], 'vi').map((m) => m.label)).toEqual(['2,5 m', '7,5 m']);
  });
});
