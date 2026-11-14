/**
 * Concentration decoding, colour ramp and layer statistics (pure parts of web/app.js).
 *
 * Volume codes are uint8, [z, y, x] C order: index = (k * ny + j) * nx + i.
 * Code 0 = solid (NaN), 1 = zero, codes >= first_code are log-spaced up to c_max.
 * Display adjustment: C = multiplier * C_model + background; NaN (a building) stays NaN.
 */
import type { GridSpec, RunSummary, VolumePayload, VolumeScale } from '../api/types';

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

/** Sequential ramp: light cream (low) to dark wine (high). Relative log colours, NOT AQI categories. */
export const RAMP: ReadonlyArray<readonly [number, RGB]> = [
  [0.0, [248, 238, 211]],
  [0.2, [237, 213, 163]],
  [0.4, [216, 175, 122]],
  [0.6, [194, 132, 95]],
  [0.8, [159, 88, 77]],
  [1.0, [112, 53, 65]],
];

export const THRESHOLD_COLOURS: Record<string, RGB> = {
  qcvn_24h: [165, 102, 92],
  who_24h: [174, 146, 91],
};
export const DEFAULT_THRESHOLD_COLOUR: RGB = [103, 114, 106];

export function thresholdColour(key: string): RGB {
  return THRESHOLD_COLOURS[key] || DEFAULT_THRESHOLD_COLOUR;
}

/** Decoded volume of one run. Immutable after decode. */
export interface DecodedVolume {
  codes: Uint8Array;
  lut: Float64Array;
  scale: VolumeScale;
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const codes = new Uint8Array(binary.length);
  for (let n = 0; n < binary.length; n += 1) codes[n] = binary.charCodeAt(n);
  return codes;
}

export function buildLut(scale: VolumeScale): Float64Array {
  const { c_max: cMax, decades, levels, first_code: first } = scale;
  const lut = new Float64Array(256);
  lut[0] = NaN;
  lut[1] = 0;
  const logMin = Math.log10(cMax) - decades;
  for (let code = first; code < 256; code += 1) {
    lut[code] = cMax > 0 ? 10 ** (logMin + ((code - first) / levels) * decades) : 0;
  }
  return lut;
}

export function decodeVolume(payload: Pick<VolumePayload, 'codes_base64' | 'scale'>): DecodedVolume {
  return { codes: decodeBase64(payload.codes_base64), lut: buildLut(payload.scale), scale: payload.scale };
}

export interface Display {
  multiplier: number;
  background: number;
}

export function isExact(display: Display): boolean {
  return display.multiplier === 1 && display.background === 0;
}

export function effective(raw: number, display: Display): number {
  return Number.isNaN(raw) ? NaN : display.multiplier * raw + display.background;
}

export function valueAt(
  volume: DecodedVolume,
  grid: Pick<GridSpec, 'nx' | 'ny'>,
  display: Display,
  k: number,
  j: number,
  i: number,
): number {
  return effective(volume.lut[volume.codes[(k * grid.ny + j) * grid.nx + i]], display);
}

export interface ColourScale {
  lo: number;
  hi: number;
}

export function colourScale(scale: VolumeScale | null | undefined, display: Display): ColourScale {
  const cMax = scale?.c_max || 1;
  const decades = scale?.decades || 4;
  const hi = display.multiplier * cMax + display.background;
  let lo = Math.max(hi / 10 ** decades, display.background);
  if (!(lo < hi)) lo = hi / 10;
  return { lo, hi };
}

export function ramp(t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let n = 1; n < RAMP.length; n += 1) {
    if (x <= RAMP[n][0]) {
      const [x0, c0] = RAMP[n - 1];
      const [x1, c1] = RAMP[n];
      const f = (x - x0) / (x1 - x0);
      return c0.map((v, m) => Math.round(v + f * (c1[m] - v))) as RGB;
    }
  }
  return [...RAMP[RAMP.length - 1][1]] as RGB;
}

export function position(v: number, scale: ColourScale): number {
  return (Math.log10(v) - Math.log10(scale.lo)) / (Math.log10(scale.hi) - Math.log10(scale.lo));
}

/** Five legend values at 0, 25, 50, 75, 100 % of the log scale. */
export function legendValues(scale: ColourScale): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map(
    (t) => 10 ** (Math.log10(scale.lo) + t * (Math.log10(scale.hi) - Math.log10(scale.lo))),
  );
}

/** CSS linear-gradient stop list for the ramp. */
export function rampGradient(): string {
  return RAMP.map(([t, c]) => `rgb(${c.join(',')}) ${t * 100}%`).join(', ');
}

export interface ActiveThreshold {
  key: string;
  value: number;
  label: string;
}

/**
 * Enabled thresholds sorted by value descending, so the stricter colour wins
 * where several are exceeded (legacy activeThresholds).
 */
export function activeThresholds(
  thresholds: Record<string, { value: number; label: string }>,
  enabled: Record<string, boolean>,
): ActiveThreshold[] {
  return Object.keys(thresholds)
    .filter((key) => enabled[key])
    .map((key) => ({ key, ...thresholds[key] }))
    .sort((a, b) => b.value - a.value);
}

/** Fill colour for one cell value (legacy cellColour). */
export function cellColour(v: number, scale: ColourScale, thresholds: readonly ActiveThreshold[]): RGBA {
  if (Number.isNaN(v) || v <= 0) return [0, 0, 0, 0];
  if (thresholds.length) {
    const hit = thresholds.find((t) => v > t.value);
    if (hit) return [...thresholdColour(hit.key), 235];
    return [...ramp(position(v, scale)), 70];
  }
  if (v < scale.lo) return [...ramp(0), 60];
  return [...ramp(position(v, scale)), 215];
}

export interface LayerStats {
  air: number;
  max: number;
  mean: number;
  /** Exceedance area (m²) per threshold key; missing key = not loaded yet. */
  area: Record<string, number>;
}

/**
 * Statistics of one layer. In exact mode they come from the API summary and the
 * exceedance query (`exactAreas`); otherwise they are recomputed from the adjusted
 * render codes (legacy layerStats).
 */
export function layerStats(args: {
  volume: DecodedVolume;
  summary: Pick<RunSummary, 'layers'>;
  grid: Pick<GridSpec, 'nx' | 'ny' | 'dx_m' | 'dy_m'>;
  thresholds: Record<string, { value: number }>;
  display: Display;
  k: number;
  exactAreas?: Record<string, number>;
}): LayerStats {
  const { volume, summary, grid, thresholds, display, k } = args;
  if (isExact(display)) {
    const layer = summary.layers.find((item) => item.k === k);
    return {
      air: layer?.air_cells || 0,
      max: layer?.max_ug_m3 ?? NaN,
      mean: layer?.mean_ug_m3 ?? NaN,
      area: args.exactAreas || {},
    };
  }
  let air = 0;
  let max = -Infinity;
  const above: Record<string, number> = {};
  Object.keys(thresholds).forEach((key) => (above[key] = 0));
  for (let j = 0; j < grid.ny; j += 1) {
    for (let i = 0; i < grid.nx; i += 1) {
      const v = valueAt(volume, grid, display, k, j, i);
      if (Number.isNaN(v)) continue;
      air += 1;
      if (v > max) max = v;
      Object.entries(thresholds).forEach(([key, t]) => {
        if (v > t.value) above[key] += 1;
      });
    }
  }
  const rawMean = summary.layers.find((layer) => layer.k === k)?.mean_ug_m3 ?? null;
  const mean = rawMean === null ? NaN : display.multiplier * rawMean + display.background;
  const area: Record<string, number> = {};
  Object.keys(above).forEach((key) => (area[key] = above[key] * grid.dx_m * grid.dy_m));
  return { air, max, mean, area };
}

/** Whole-domain exceedance volume (m³) per threshold (legacy domainExceedance). */
export function domainExceedance(args: {
  volume: DecodedVolume;
  summary: Pick<RunSummary, 'thresholds'>;
  grid: Pick<GridSpec, 'dx_m' | 'dy_m' | 'dz_m'>;
  thresholds: Record<string, { value: number }>;
  display: Display;
}): Record<string, number> {
  const { volume, summary, grid, thresholds, display } = args;
  const result: Record<string, number> = {};
  const cellVolume = grid.dx_m * grid.dy_m * grid.dz_m;
  for (const [name, t] of Object.entries(thresholds)) {
    if (isExact(display)) {
      result[name] = summary.thresholds.find((item) => item.key === name)?.exceedance_volume_m3 ?? 0;
      continue;
    }
    let count = 0;
    for (let n = 0; n < volume.codes.length; n += 1) if (effective(volume.lut[volume.codes[n]], display) > t.value) count += 1;
    result[name] = count * cellVolume;
  }
  return result;
}
