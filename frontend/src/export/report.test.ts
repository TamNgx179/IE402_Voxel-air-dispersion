import { describe, expect, test } from 'vitest';
import { AppError } from '../api/client';
import { translate, type Locale } from '../i18n';
import { initialState } from '../store/reducer';
import type { RunEntry, ViewerState } from '../store/types';
import { buildReport, reportKey, type ReportInput } from './report';

const RUN = '2a3a9f00-0000-4000-8000-000000000000';
const entry: RunEntry = {
  id: RUN,
  scenario_id: 'dry_nov_apr',
  name: 'Dry',
  emission_multiplier: 1,
  wind_from_deg: 112,
  wind_speed_m_s: 1.62,
  model: 'fv',
  model_version: 'entry-version',
  warnings: [],
};

function state(overrides: Partial<ViewerState> = {}): ViewerState {
  return {
    ...initialState,
    bootstrap: {
      status: 'ready',
      error: null,
      data: {
        grid: { dz_m: 2, z_centres_m: [1, 3, 5], nx: 2, ny: 2, nz: 3 },
        provenance: { heights: 'GOB 2.5D' },
        quality: { buildings: 62 },
      } as never,
    },
    runs: [entry],
    selectedRunId: RUN,
    runData: {
      [RUN]: {
        id: RUN,
        volume: { scale: { c_max: 10, decades: 2 } },
        summary: { model_version: 'summary-version', input_hash: 'sha256:abc', layers: [] },
        windField: null,
      } as never,
    },
    layer: 1,
    ...overrides,
  };
}

function input(overrides: Partial<ReportInput> = {}, locale: Locale = 'en'): ReportInput {
  return {
    state: state(),
    locale,
    t: (key, params) => translate(locale, key, params),
    formatNumber: (value) => (value == null ? '' : value.toFixed(2)),
    camera: { longitude: 106.7, latitude: 10.77, zoom: 16, pitch: 45, bearing: 0 },
    attribution: '© OpenStreetMap',
    renderLod: { level: 'lod1', vertices: 1234 },
    drawing: false,
    reducedMotion: false,
    contributions: { metadata: {}, report: {} },
    now: new Date('2026-11-18T08:00:00Z'),
    ...overrides,
  };
}

describe('buildReport', () => {
  test('records the selected run, layer bounds and a stable machine-readable metadata block', () => {
    const report = buildReport(input());
    expect(report.title).toBe('Dry season, Voxel, 2a3a');
    expect(report.metadata).toMatchObject({
      run_id: RUN,
      // The loaded summary wins over the list entry.
      model_version: 'summary-version',
      input_hash: 'sha256:abc',
      z_requested_m: 3,
      z_center_m: 3,
      z_min_m: 2,
      z_max_m: 4,
      units: 'µg/m³',
      exported_at: '2026-11-18T08:00:00.000Z',
      locale: 'en',
      thresholds: [],
      basemap: 'vector',
      selected_cell: null,
      render_lod: { level: 'lod1', facade_vertices: 1234 },
      illustration: { multiplier: 1, background_ug_m3: 0 },
      camera: { zoom: 16, pitch: 45 },
      provenance: { heights: 'GOB 2.5D' },
    });
    expect(report.mode).toBe(translate('en', 'export.modeOriginal'));
    expect(report.attribution).toBe('© OpenStreetMap');
  });

  test('builds a five-label logarithmic legend from the run scale and the six-stop ramp', () => {
    const report = buildReport(input());
    expect(report.legend.stops).toHaveLength(6);
    expect(report.legend.stops![0]).toEqual([0, 'rgb(248,238,211)']);
    // c_max 10 over two decades: 0.1 … 10 µg/m³.
    expect(report.legend.labels).toEqual(['0.10', '0.32', '1.00', '3.16', '10.00']);
  });

  test('marks illustrative display settings as adjusted and scales the legend', () => {
    const report = buildReport(input({ state: state({ display: { multiplier: 2, background: 0 } }) }));
    expect(report.mode).toBe(translate('en', 'export.modeAdjusted'));
    expect(report.metadata.illustration).toEqual({ multiplier: 2, background_ug_m3: 0 });
    expect(report.legend.labels.at(-1)).toBe('20.00');
  });

  test('describes the wind state in the notice', () => {
    const notice = (overrides: Partial<ReportInput>) => buildReport(input(overrides)).notice;
    const wind = (key: Parameters<typeof translate>[1]) => translate('en', 'export.notice', { wind: translate('en', key) });
    expect(notice({})).toBe(wind('export.windMoving'));
    expect(notice({ reducedMotion: true })).toBe(wind('export.windPaused'));
    expect(notice({ state: state({ windPaused: true }) })).toBe(wind('export.windPaused'));
    expect(notice({ state: state({ layers: { ...initialState.layers, wind: false } }) })).toBe(wind('export.windHidden'));
  });

  test('reports zero facade vertices when facades are not drawn and null without a LoD', () => {
    const hidden = state({ layers: { ...initialState.layers, facades: false } });
    expect(buildReport(input({ state: hidden })).metadata.render_lod).toEqual({ level: 'lod1', facade_vertices: 0 });
    expect(buildReport(input({ renderLod: null })).metadata.render_lod).toBeNull();
  });

  test('merges panel contributions and appends the comparison notice', () => {
    const report = buildReport(
      input({
        contributions: {
          metadata: { region: { area_m2: 100 } },
          report: { comparison: { comparison_run_id: 'b' } },
        },
      }),
    );
    expect(report.metadata.region).toEqual({ area_m2: 100 });
    expect(report.comparison).toEqual({ comparison_run_id: 'b' });
    expect(report.notice.endsWith(translate('en', 'export.comparisonNotice'))).toBe(true);
  });

  test('falls back to the default attribution and keeps a copy of the selected cell', () => {
    const cell = { i: 1, j: 0 };
    const report = buildReport(input({ attribution: '', state: state({ selectedCell: cell }) }, 'vi'));
    expect(report.attribution).toBe(translate('vi', 'export.defaultAttribution'));
    expect(report.metadata.selected_cell).toEqual(cell);
    expect(report.metadata.selected_cell).not.toBe(cell);
    expect(report.title).toBe('Mùa khô, Voxel, 2a3a');
  });

  test('refuses to export without a loaded run or while drawing', () => {
    const code = (overrides: Partial<ReportInput>) => {
      try {
        buildReport(input(overrides));
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        return (error as AppError).messageKey;
      }
      return null;
    };
    expect(code({ state: state({ selectedRunId: null }) })).toBe('export.noRun');
    expect(code({ state: state({ runData: {} }) })).toBe('export.noRun');
    expect(code({ state: { ...state(), bootstrap: { status: 'loading', data: null, error: null } } })).toBe('export.noRun');
    expect(code({ drawing: true })).toBe('export.finishDrawing');
  });
});

describe('reportKey', () => {
  test('ignores the export time but changes with the layer and the display mode', () => {
    const base = buildReport(input());
    const later = buildReport(input({ now: new Date('2027-01-01T00:00:00Z') }));
    expect(reportKey(later)).toBe(reportKey(base));
    expect(reportKey(buildReport(input({ state: state({ layer: 2 }) })))).not.toBe(reportKey(base));
    expect(reportKey(buildReport(input({ state: state({ display: { multiplier: 1, background: 5 } }) })))).not.toBe(
      reportKey(base),
    );
  });
});
