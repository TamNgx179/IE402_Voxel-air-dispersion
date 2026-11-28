// Ported from web/tests/building-appearance.test.cjs.
import { describe, expect, test } from 'vitest';
import type { BuildingProperties, Feature } from '../api/types';
import { LIGHTS, WALL_MATERIAL, build, detailOpacity, lighting, material, roofColor } from './buildingAppearance';

const feature: Feature<BuildingProperties> = {
  type: 'Feature',
  properties: { source_feature_id: 'way/test', height_m: 16 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [106, 10],
        [106.0002, 10],
        [106.0002, 10.0002],
        [106, 10.0002],
        [106, 10],
      ],
    ],
  },
};

describe('building appearance', () => {
  test('procedural glass and sills preserve GIS geometry and remain below roof', () => {
    const before = JSON.stringify(feature),
      appearance = build({ features: [feature] });
    expect(JSON.stringify(feature)).toBe(before);
    expect(appearance.windows.length).toBeGreaterThan(0);
    expect(appearance.frames.length).toBe(appearance.windows.length);
    expect([...appearance.windows, ...appearance.frames].every((w) => w.polygon.every((p) => p[2] > 0 && p[2] < 16))).toBe(
      true,
    );
    expect(appearance.features.get('way/test')!.illustrativeWalls).toBe(4);
  });

  test('muted materials vary between buildings and stay stable across render/reload', () => {
    const color = material(feature);
    expect(material(structuredClone(feature))).toEqual(color);
    const seen = new Set<string>();
    for (let id = 0; id < 16; id++) {
      const sample = material({ properties: { source_feature_id: `way/${id}` } });
      // Never pure white (the old flat look) and never dark enough to fight the concentration scale.
      expect(sample.every((channel) => channel >= 200 && channel <= 240)).toBe(true);
      seen.add(sample.join());
    }
    expect(seen.size).toBeGreaterThan(2);
    const scene = { features: [feature] };
    expect(build(scene).windows).toEqual(build(scene).windows);
    expect(build(scene).windows.every((w) => w.color.every((c) => c <= 200))).toBe(true);
    expect(build(scene).frames.every((w) => w.color.every((c) => c <= 221))).toBe(true);
  });

  test('explicit soft lights bound exposure and do not enable experimental shadows', () => {
    class Light {
      constructor(public props: Record<string, unknown>) {}
    }
    class Effect {
      constructor(public props: Record<string, { props: Record<string, unknown> }>) {}
    }
    const effect = lighting({
      AmbientLight: Light,
      DirectionalLight: Light,
      LightingEffect: Effect as unknown as new (lights: { ambient: Light; key: Light; fill: Light }) => Effect,
    });
    expect(effect.props.key.props).toEqual(LIGHTS.key);
    const upperBound =
      WALL_MATERIAL.ambient * LIGHTS.ambient.intensity + WALL_MATERIAL.diffuse * (LIGHTS.key.intensity + LIGHTS.fill.intensity);
    expect(upperBound > 1 && upperBound < 1.1).toBe(true);
    expect(WALL_MATERIAL.specularColor).toEqual([0, 0, 0]);
    expect(effect.props.key.props._shadow).toBeUndefined();
  });

  test('facades reveal bounded detail progressively with zoom, without altering geometry', () => {
    expect(detailOpacity(NaN)).toBe(0);
    expect(detailOpacity(14)).toBe(0.2);
    expect(detailOpacity(16.5)).toBeLessThan(detailOpacity(17));
    expect(Math.abs(detailOpacity(19) - 0.9)).toBeLessThan(1e-10);
  });

  test('floor bands and roof caps are darker than walls and do not overlap window rows', () => {
    const appearance = build({ features: [feature] });
    const wall = material(feature);
    // 16 m tall: bands at 4.8, 8.4 and 12.0 m (15.6 m would touch the roof) on each of 4 walls.
    expect(appearance.bands.length).toBe(12);
    expect(appearance.bands.every((b) => b.color.every((c, i) => c < wall[i]))).toBe(true);
    for (const band of appearance.bands) {
      const zs = band.polygon.map((p) => p[2]);
      const [lo, hi] = [Math.min(...zs), Math.max(...zs)];
      expect(appearance.windows.some((w) => w.polygon.some((p) => p[2] > lo && p[2] < hi))).toBe(false);
    }
    expect(appearance.roofs).toHaveLength(1);
    expect(appearance.roofs[0].color).toEqual(roofColor(feature));
    expect(appearance.roofs[0].polygon[0].every((p) => p[2] > 16 && p[2] < 16.1)).toBe(true);
  });

  test('photo registry cannot replace procedural faces anymore', () => {
    const scene = { features: [feature] };
    expect(build(scene, { 'way/test': { walls: [{ image: 'unwanted.jpg', part: 0, edge: 0 }] } })).toEqual(build(scene));
    expect((build(scene) as unknown as { photos?: unknown }).photos).toBeUndefined();
  });
});
