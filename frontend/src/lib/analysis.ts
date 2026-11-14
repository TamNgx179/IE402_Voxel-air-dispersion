/**
 * Pure analysis helpers (port of the DOM-free parts of web/viewer-analysis.js).
 *
 * User-facing text is never produced here: client validation throws `AppError`
 * carrying an i18n key (+ params), and `analysisErrorKey` maps any failure to a key.
 * Raw server text is only used for classification, never echoed.
 */
import { AppError, ApiError } from '../api/client';
import type { TranslationKey, TranslationParams } from '../i18n';

type Key<T extends TranslationKey> = T;

export type AnalysisErrorKey = Key<
  | 'analysis.error.invalidPolygon'
  | 'analysis.error.outsideArea'
  | 'analysis.error.heightRange'
  | 'analysis.error.incompatibleRuns'
  | 'analysis.error.notSucceeded'
  | 'analysis.error.notFound'
  | 'analysis.error.permission'
  | 'analysis.error.timeout'
  | 'analysis.error.network'
  | 'analysis.error.server'
  | 'analysis.error.conflict'
  | 'analysis.error.validation'
  | 'analysis.error.unknown'
  | 'analysis.error.transect.vertices'
  | 'analysis.error.transect.outsideArea'
  | 'analysis.error.transect.outsideGrid'
  | 'analysis.error.transect.zeroLength'
  | 'analysis.error.transect.step'
  | 'analysis.error.transect.tooManySamples'
  | 'analysis.error.transect.heightRange'
  | 'analysis.error.transect.invalidLine'
>;

export type PolygonErrorKey = Key<
  | 'analysis.polygon.minVertices'
  | 'analysis.polygon.invalidVertices'
  | 'analysis.polygon.shape'
  | 'analysis.polygon.ringSize'
  | 'analysis.polygon.maxCoordinates'
  | 'analysis.polygon.coordinates'
  | 'analysis.polygon.ringClosed'
>;

export interface ErrorMessage {
  key: TranslationKey;
  params?: TranslationParams;
}

export type LngLat = [number, number];
export type RGBA = [number, number, number, number];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}

/** Max vertices of a pointer-drawn polygon before the closing point is added. */
export const MAX_DRAWN_VERTICES = 499;
export const MAX_POLYGON_RINGS = 20;
export const MAX_POLYGON_COORDINATES = 500;

// ---------------------------------------------------------------- latestTask

export interface LatestTask {
  /** Revoke the right of every in-flight request to commit (success or failure). */
  invalidate(): number;
  run<T>(work: () => Promise<T>, commit: (data: T) => void, fail: (error: unknown) => void): Promise<void>;
}

/** Only the most recent request may update the UI; invalidation also drops late errors. */
export function latestTask(): LatestTask {
  let revision = 0;
  return {
    invalidate: () => ++revision,
    async run(work, commit, fail) {
      const token = ++revision;
      try {
        const data = await work();
        if (token === revision) commit(data);
      } catch (error) {
        if (token === revision) fail(error);
      }
    },
  };
}

// ---------------------------------------------------------------- colours

const DELTA_NEUTRAL = [245, 242, 232] as const;
const DELTA_NEGATIVE = [75, 111, 140] as const;
const DELTA_POSITIVE = [157, 83, 78] as const;
const RAMP_LOW = [248, 238, 211] as const;
const RAMP_HIGH = [112, 53, 65] as const;

/**
 * Signed delta ramp (neutral at 0, symmetric around ±max(|lo|,|hi|)) or linear
 * concentration ramp. Non-finite values are fully transparent.
 */
export function color(value: number | null | undefined, lo: number, hi: number, delta = false): RGBA {
  if (typeof value !== 'number' || !Number.isFinite(value)) return [0, 0, 0, 0];
  let a: readonly number[], b: readonly number[], t: number;
  if (delta) {
    const limit = Math.max(Math.abs(lo), Math.abs(hi), 1e-12);
    t = Math.min(1, Math.abs(value) / limit);
    a = DELTA_NEUTRAL;
    b = value < 0 ? DELTA_NEGATIVE : DELTA_POSITIVE;
  } else {
    t = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
    a = RAMP_LOW;
    b = RAMP_HIGH;
  }
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return [mix(0), mix(1), mix(2), 205];
}

// ---------------------------------------------------------------- polygons

/** Throws a keyed client-validation error (rendered by the caller with `t(key, params)`). */
export function throwKeyed(key: TranslationKey, params?: TranslationParams): never {
  throw new AppError(key, params);
}

/** Closes a pointer-drawn ring (copying the points) and validates it as a GeoJSON Polygon. */
export function closePolygon(points: unknown): PolygonGeometry {
  if (!Array.isArray(points) || points.length < 3) throwKeyed('analysis.polygon.minVertices');
  const list = points as unknown[];
  if (
    list.length > MAX_DRAWN_VERTICES ||
    list.some(
      (p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v)),
    )
  )
    throwKeyed('analysis.polygon.invalidVertices');
  const ring = (list as number[][]).map((p) => [...p]);
  const first = ring[0],
    last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return polygonShape({ type: 'Polygon', coordinates: [ring] });
}

/**
 * Validates keyboard/pasted GeoJSON before it can reach a map layer: 1–20 closed
 * rings, ≥4 positions each, ≤500 positions total, finite 2D lon/lat only.
 */
export function polygonShape(raw: unknown): PolygonGeometry {
  const shape = raw as { type?: unknown; coordinates?: unknown } | null | undefined;
  if (
    !shape ||
    typeof shape !== 'object' ||
    shape.type !== 'Polygon' ||
    Object.keys(shape).some((k) => !['type', 'coordinates'].includes(k)) ||
    !Array.isArray(shape.coordinates) ||
    !shape.coordinates.length ||
    shape.coordinates.length > MAX_POLYGON_RINGS
  )
    throwKeyed('analysis.polygon.shape');
  const rings = (shape as { coordinates: unknown[] }).coordinates;
  let count = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) throwKeyed('analysis.polygon.ringSize');
    const positions = ring as unknown[];
    count += positions.length;
    if (count > MAX_POLYGON_COORDINATES) throwKeyed('analysis.polygon.maxCoordinates');
    if (
      positions.some(
        (p) =>
          !Array.isArray(p) ||
          p.length !== 2 ||
          p.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
          Math.abs(p[0] as number) > 180 ||
          Math.abs(p[1] as number) > 90,
      )
    )
      throwKeyed('analysis.polygon.coordinates');
    const first = positions[0] as number[],
      last = positions[positions.length - 1] as number[];
    if (first[0] !== last[0] || first[1] !== last[1]) throwKeyed('analysis.polygon.ringClosed');
  }
  return { type: 'Polygon', coordinates: (rings as number[][][]).map((r) => r.map((p) => [...p])) };
}

// ---------------------------------------------------------------- request validation

export interface RegionRequestInput {
  polygon: PolygonGeometry | null;
  runId: string | null | undefined;
  /** True while an illustration multiplier/background is applied. */
  modified: boolean;
  min: string;
  max: string;
  threshold: string;
  /** Model domain height (m). */
  height: number;
}

export interface RegionRequest {
  polygon: PolygonGeometry;
  z_min_m: number;
  z_max_m: number;
  threshold_ug_m3: number;
}

/** True when `[min, max)` is a valid non-empty interval inside `[0, height]`. */
export function validHeightRange(min: string | number, max: string | number, height: number): boolean {
  const lo = Number(min),
    hi = Number(max);
  return (
    String(min).trim() !== '' &&
    String(max).trim() !== '' &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    lo >= 0 &&
    lo < hi &&
    hi <= height
  );
}

/** True when the threshold field holds a finite, non-negative number. */
export function validThreshold(threshold: string | number): boolean {
  const value = Number(threshold);
  return String(threshold).trim() !== '' && Number.isFinite(value) && value >= 0;
}

/** Region query body (legacy `body()`); throws keyed `AppError` before any network call. */
export function regionRequest(input: RegionRequestInput): RegionRequest {
  if (!input.polygon) return throwKeyed('analysis.validation.noPolygon');
  if (!input.runId) throwKeyed('analysis.validation.noRun');
  if (input.modified) throwKeyed('analysis.validation.modified');
  if (!validHeightRange(input.min, input.max, input.height))
    throwKeyed('analysis.validation.heightRange', { max: input.height });
  if (!validThreshold(input.threshold)) throwKeyed('analysis.validation.threshold');
  return {
    polygon: input.polygon,
    z_min_m: Number(input.min),
    z_max_m: Number(input.max),
    threshold_ug_m3: Number(input.threshold),
  };
}

// ---------------------------------------------------------------- error classifier

interface ErrorLike {
  kind?: unknown;
  status?: unknown;
  detail?: unknown;
  message?: unknown;
}

/** Vietnamese 400 messages from the transect service, mapped to stable keys. */
const TRANSECT_MESSAGES: ReadonlyArray<[RegExp, AnalysisErrorKey]> = [
  [/^Tuyến cần từ 2 đến/, 'analysis.error.transect.vertices'],
  [/^Tuyến phải nằm hoàn toàn/, 'analysis.error.transect.outsideArea'],
  [/^Tuyến nằm ngoài lưới/, 'analysis.error.transect.outsideGrid'],
  [/^Hai điểm liên tiếp/, 'analysis.error.transect.zeroLength'],
  [/^Bước lấy mẫu/, 'analysis.error.transect.step'],
  [/^Mặt cắt vượt/, 'analysis.error.transect.tooManySamples'],
  [/^Khoảng cao độ/, 'analysis.error.transect.heightRange'],
  [/^Tuyến/, 'analysis.error.transect.invalidLine'],
];

function rawMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return typeof error === 'string' ? error : '';
  const e = error as ErrorLike;
  // ApiError.message is an i18n key; only its `detail` carries server text.
  if (error instanceof ApiError) return String(e.detail || '');
  return String(e.detail || e.message || '');
}

/**
 * Maps any analysis failure to an i18n key (port of legacy `analysisError`, same
 * precedence). Client `AppError`s (not `ApiError`s) keep their own key and params.
 */
export function analysisErrorKey(error: unknown): ErrorMessage {
  if (error instanceof AppError && !(error instanceof ApiError))
    return error.params ? { key: error.messageKey, params: error.params } : { key: error.messageKey };
  const e = (error && typeof error === 'object' ? error : {}) as ErrorLike;
  const status = typeof e.status === 'number' ? e.status : undefined;
  const kind = e.kind;
  const message = rawMessage(error);
  if (status === 400) {
    const match = TRANSECT_MESSAGES.find(([pattern]) => pattern.test(message));
    if (match) {
      if (match[1] === 'analysis.error.transect.step') {
        const max = /không quá\s+([\d.,]+)\s*m/.exec(message)?.[1];
        if (max !== undefined) return { key: match[1], params: { max: Number(max.replace(',', '.')) } };
      }
      return { key: match[1] };
    }
  }
  if (/positive area|self.?intersection|polygon must be valid/i.test(message))
    return { key: 'analysis.error.invalidPolygon' };
  if (/fully inside|outside.*study area|not covered/i.test(message)) return { key: 'analysis.error.outsideArea' };
  if (/z_m outside|z_min_m|z_max_m|domain height/i.test(message)) return { key: 'analysis.error.heightRange' };
  if (/share study area|different solid masks|incomplete grids/i.test(message))
    return { key: 'analysis.error.incompatibleRuns' };
  if (/requires succeeded/i.test(message)) return { key: 'analysis.error.notSucceeded' };
  if (kind === 'not-found' || status === 404) return { key: 'analysis.error.notFound' };
  if (kind === 'permission' || status === 401 || status === 403) return { key: 'analysis.error.permission' };
  if (kind === 'timeout') return { key: 'analysis.error.timeout' };
  if (kind === 'network' || /offline|failed to fetch|network error|ECONN/i.test(message))
    return { key: 'analysis.error.network' };
  if (status !== undefined && status >= 500) return { key: 'analysis.error.server' };
  if (kind === 'conflict' || status === 409) return { key: 'analysis.error.conflict' };
  if (kind === 'validation' || status === 400) return { key: 'analysis.error.validation' };
  return { key: 'analysis.error.unknown' };
}
