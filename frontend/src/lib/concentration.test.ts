import { describe, expect, test } from 'vitest';
import {
  activeThresholds,
  buildLut,
  cellColour,
  colourScale,
  decodeVolume,
  domainExceedance,
  layerStats,
  legendValues,
  position,
  ramp,
  valueAt,
} from './concentration';
import { csv, layerCsv } from './export';
import { runLabel } from './labels';
import { translate } from '../i18n';

const scale = { c_max: 100, decades: 4, levels: 254, first_code: 2 };

function volume(codes: number[]) {
  const bytes = String.fromCharCode(...codes);
  return decodeVolume({ codes_base64: btoa(bytes), scale });
}

describe('concentration decoding', () => {
  test('code 0 is solid (NaN), 1 is zero, first and last codes span the log range', () => {
    const lut = buildLut(scale);
    expect(Number.isNaN(lut[0])).toBe(true);
    expect(lut[1]).toBe(0);
    expect(lut[2]).toBeCloseTo(0.01, 12);
    expect(lut[256 - 1]).toBeCloseTo(10 ** (Math.log10(100) - 4 + (253 / 254) * 4), 9);
    expect(buildLut({ ...scale, c_max: 0 })[5]).toBe(0);
  });

  test('display adjustment applies k·C + background and keeps solids NaN', () => {
    const v = volume([0, 1, 2, 255]);
    const grid = { nx: 2, ny: 2 };
    expect(Number.isNaN(valueAt(v, grid, { multiplier: 10, background: 5 }, 0, 0, 0))).toBe(true);
    expect(valueAt(v, grid, { multiplier: 10, background: 5 }, 0, 0, 1)).toBe(5);
    expect(valueAt(v, grid, { multiplier: 1, background: 0 }, 0, 1, 0)).toBeCloseTo(0.01, 12);
  });

  test('colour scale spans the decades above the background', () => {
    expect(colourScale(scale, { multiplier: 1, background: 0 })).toEqual({ lo: 0.01, hi: 100 });
    expect(colourScale(scale, { multiplier: 1, background: 50 })).toEqual({ lo: 50, hi: 150 });
    expect(colourScale(null, { multiplier: 1, background: 0 })).toEqual({ lo: 0.0001, hi: 1 });
    const s = colourScale(scale, { multiplier: 1, background: 0 });
    expect(legendValues(s).map((x) => Number(x.toPrecision(6)))).toEqual([0.01, 0.1, 1, 10, 100]);
    expect(position(1, s)).toBeCloseTo(0.5, 12);
  });

  test('ramp endpoints and interpolation', () => {
    expect(ramp(-1)).toEqual([248, 238, 211]);
    expect(ramp(2)).toEqual([112, 53, 65]);
    expect(ramp(0.1)).toEqual([243, 226, 187]);
  });

  test('cell colours: transparent for solid/zero, strict threshold wins, faded below', () => {
    const s = { lo: 0.01, hi: 100 };
    expect(cellColour(NaN, s, [])).toEqual([0, 0, 0, 0]);
    expect(cellColour(0, s, [])).toEqual([0, 0, 0, 0]);
    expect(cellColour(0.001, s, [])[3]).toBe(60);
    expect(cellColour(1, s, [])[3]).toBe(215);
    const thresholds = activeThresholds(
      { who_24h: { value: 15, label: 'WHO' }, qcvn_24h: { value: 50, label: 'QCVN' } },
      { who_24h: true, qcvn_24h: true },
    );
    expect(thresholds.map((t) => t.key)).toEqual(['qcvn_24h', 'who_24h']);
    expect(cellColour(60, s, thresholds)).toEqual([165, 102, 92, 235]);
    expect(cellColour(20, s, thresholds)).toEqual([174, 146, 91, 235]);
    expect(cellColour(10, s, thresholds)[3]).toBe(70);
  });

  test('layer statistics: exact from summary, adjusted from codes', () => {
    const v = volume([0, 1, 2, 255]);
    const grid = { nx: 2, ny: 2, dx_m: 5, dy_m: 5, dz_m: 2 };
    const summary = {
      layers: [{ k: 0, z_m: 1, air_cells: 3, mean_ug_m3: 30, max_ug_m3: 90 }],
      thresholds: [{ key: 'who_24h', label: 'WHO', value_ug_m3: 15, exceedance_volume_m3: 50 }],
    };
    const thresholds = { who_24h: { value: 15 } };
    const exact = layerStats({ volume: v, summary, grid, thresholds, display: { multiplier: 1, background: 0 }, k: 0, exactAreas: { who_24h: 25 } });
    expect(exact).toEqual({ air: 3, max: 90, mean: 30, area: { who_24h: 25 } });
    const adjusted = layerStats({ volume: v, summary, grid, thresholds, display: { multiplier: 2, background: 1 }, k: 0 });
    expect(adjusted.air).toBe(3);
    expect(adjusted.mean).toBe(61);
    expect(adjusted.area).toEqual({ who_24h: 25 });
    expect(domainExceedance({ volume: v, summary, grid, thresholds, display: { multiplier: 1, background: 0 } })).toEqual({ who_24h: 50 });
    expect(domainExceedance({ volume: v, summary, grid, thresholds, display: { multiplier: 2, background: 1 } })).toEqual({ who_24h: 50 });
  });
});

describe('exports keep stable machine-readable names', () => {
  test('CSV quoting and formula-injection guard', () => {
    expect(csv([['a', 1, null, '=SUM(A1)', 'say "hi"']])).toBe('"a","1",,"\'=SUM(A1)","say ""hi"""\r\n');
  });

  test('layer CSV columns and units are not localised', () => {
    const text = layerCsv({
      metadata: { run_id: 'r', model_version: 'v', input_hash: 'h' },
      summary: {
        layers: [{ k: 0, z_m: 1, air_cells: 3, mean_ug_m3: 30, max_ug_m3: null }],
        grid: { origin_x_m: 0, origin_y_m: 0, dx_m: 5, dy_m: 5, dz_m: 2, nx: 1, ny: 1, nz: 1 },
        units: 'ug m-3',
        emission_multiplier: 0.8,
      },
    });
    expect(text.split('\r\n')[0]).toBe(
      '"run_id","model_version","input_hash","emission_multiplier","z_min_m","z_max_m","z_center_m","mean_ug_m3","max_ug_m3","air_cells","units"',
    );
    expect(text.split('\r\n')[1]).toBe('"r","v","h","0.8","0","2","1","30",,"3","ug m-3"');
  });
});

describe('run labels', () => {
  test('season names and kinds are localised; id suffix is not', () => {
    const entry = {
      id: '2a3ab50e-x',
      scenario_id: 'dry_nov_apr_2024',
      name: 'Dry',
      emission_multiplier: 0.8,
      wind_from_deg: 0,
      wind_speed_m_s: 1,
      model: 'fv',
      model_version: null,
      warnings: [],
    };
    expect(runLabel(entry, (k, p) => translate('en', k, p))).toBe('Dry season · Voxel · Reduced 20% · 2a3a');
    expect(runLabel(entry, (k, p) => translate('vi', k, p))).toBe('Mùa khô · Voxel · Giảm 20% · 2a3a');
    expect(runLabel({ ...entry, emission_multiplier: 1, warnings: ['mock run'] }, (k, p) => translate('vi', k, p))).toBe(
      'Mùa khô · Dữ liệu thử · 2a3a',
    );
    expect(runLabel({ ...entry, scenario_id: 'custom', model: 'gaussian', emission_multiplier: 1 }, (k, p) => translate('en', k, p))).toBe(
      'Dry · Gaussian · 2a3a',
    );
  });
});
