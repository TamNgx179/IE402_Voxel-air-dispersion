import { describe, expect, it } from 'vitest';
import { AppError } from '../api/client';
import { translate } from '../i18n';
import {
  COMPARISON_CSV_COLUMNS,
  LAYER_CSV_COLUMNS,
  analysisCsvFilename,
  comparisonCsv,
  comparisonLegend,
  csv,
  exportFilename,
  layerCsv,
  png,
  wrapText,
} from './export';

/** Minimal RFC 4180 parser (quoted fields, "" escapes, CRLF rows) for assertions. */
function parse(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let n = 0; n < text.length; n++) {
    const c = text[n];
    if (quoted) {
      if (c === '"' && text[n + 1] === '"') {
        field += '"';
        n++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[n + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      n++;
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}
function records(text: string): Array<Record<string, string>> {
  const [header, ...body] = parse(text);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

describe('csv', () => {
  it('quotes metadata and formulas while preserving numerical zero, negatives and null', () => {
    const data = parse(csv([['=formula', 'a,b', 'a"b', 'a\nb', 0, -0.125, null, ' -danger']]));
    expect(data[0]).toEqual(["'=formula", 'a,b', 'a"b', 'a\nb', '0', '-0.125', '', "' -danger"]);
  });
  it('is byte-identical to the legacy encoding (quoted values, empty null, CRLF)', () => {
    expect(csv([['a', 1], [undefined, '+x']])).toBe('"a","1"\r\n,"\'+x"\r\n');
  });
});

describe('layerCsv', () => {
  it('keeps the actual source preset separately from concentration values', () => {
    const report = {
      metadata: { run_id: 'r', model_version: 'v', input_hash: 'h' },
      summary: {
        emission_multiplier: 0.8,
        grid: { dz_m: 2 },
        units: 'ug m-3',
        layers: [{ z_m: 1, mean_ug_m3: 0, max_ug_m3: 0, air_cells: 1 }],
      },
    };
    const [layer] = records(layerCsv(report as unknown as Parameters<typeof layerCsv>[0]));
    expect(layer.emission_multiplier).toBe('0.8');
    expect(layer.mean_ug_m3).toBe('0');
  });
  it('uses the summary z_m contract, exact numbers and grid intervals', () => {
    const report = {
      metadata: { run_id: 'r', model_version: 'v', input_hash: 'h' },
      summary: {
        grid: { dz_m: 2 },
        units: 'ug m-3',
        layers: [{ z_m: 1, mean_ug_m3: 0.12494000047445297, max_ug_m3: null, air_cells: 8 }],
      },
    };
    const text = layerCsv(report as unknown as Parameters<typeof layerCsv>[0]);
    expect(parse(text)[0]).toEqual([...LAYER_CSV_COLUMNS]);
    const [row] = records(text);
    expect(row.z_center_m).toBe('1');
    expect(row.z_min_m).toBe('0');
    expect(row.z_max_m).toBe('2');
    expect(row.emission_multiplier).toBe('1');
    expect(Number(row.mean_ug_m3)).toBe(0.12494000047445297);
    expect(row.max_ug_m3).toBe('');
    expect(row.units).toBe('ug m-3');
  });
});

describe('comparisonCsv', () => {
  it('keeps both source presets and defaults missing multipliers to 1', () => {
    const pair = {
      baseline_emission_multiplier: 1,
      comparison_emission_multiplier: 0.6,
      units: 'ug m-3',
      feature_collection: {
        features: [{ properties: { i: 0, j: 0, baseline_ug_m3: 5, comparison_ug_m3: 3, delta_ug_m3: -2 } }],
      },
    };
    const [row] = records(comparisonCsv(pair));
    expect(row.baseline_emission_multiplier).toBe('1');
    expect(row.comparison_emission_multiplier).toBe('0.6');
    expect(row.delta_ug_m3).toBe('-2');
    const [defaults] = records(comparisonCsv({ ...pair, comparison_emission_multiplier: null }));
    expect(defaults.comparison_emission_multiplier).toBe('1');
  });
  it('preserves signed delta and provenance for both runs with the legacy header', () => {
    const data = {
      baseline_run_id: 'a',
      comparison_run_id: 'b',
      baseline_version: 'v1',
      comparison_version: 'v2',
      baseline_input_hash: 'h1',
      comparison_input_hash: 'h2',
      requested_z_m: 1.5,
      z_center_m: 1,
      units: 'ug m-3',
      feature_collection: {
        features: [{ properties: { i: 1, j: 2, baseline_ug_m3: 2, comparison_ug_m3: 1, delta_ug_m3: -1 } }],
      },
    };
    const text = comparisonCsv(data);
    expect(text.split('\r\n')[0]).toBe(COMPARISON_CSV_COLUMNS.map((c) => `"${c}"`).join(','));
    const [row] = records(text);
    expect(row.delta_ug_m3).toBe('-1');
    expect(row.comparison_input_hash).toBe('h2');
    expect(row.requested_z_m).toBe('1.5');
    expect(row.i).toBe('1');
    expect(row.j).toBe('2');
  });
});

describe('comparisonLegend', () => {
  it('does not label an empty comparison as a measured zero delta', () => {
    const empty = {
      feature_collection: { features: [] },
      stats: { air_cells: 0, delta: { min_ug_m3: null, max_ug_m3: null } },
    };
    const legend = comparisonLegend(empty, 'delta', String);
    expect(translate('vi', legend.titleKey)).toMatch(/Không có dữ liệu/);
    expect(translate('vi', legend.categories![0].labelKey)).not.toMatch(/bằng 0|trùng nhau/);
    expect(legend.labels).toEqual([]);
    const zero = {
      feature_collection: { features: [{ properties: { baseline_ug_m3: 0, comparison_ug_m3: 0 } }] },
      stats: { air_cells: 1, delta: { min_ug_m3: 0, max_ug_m3: 0 } },
    };
    const zeroLegend = comparisonLegend(zero, 'delta', String);
    expect(translate('vi', zeroLegend.titleKey)).toMatch(/bằng 0/);
    expect(zeroLegend.categories![0].color).toBe('#f5f2e8');
  });
  it('uses a symmetric delta scale and a shared concentration scale', () => {
    const data = {
      feature_collection: {
        features: [
          { properties: { baseline_ug_m3: 2, comparison_ug_m3: 5 } },
          { properties: { baseline_ug_m3: null, comparison_ug_m3: 1 } },
        ],
      },
      stats: { air_cells: 2, delta: { min_ug_m3: -1, max_ug_m3: 3 } },
    };
    expect(comparisonLegend(data, 'delta', String)).toEqual({
      titleKey: 'analysis.legend.deltaTitle',
      stops: [
        [0, '#4b6f8c'],
        [0.5, '#f5f2e8'],
        [1, '#9d534e'],
      ],
      labels: ['-3', '0', '3'],
    });
    expect(comparisonLegend(data, 'comparison', String)).toEqual({
      titleKey: 'analysis.legend.concentrationTitle',
      stops: [
        [0, '#f8eed3'],
        [1, '#703541'],
      ],
      labels: ['0', '5'],
    });
  });
});

describe('file names', () => {
  it('follows the legacy export naming', () => {
    expect(exportFilename({ kind: 'csv', runId: 'r', zCenterM: 1 })).toBe('pm25-r-layers.csv');
    expect(exportFilename({ kind: 'png', runId: 'r', zCenterM: 1 })).toBe('pm25-r-1m.png');
    expect(exportFilename({ kind: 'json', runId: 'r', zCenterM: 1.5 })).toBe('pm25-r-1.5m.json');
    expect(exportFilename({ kind: 'csv', runId: 'r', zCenterM: 1, comparisonRunId: 'o', view: 'delta' })).toBe(
      'pm25-r-vs-o-1m-delta.csv',
    );
    expect(analysisCsvFilename('region', 'r')).toBe('region-r.csv');
    expect(analysisCsvFilename('road-corridor', 'r')).toBe('road-corridor-r.csv');
    expect(analysisCsvFilename('transect', 'r')).toBe('transect-r.csv');
  });
});

describe('wrapText', () => {
  it('wraps by character width like the report footer', () => {
    expect(wrapText('abcdef', 21, (s) => s.length * 7)).toEqual(['abc', 'def']);
    expect(wrapText('', 21, (s) => s.length * 7)).toEqual(['']);
  });
});

describe('png', () => {
  it('reports null blobs and cross-origin failures rather than success', async () => {
    await expect(png({ toBlob: (fn: BlobCallback) => fn(null) })).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.messageKey === 'analysis.export.pngFailed',
    );
    await expect(
      png({
        toBlob() {
          throw new Error('SecurityError');
        },
      }),
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.messageKey === 'analysis.export.pngCors');
    expect(translate('vi', 'analysis.export.pngCors')).toMatch(/CORS/);
    const blob = new Blob(['x']);
    await expect(png({ toBlob: (fn: BlobCallback) => fn(blob) })).resolves.toBe(blob);
  });
});
