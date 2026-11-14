// Ported from web/tests/building-appearance.test.cjs.
import { describe, expect, test } from 'vitest';
import type { BuildingProperties, Feature } from '../api/types';
import { LIGHTS, WALL_MATERIAL, build, detailOpacity, lighting, material } from './buildingAppearance';

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

  test('pearl materials stay between dull gray and pure white and stable across render/reload', () => {
    const color = material(feature);
    expect(material(structuredClone(feature))).toEqual(color);
    for (let id = 0; id < 16; id++) {
      const sample = material({ properties: { source_feature_id: `way/${id}` } });
      expect(sample.every((channel) => channel >= 218 && channel <= 234)).toBe(true);
    }
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

  test('photo registry cannot replace procedural faces anymore', () => {
    const scene = { features: [feature] };
    expect(build(scene, { 'way/test': { walls: [{ image: 'unwanted.jpg', part: 0, edge: 0 }] } })).toEqual(build(scene));
    expect((build(scene) as unknown as { photos?: unknown }).photos).toBeUndefined();
  });
});
