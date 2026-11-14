/** Display-only LoD1 facade detail (port of web/building-appearance.js). Never changes GIS/solver geometry. */
import type { BuildingProperties, Feature, FeatureCollection } from '../api/types';

export type RGB = [number, number, number];
type BuildingFeature = Pick<Feature<BuildingProperties>, 'properties' | 'geometry'>;

const MATERIALS: RGB[] = [
  [232, 228, 218],
  [228, 232, 228],
  [231, 229, 223],
  [225, 230, 234],
];

// Cartographic daylight, not a simulated sun/time or energy model.
// Explicit lights avoid the default pair overexposing near-white buildings.
export const WALL_MATERIAL = Object.freeze({
  ambient: 0.88,
  diffuse: 0.24,
  shininess: 16,
  specularColor: [0, 0, 0] as RGB,
});

export const LIGHTS = Object.freeze({
  ambient: { color: [255, 255, 255] as RGB, intensity: 1 },
  key: { color: [255, 255, 255] as RGB, intensity: 0.6, direction: [-3, -4, -6] as RGB },
  fill: { color: [255, 255, 255] as RGB, intensity: 0.22, direction: [4, 2, -3] as RGB },
});

/** The subset of @deck.gl/core used to build the lighting effect (injectable for tests). */
export interface LightingClasses<E> {
  LightingEffect: new (lights: Record<string, unknown>) => E;
  AmbientLight: new (props: typeof LIGHTS.ambient) => unknown;
  DirectionalLight: new (props: typeof LIGHTS.key) => unknown;
}

export function lighting<E>(deck: LightingClasses<E>): E {
  return new deck.LightingEffect({
    ambient: new deck.AmbientLight(LIGHTS.ambient),
    key: new deck.DirectionalLight(LIGHTS.key),
    fill: new deck.DirectionalLight(LIGHTS.fill),
  });
}

export function detailOpacity(zoom: number | undefined): number {
  if (zoom === undefined || !Number.isFinite(zoom)) return 0;
  // Keep analytical overview calm; reveal facade detail when inspecting.
  const t = Math.max(0, Math.min(1, (zoom - 16) / 1.6));
  return 0.2 + 0.7 * t * t * (3 - 2 * t);
}

function hash(id: unknown): number {
  return [...String(id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 0);
}

export function material(feature: { properties: { source_feature_id: unknown } }): RGB {
  return MATERIALS[hash(feature.properties.source_feature_id) % MATERIALS.length];
}

export interface Wall {
  part: number;
  edge: number;
  length: number;
  point: (t: number, z: number) => [number, number, number];
  height: number;
}

export function walls(feature: BuildingFeature): Wall[] {
  const geometry = feature.geometry;
  const polygons: number[][][][] =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flatMap((rings, part) => {
    const ring = rings[0],
      area = ring.reduce((n, a, i) => {
        const b = ring[(i + 1) % ring.length];
        return n + a[0] * b[1] - b[0] * a[1];
      }, 0);
    return ring
      .slice(0, -1)
      .map((a, edge): Wall | null => {
        const b = ring[edge + 1],
          lat = (a[1] + b[1]) / 2,
          lonScale = 111320 * Math.cos((lat * Math.PI) / 180);
        const dx = (b[0] - a[0]) * lonScale,
          dy = (b[1] - a[1]) * 111320,
          length = Math.hypot(dx, dy);
        if (length < 0.2) return null;
        const sign = area >= 0 ? 1 : -1;
        // 8 cm outward offset avoids depth fighting; not part of the solid mask.
        const offset = [(((sign * dy) / length) * 0.08) / lonScale, (((-sign * dx) / length) * 0.08) / 111320];
        const point = (t: number, z: number): [number, number, number] => [
          a[0] + (b[0] - a[0]) * t + offset[0],
          a[1] + (b[1] - a[1]) * t + offset[1],
          z,
        ];
        return { part, edge, length, point, height: feature.properties.height_m };
      })
      .filter((wall): wall is Wall => wall !== null);
  });
}

export interface FacadePolygon {
  id: string;
  polygon: Array<[number, number, number]>;
  color: RGB;
}

export interface BuildingInfo {
  id: string;
  height: number;
  illustrativeWalls: number;
}

export interface Appearance {
  windows: FacadePolygon[];
  frames: FacadePolygon[];
  features: Map<string, BuildingInfo>;
}

export function build(scene: Pick<FeatureCollection<BuildingProperties>, 'features'>, _legacyPhotos?: unknown): Appearance {
  const windows: FacadePolygon[] = [],
    frames: FacadePolygon[] = [],
    features = new Map<string, BuildingInfo>();
  for (const feature of scene.features) {
    const id = feature.properties.source_feature_id;
    const info: BuildingInfo = { id, height: feature.properties.height_m, illustrativeWalls: 0 };
    features.set(id, info);
    for (const wall of walls(feature)) {
      info.illustrativeWalls++;
      const columns = Math.min(20, Math.floor(wall.length / 4.2));
      for (let bottom = 2.2, row = 0; bottom + 1.6 < wall.height - 0.6; bottom += 3.6, row++) {
        for (let column = 0; column < columns; column++) {
          const centre = (column + 0.5) / columns,
            half = Math.min(1.1 / wall.length, 0.32 / columns);
          const variation = (hash(id) + row * 7 + column * 13) % 3;
          // Light sill/frame below each pane; no fabricated surveyed detail.
          frames.push({
            id,
            polygon: [
              wall.point(centre - half - 0.08 / wall.length, bottom - 0.12),
              wall.point(centre - half - 0.08 / wall.length, bottom),
              wall.point(centre + half + 0.08 / wall.length, bottom),
              wall.point(centre + half + 0.08 / wall.length, bottom - 0.12),
            ],
            color: [221, 221, 215],
          });
          windows.push({
            id,
            polygon: [
              wall.point(centre - half, bottom),
              wall.point(centre - half, bottom + 1.6),
              wall.point(centre + half, bottom + 1.6),
              wall.point(centre + half, bottom),
            ],
            color: variation === 0 ? [160, 184, 196] : variation === 1 ? [153, 177, 190] : [165, 188, 200],
          });
        }
      }
    }
  }
  return { windows, frames, features };
}
