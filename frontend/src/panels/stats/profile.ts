/**
 * Vertical profile of one cell (pure port of legacy updateProfile in web/app.js).
 *
 * Values: exact mode uses the API profile (`null` concentration = building → NaN);
 * illustration mode reads the adjusted render codes. The chart geometry is the
 * legacy 320×280 SVG with a log x axis and the height on the y axis.
 */
import type { ProfileResult } from '../../api/types';
import { valueAt, type ColourScale, type DecodedVolume, type Display } from '../../lib/concentration';
import type { Grid } from '../../store/types';

/** Concentration per level k (NaN = building / no data), or null while the exact profile is loading. */
export function profileValues(args: {
  exact: boolean;
  profile: ProfileResult | undefined;
  volume: DecodedVolume;
  grid: Pick<Grid, 'nx' | 'ny' | 'nz'>;
  display: Display;
  i: number;
  j: number;
}): number[] | null {
  const { exact, profile, volume, grid, display, i, j } = args;
  const levels = Array.from({ length: grid.nz }, (_, k) => k);
  if (exact) {
    if (!profile) return null;
    const byK = new Map(profile.levels.map((level) => [level.k, level.concentration_ug_m3]));
    return levels.map((k) => {
      const v = byK.get(k);
      return v === null || v === undefined ? NaN : v;
    });
  }
  return levels.map((k) => valueAt(volume, grid, display, k, j, i));
}

export interface ProfileChart {
  width: number;
  height: number;
  pad: { l: number; r: number; t: number; b: number };
  /** SVG path of the profile line ('' when there is nothing positive to draw). */
  path: string;
  /** Building levels drawn as grey bands. */
  solids: Array<{ y: number; height: number }>;
  thresholds: Array<{ key: string; x: number }>;
  currentY: number;
  /** Decade ticks on the x axis. */
  xTicks: Array<{ x: number; exponent: number }>;
  /** Height ticks (m) on the y axis: 0, half, top. */
  yTicks: Array<{ y: number; value: number }>;
  /** Largest positive value (0 when none). */
  max: number;
}

export function profileChart(args: {
  values: readonly number[];
  zCentres: readonly number[];
  dz: number;
  nz: number;
  scale: ColourScale;
  thresholds: ReadonlyArray<{ key: string; value: number }>;
  layer: number;
}): ProfileChart {
  const { values, zCentres: z, dz, nz, scale, thresholds, layer } = args;
  const width = 320;
  const height = 280;
  const pad = { l: 60, r: 24, t: 20, b: 58 };
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);
  const hi = Math.max(scale.hi, ...finite, ...thresholds.map((t) => t.value)) * 1.2;
  const lo = Math.min(scale.lo, ...(finite.length ? finite : [scale.lo]));
  const X = (v: number) => pad.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (width - pad.l - pad.r);
  const top = nz * dz;
  const Y = (h: number) => height - pad.b - (h / top) * (height - pad.t - pad.b);

  let path = '';
  const solids: ProfileChart['solids'] = [];
  values.forEach((v, k) => {
    if (Number.isNaN(v)) {
      solids.push({ y: Y(z[k] + 1), height: Y(z[k] - 1) - Y(z[k] + 1) });
      return;
    }
    if (v <= 0) return;
    const previous = values[k - 1];
    const cmd = path && previous !== undefined && !Number.isNaN(previous) && previous > 0 ? 'L' : 'M';
    path += `${cmd}${X(v).toFixed(1)},${Y(z[k]).toFixed(1)} `;
  });

  const xTicks: ProfileChart['xTicks'] = [];
  const first = Math.ceil(Math.log10(lo));
  const last = Math.floor(Math.log10(hi));
  const step = Math.max(1, Math.ceil((last - first) / 4));
  for (let e = first; e <= last; e += step) xTicks.push({ x: X(10 ** e), exponent: e });

  return {
    width,
    height,
    pad,
    path: path.trim(),
    solids,
    thresholds: thresholds.map((t) => ({ key: t.key, x: X(t.value) })),
    currentY: Y(z[layer] ?? 0),
    xTicks,
    yTicks: [0, top / 2, top].map((value) => ({ y: Y(value), value })),
    max: Math.max(...finite, 0),
  };
}
