/**
 * Renderer-only LoD (port of web/map/viewer-lod.js). Never changes footprints,
 * heights or the concentration array.
 */
import type { BuildingProperties, Feature } from '../api/types';
import type { Appearance, FacadePolygon } from './buildingAppearance';

export type LodLevel = 'overview' | 'medium' | 'detail';
export type Bounds = [number, number, number, number];

export function levelForZoom(zoom: number, previous?: LodLevel): LodLevel {
  const target: LodLevel = zoom < 16.5 ? 'overview' : zoom < 17.5 ? 'medium' : 'detail';
  // Hysteresis avoids rebuilding buffers when the camera oscillates near a zoom boundary.
  if (previous === 'overview' && zoom < 16.65) return previous;
  if (previous === 'detail' && zoom > 17.35) return previous;
  if (previous === 'medium' && zoom >= 16.35 && zoom <= 17.65) return previous;
  return target;
}

interface Group {
  id: string;
  box: Bounds;
  windows: FacadePolygon[];
  frames: FacadePolygon[];
  medium: FacadePolygon[];
}

export interface PreparedLod {
  groups: Group[];
  maxHeight: number;
}

export function prepare(
  scene: { features: Array<Pick<Feature<BuildingProperties>, 'properties' | 'geometry'>> },
  appearance: Pick<Appearance, 'windows' | 'frames'>,
): PreparedLod {
  const groups: Group[] = scene.features.map((feature) => {
    const id = feature.properties.source_feature_id;
    const coordinates = feature.geometry.coordinates as unknown[];
    const points = coordinates.flat(feature.geometry.type === 'MultiPolygon' ? 2 : 1) as number[][];
    return {
      id,
      box: [
        Math.min(...points.map((p) => p[0])),
        Math.min(...points.map((p) => p[1])),
        Math.max(...points.map((p) => p[0])),
        Math.max(...points.map((p) => p[1])),
      ],
      windows: [],
      frames: [],
      medium: [],
    };
  });
  const byId = new Map(groups.map((g) => [g.id, g]));
  appearance.windows.forEach((p) => byId.get(p.id)?.windows.push(p));
  appearance.frames.forEach((p) => byId.get(p.id)?.frames.push(p));
  groups.forEach((g) => {
    g.medium = g.windows.filter((_, i) => i % 4 === 0);
  });
  const maxHeight = Math.max(0, ...scene.features.map((f) => f.properties.height_m));
  return { groups, maxHeight };
}

export interface LodPlan {
  level: LodLevel;
  windows: FacadePolygon[];
  frames: FacadePolygon[];
  polygons: number;
  vertices: number;
}

export function select(prepared: PreparedLod, level: LodLevel, bounds?: Bounds): LodPlan {
  const windows: FacadePolygon[] = [],
    frames: FacadePolygon[] = [];
  if (level !== 'overview')
    for (const g of prepared.groups) {
      const b = g.box;
      if (bounds && (b[2] < bounds[0] || b[0] > bounds[2] || b[3] < bounds[1] || b[1] > bounds[3])) continue;
      windows.push(...(level === 'detail' ? g.windows : g.medium));
      if (level === 'detail') frames.push(...g.frames);
    }
  return {
    level,
    windows,
    frames,
    polygons: windows.length + frames.length,
    vertices: (windows.length + frames.length) * 4,
  };
}

/** The camera methods the LoD controller reads (a MapLibre map satisfies this). */
export interface LodCamera {
  getZoom(): number;
  getPitch(): number;
  getBounds(): { getSouth(): number; getNorth(): number; getWest(): number; getEast(): number };
}

export function paddedBounds(map: LodCamera, height: number): Bounds {
  const b = map.getBounds(),
    lat = (b.getSouth() + b.getNorth()) / 2;
  // Pad by height and pitch: keep buildings whose roofs are still in view.
  const metres = 50 + height * Math.tan((Math.min(80, map.getPitch()) * Math.PI) / 180);
  const dy = metres / 111320,
    dx = dy / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
  return [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
}

export type LodController = (map: LodCamera) => LodPlan;

export function controller(prepared: PreparedLod): LodController {
  let previous: LodLevel | undefined, key: string | undefined, saved: LodPlan | undefined;
  return (map) => {
    const level = levelForZoom(map.getZoom(), previous),
      bounds = paddedBounds(map, prepared.maxHeight);
    // Buffers change only when the visible building set changes, not per camera pixel.
    const visible = prepared.groups.filter((g) => {
      const b = g.box;
      return !(b[2] < bounds[0] || b[0] > bounds[2] || b[3] < bounds[1] || b[1] > bounds[3]);
    });
    const next = JSON.stringify([level, visible.map((g) => g.id)]);
    previous = level;
    if (next !== key || !saved) {
      saved = select(prepared, level, bounds);
      key = next;
    }
    return saved;
  };
}
