/**
 * Vertical-section (transect) helpers: port of the DOM-free parts of
 * web/viewer-transect.js plus the client-checkable limits of the transect service.
 * The API owns the numbers; these helpers only validate input, map distance/z to
 * plot pixels and read back exact API cells (never pixel colours, never interpolated).
 */
import type { TranslationKey, TranslationParams } from '../i18n';
import { color, throwKeyed, validHeightRange } from './analysis';

export const TRANSECT_MIN_POINTS = 2;
export const TRANSECT_MAX_POINTS = 100;
/** Server cap on returned cells (positions × layers). */
export const TRANSECT_MAX_SAMPLES = 20000;

export type LngLat = [number, number];

export interface TransectLine {
  type: 'LineString';
  coordinates: number[][];
}

export type TransectCellStatus = 'air' | 'solid' | 'no_data';

export interface TransectCell {
  k: number;
  status: TransectCellStatus;
  concentration_ug_m3: number | null;
}

export interface TransectSample {
  distance_m: number;
  i: number;
  j: number;
  cells: TransectCell[];
}

export interface TransectLayer {
  k: number;
  z_center_m: number;
  overlap_min_m: number;
  overlap_max_m: number;
}

export interface TransectResult {
  run_id: string;
  length_m: number;
  z_min_m: number;
  z_max_m: number;
  units: string;
  layers: TransectLayer[];
  samples: TransectSample[];
}

export interface TransectRequest {
  line: TransectLine;
  z_min_m: number;
  z_max_m: number;
}

// ---------------------------------------------------------------- drawing

export type AddPointResult =
  | { status: 'added'; points: LngLat[] }
  | { status: 'duplicate'; points: LngLat[] }
  | { status: 'full'; points: LngLat[] };

/**
 * Appends a clicked point (immutably). A point equal to the previous one is ignored;
 * at `TRANSECT_MAX_POINTS` the point is refused (show 'analysis.transect.maxPoints').
 */
export function addTransectPoint(points: readonly LngLat[], point: LngLat): AddPointResult {
  if (points.length >= TRANSECT_MAX_POINTS) return { status: 'full', points: [...points] };
  const last = points[points.length - 1];
  if (last && point[0] === last[0] && point[1] === last[1]) return { status: 'duplicate', points: [...points] };
  return { status: 'added', points: [...points, [point[0], point[1]]] };
}

export function canFinishTransect(points: readonly LngLat[]): boolean {
  return points.length >= TRANSECT_MIN_POINTS;
}

/** GeoJSON LineString with copied coordinates, or null when fewer than 2 points. */
export function transectLine(points: readonly LngLat[]): TransectLine | null {
  return canFinishTransect(points) ? { type: 'LineString', coordinates: points.map((p) => [...p]) } : null;
}

// ---------------------------------------------------------------- request & sampling rules

export interface TransectRequestInput {
  line: TransectLine | null;
  runId: string | null | undefined;
  modified: boolean;
  min: string | number;
  max: string | number;
  /** Model domain height (m). */
  height: number;
}

/** Quick UX validation; the server re-checks every limit and the geometry. */
export function transectRequest(input: TransectRequestInput): TransectRequest {
  if (!input.line) return throwKeyed('analysis.transect.noLine');
  if (!input.runId) throwKeyed('analysis.transect.noRun');
  if (input.modified) throwKeyed('analysis.transect.modified');
  if (!validHeightRange(input.min, input.max, input.height))
    throwKeyed('analysis.transect.heightRange', { max: input.height });
  return { line: input.line, z_min_m: Number(input.min), z_max_m: Number(input.max) };
}

/** Default and maximum sampling step: the finer horizontal cell size. */
export function maxStep(grid: { dx_m: number; dy_m: number }): number {
  return Math.min(grid.dx_m, grid.dy_m);
}

export function validStep(step: number, grid: { dx_m: number; dy_m: number }): boolean {
  return Number.isFinite(step) && step > 0 && step <= maxStep(grid);
}

/** Vertical layers touched by `[zMin, zMax)` (partial overlaps included). */
export function layerSpan(zMin: number, zMax: number, dz: number): { first: number; last: number; count: number } {
  const first = Math.floor(zMin / dz),
    last = Math.ceil(zMax / dz) - 1;
  return { first, last, count: last - first + 1 };
}

/** Cells the server would return (positions × layers), for the 20 000 cap. */
export function transectSampleCount(lengthM: number, stepM: number, zMin: number, zMax: number, dz: number): number {
  return (Math.ceil(lengthM / stepM) + 1) * layerSpan(zMin, zMax, dz).count;
}

// ---------------------------------------------------------------- reading cells

export interface TransectReading {
  distanceM: number;
  zCenterM: number;
  i: number;
  j: number;
  k: number;
  status: TransectCellStatus;
  concentration: number | null;
}

/** Exact API cell at (sample, layer); keeps C=0, buildings and missing data distinct. */
export function selectedReading(result: TransectResult, position: number, layer: number): TransectReading {
  const sample = result.samples[position],
    cell = sample.cells[layer],
    z = result.layers[layer];
  return {
    distanceM: sample.distance_m,
    zCenterM: z.z_center_m,
    i: sample.i,
    j: sample.j,
    k: cell.k,
    status: cell.status,
    concentration: cell.concentration_ug_m3,
  };
}

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/** The legacy reading sentence, localised. `format` formats numbers (legacy: 5 significant digits). */
export function readingText(reading: TransectReading, t: Translate, format: (value: number) => string): string {
  const value =
    reading.status === 'solid'
      ? t('analysis.transect.readingSolid')
      : reading.status === 'no_data'
        ? t('analysis.transect.readingNoData')
        : t('analysis.transect.readingAir', { value: format(Number(reading.concentration)) });
  return t('analysis.transect.reading', {
    distance: format(reading.distanceM),
    z: format(reading.zCenterM),
    i: reading.i,
    j: reading.j,
    k: reading.k,
    reading: value,
  });
}

/** True when at least one cell is air (otherwise show the "no air samples" note). */
export function hasAir(result: TransectResult): boolean {
  return result.samples.some((s) => s.cells.some((c) => c.status === 'air'));
}

/** Highest air concentration (≥ 0); the colour scale is linear from 0 to this. */
export function transectMax(result: TransectResult): number {
  return result.samples.reduce(
    (m, s) => s.cells.reduce((n, c) => (c.status === 'air' ? Math.max(n, Number(c.concentration_ug_m3)) : n), m),
    0,
  );
}

// ---------------------------------------------------------------- chart geometry

export const SOLID_FILL = '#929fa9';
export const NO_DATA_FILL = '#ffffff';
export const NO_DATA_STROKE = '#cbd5db';
export const SELECTION_STROKE = '#173e55';

/** Canvas fill for a cell: buildings gray, missing data white (outlined), air on the 0→max ramp. */
export function cellFill(cell: TransectCell, max: number): string {
  if (cell.status === 'solid') return SOLID_FILL;
  if (cell.status === 'no_data') return NO_DATA_FILL;
  return `rgb(${color(cell.concentration_ug_m3, 0, max).slice(0, 3).join(',')})`;
}

export const PLOT_HEIGHT = 250;
export const PLOT_MIN_WIDTH = 280;

export interface PlotBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Plot frame for a canvas of CSS width `width`. */
export function plotBox(width: number): PlotBox {
  const w = Math.max(PLOT_MIN_WIDTH, width),
    height = PLOT_HEIGHT;
  return { width: w, height, left: 52, right: w - 16, top: 18, bottom: height - 38 };
}

/** Distance (m) → x pixel. */
export function xScale(result: Pick<TransectResult, 'length_m'>, box: PlotBox): (d: number) => number {
  return (d) => box.left + (d / result.length_m) * (box.right - box.left);
}

/** Altitude (m) → y pixel. */
export function yScale(result: Pick<TransectResult, 'z_min_m' | 'z_max_m'>, box: PlotBox): (z: number) => number {
  return (z) => box.bottom - ((z - result.z_min_m) / (result.z_max_m - result.z_min_m)) * (box.bottom - box.top);
}

/**
 * Distance span drawn for sample `n`: to the midpoints with its neighbours (the
 * first/last reach the line ends). A display symbol, not a new voxel.
 */
export function sampleSpan(result: Pick<TransectResult, 'samples' | 'length_m'>, n: number): [number, number] {
  const s = result.samples;
  const lo = n === 0 ? 0 : (s[n - 1].distance_m + s[n].distance_m) / 2;
  const hi = n === s.length - 1 ? result.length_m : (s[n].distance_m + s[n + 1].distance_m) / 2;
  return [lo, hi];
}

/** Five evenly spaced axis ticks: altitude (y) and distance (x). */
export function axisTicks(result: Pick<TransectResult, 'z_min_m' | 'z_max_m' | 'length_m'>): {
  z: number[];
  d: number[];
} {
  const z: number[] = [],
    d: number[] = [];
  for (let n = 0; n <= 4; n++) {
    z.push(result.z_min_m + (n * (result.z_max_m - result.z_min_m)) / 4);
    d.push((n * result.length_m) / 4);
  }
  return { z, d };
}

export interface Selection {
  position: number;
  layer: number;
}

/**
 * Cell under a plot click (px/py relative to the canvas): nearest sample, and the
 * layer whose half-open [overlap_min, overlap_max) contains z. The exact top border
 * reads the last visible layer. Null outside the frame or between layers.
 */
export function pickCell(result: TransectResult, box: PlotBox, px: number, py: number): Selection | null {
  if (px < box.left || px > box.right || py < box.top || py > box.bottom) return null;
  const d = ((px - box.left) / (box.right - box.left)) * result.length_m,
    z = result.z_min_m + ((box.bottom - py) / (box.bottom - box.top)) * (result.z_max_m - result.z_min_m);
  const position = result.samples.reduce(
    (best, s, n) => (Math.abs(s.distance_m - d) < Math.abs(result.samples[best].distance_m - d) ? n : best),
    0,
  );
  const layer =
    z === result.z_max_m
      ? result.layers.length - 1
      : result.layers.findIndex((l) => z >= l.overlap_min_m && z < l.overlap_max_m);
  if (layer < 0) return null;
  return { position, layer };
}

export const SELECTION_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'] as const;

/** Keyboard navigation over cells; null when the key is not a navigation key. */
export function moveSelection(result: TransectResult, selection: Selection, key: string): Selection | null {
  if (!(SELECTION_KEYS as readonly string[]).includes(key)) return null;
  let { position, layer } = selection;
  if (key === 'ArrowLeft') position = Math.max(0, position - 1);
  if (key === 'ArrowRight') position = Math.min(result.samples.length - 1, position + 1);
  if (key === 'ArrowUp') layer = Math.min(result.layers.length - 1, layer + 1);
  if (key === 'ArrowDown') layer = Math.max(0, layer - 1);
  if (key === 'Home') position = 0;
  if (key === 'End') position = result.samples.length - 1;
  return { position, layer };
}

/** Download name of the transect CSV (legacy `transect-<run>.csv`). */
export function transectCsvFilename(runId: string): string {
  return `transect-${runId}.csv`;
}
