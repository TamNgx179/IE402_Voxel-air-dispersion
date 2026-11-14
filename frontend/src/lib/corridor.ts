/**
 * Road corridor × altitude helpers (port of the DOM-free parts of web/viewer-corridor.js).
 * Statistics come only from the server's volume-weighted SQL; this module validates
 * requests, picks roads and maps values to display colours.
 */
import type { TranslationKey } from '../i18n';
import type { Geometry, Position } from '../api/geojson';
import { analysisErrorKey, throwKeyed, validHeightRange, validThreshold, type ErrorMessage } from './analysis';

export const MAX_ROADS = 50;
export const MAX_BANDS = 5;
export const MIN_BAND_DISTANCE_M = 0.1;
export const MAX_BAND_DISTANCE_M = 100;

export type RGBA = [number, number, number, number];

/** Parses "10, 25; 50" into 1–5 strictly increasing distances in [0.1, 100] m. */
export function parseDistances(text: string | null | undefined): number[] {
  const parts = String(text ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (!parts.length || parts.length > MAX_BANDS) throwKeyed('analysis.corridor.distanceCount', { max: MAX_BANDS });
  const values = parts.map((part) => Number(part));
  if (values.some((value) => !Number.isFinite(value) || value < MIN_BAND_DISTANCE_M || value > MAX_BAND_DISTANCE_M))
    throwKeyed('analysis.corridor.distanceRange');
  if (values.some((value, index) => index > 0 && value <= values[index - 1]))
    throwKeyed('analysis.corridor.distanceOrder');
  return values;
}

export interface CorridorRequestInput {
  roadIds: readonly string[];
  distances: string;
  min: string | number;
  max: string | number;
  threshold: string | number;
  /** Model domain height (m). */
  height: number;
}

export interface CorridorRequest {
  road_ids: string[];
  distances_m: number[];
  z_min_m: number;
  z_max_m: number;
  threshold_ug_m3: number;
}

/** Corridor query body; throws keyed `AppError` before any network call. */
export function corridorRequest({ roadIds, distances, min, max, threshold, height }: CorridorRequestInput): CorridorRequest {
  if (!roadIds.length) throwKeyed('analysis.corridor.noRoads');
  if (roadIds.length > MAX_ROADS) throwKeyed('analysis.corridor.maxRoads', { max: MAX_ROADS });
  const distances_m = parseDistances(distances);
  if (!validHeightRange(min, max, height)) throwKeyed('analysis.validation.heightRange', { max: height });
  if (!validThreshold(threshold)) throwKeyed('analysis.validation.threshold');
  return {
    road_ids: [...roadIds],
    distances_m,
    z_min_m: Number(min),
    z_max_m: Number(max),
    threshold_ug_m3: Number(threshold),
  };
}

// Local equirectangular metres are accurate enough for a 500 m click tolerance.
function local(origin: Position): (p: Position) => [number, number] {
  const kx = Math.cos((origin[1] * Math.PI) / 180) * 111320,
    ky = 110540;
  return (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky];
}

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function lines(geometry: Geometry | null | undefined): Position[][] {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

export interface RoadLike {
  geometry: Geometry | null;
  properties?: { road_class?: unknown; [key: string]: unknown } | null;
}

/** Road whose nearest segment is within `toleranceM` metres of `lngLat`, or null. */
export function nearestRoad<F extends RoadLike>(
  features: readonly F[] | null | undefined,
  lngLat: Position,
  toleranceM: number,
): F | null {
  const toLocal = local(lngLat),
    p: [number, number] = [0, 0];
  let best: F | null = null,
    bestDistance = Infinity;
  for (const feature of features || []) {
    for (const line of lines(feature.geometry)) {
      const pts = line.map(toLocal);
      for (let n = 1; n < pts.length; n++) {
        const d = segmentDistance(p, pts[n - 1], pts[n]);
        if (d < bestDistance) {
          bestDistance = d;
          best = feature;
        }
      }
    }
  }
  return best && bestDistance <= toleranceM ? best : null;
}

/** Approximate metric length of a (Multi)LineString road. */
export function roadLength(feature: RoadLike): number {
  let total = 0;
  for (const line of lines(feature.geometry)) {
    if (line.length < 2) continue;
    const toLocal = local(line[0]);
    for (let n = 1; n < line.length; n++) {
      const a = toLocal(line[n - 1]),
        b = toLocal(line[n]);
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
  }
  return total;
}

const ROAD_CLASS_KEYS: Readonly<Record<string, TranslationKey>> = {
  primary: 'analysis.corridor.class.primary',
  secondary: 'analysis.corridor.class.secondary',
  tertiary: 'analysis.corridor.class.tertiary',
  residential: 'analysis.corridor.class.residential',
  service: 'analysis.corridor.class.service',
  unclassified: 'analysis.corridor.class.unclassified',
};

/**
 * Road kind for the label: a known class → i18n key; an unknown class → its raw
 * OSM value (`text`); no class → the generic 'road' key.
 */
export function roadClass(feature: RoadLike): { key: TranslationKey } | { text: string } {
  const raw = feature.properties?.road_class;
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(ROAD_CLASS_KEYS, raw))
    return { key: ROAD_CLASS_KEYS[raw] };
  if (raw !== undefined && raw !== null && raw !== '') return { text: String(raw) };
  return { key: 'analysis.corridor.class.default' };
}

/**
 * Params for `t('analysis.corridor.roadLabel', …)` except `kind` (resolve it with
 * `roadClass`) and `length` (format `lengthM` with 3 significant digits).
 */
export function roadLabelParts(feature: RoadLike, index: number): { index: number; lengthM: number } {
  return { index: index + 1, lengthM: roadLength(feature) };
}

type Ring = Position[];
export type LiftedGeometry =
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] };

/** Copies a (Multi)Polygon with every position lifted to altitude `z`; null otherwise. */
export function lift(geometry: Geometry | { type: string } | null | undefined, z: number): LiftedGeometry | null {
  const ring = (r: Ring): Ring => r.map((p) => [p[0], p[1], z]);
  const g = geometry as Geometry | null | undefined;
  if (g?.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(ring) };
  if (g?.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map(ring)) };
  return null;
}

/** Linear band colour; missing means are drawn as translucent neutral gray. */
export function bandColor(value: number | string | null | undefined, lo: number, hi: number): RGBA {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return [140, 140, 140, 70];
  const t = Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo || 1)));
  const a = [248, 238, 211],
    b = [112, 53, 65];
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return [mix(0), mix(1), mix(2), 150];
}

/** Corridor-specific server messages first, then the shared analysis classifier. */
export function corridorErrorKey(error: unknown): ErrorMessage {
  const e = (error && typeof error === 'object' ? error : {}) as { detail?: unknown; message?: unknown };
  const message = String(e.detail || e.message || '');
  if (/strictly increasing/i.test(message)) return { key: 'analysis.corridor.distanceOrder' };
  if (/road IDs are absent/i.test(message)) return { key: 'analysis.error.corridor.roadMismatch' };
  return analysisErrorKey(error);
}
