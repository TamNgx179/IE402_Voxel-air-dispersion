/**
 * Report snapshot shared by PNG/CSV/JSON exports (port of reportSnapshot in web/app.js).
 * `metadata` keys and units are a stable machine-readable contract; only `title`,
 * `mode`, `notice` and `legend` text follow the UI language.
 */
import { AppError } from '../api/client';
import type { RunSummary } from '../api/types';
import type { Locale, TranslationKey, TranslationParams } from '../i18n';
import { RAMP, activeThresholds, colourScale, legendValues, thresholdColour } from '../lib/concentration';
import { runLabel } from '../lib/labels';
import { selectCurrentEntry, selectCurrentRun, selectExact } from '../store/selectors';
import type { ViewerState } from '../store/types';

export interface Camera {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface ReportLegend {
  title: string;
  stops?: Array<[number, string]>;
  categories?: Array<{ label: string; color: string }>;
  labels: string[];
}

export interface Report {
  title: string;
  summary: RunSummary;
  mode: string;
  metadata: Record<string, unknown> & {
    run_id: string;
    model_version: string | null;
    input_hash: string | null;
    z_center_m: number;
    exported_at: string;
  };
  attribution: string;
  notice: string;
  legend: ReportLegend;
  [key: string]: unknown;
}

export interface ReportInput {
  state: ViewerState;
  locale: Locale;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatNumber: (value: number | null | undefined) => string;
  camera: Camera;
  attribution: string;
  renderLod: { level: string; vertices: number } | null;
  drawing: boolean;
  reducedMotion: boolean;
  /** Contributed values: metadata[key] / report[key]. */
  contributions: { metadata: Record<string, unknown>; report: Record<string, unknown> };
  now?: Date;
}

export function buildReport(input: ReportInput): Report {
  const { state, t, formatNumber } = input;
  const bootstrap = state.bootstrap.data;
  const run = selectCurrentRun(state);
  const entry = selectCurrentEntry(state);
  if (!bootstrap || !run || !entry) throw new AppError('export.noRun');
  if (input.drawing) throw new AppError('export.finishDrawing');
  const grid = bootstrap.grid;
  const z = grid.z_centres_m[state.layer];
  const exact = selectExact(state);
  const thresholds = activeThresholds(bootstrap.thresholds, state.thresholdsEnabled);
  const windText = !state.layers.wind
    ? t('export.windHidden')
    : state.windPaused || input.reducedMotion
      ? t('export.windPaused')
      : t('export.windMoving');
  const scale = colourScale(run.volume.scale, state.display);
  const report: Report = {
    title: runLabel(entry, t),
    summary: run.summary,
    mode: exact ? t('export.modeOriginal') : t('export.modeAdjusted'),
    metadata: {
      run_id: entry.id,
      model_version: run.summary.model_version || entry.model_version,
      input_hash: run.summary.input_hash,
      z_requested_m: z,
      z_center_m: z,
      z_min_m: z - grid.dz_m / 2,
      z_max_m: z + grid.dz_m / 2,
      units: 'µg/m³',
      exported_at: (input.now ?? new Date()).toISOString(),
      locale: input.locale,
      grid: { ...grid },
      provenance: bootstrap.provenance,
      scene_quality: bootstrap.quality,
      camera: input.camera,
      illustration: { multiplier: state.display.multiplier, background_ug_m3: state.display.background },
      thresholds,
      basemap: state.basemap,
      selected_cell: state.selectedCell ? { ...state.selectedCell } : null,
      render_lod: input.renderLod
        ? {
            level: input.renderLod.level,
            facade_vertices: state.layers.buildings && state.layers.facades ? input.renderLod.vertices : 0,
          }
        : null,
      layers: {
        buildings: state.layers.buildings,
        facades: state.layers.facades,
        roads: state.layers.roads,
        wind: state.layers.wind,
        wind_paused: state.windPaused,
        grid: state.layers.grid,
      },
      ...input.contributions.metadata,
    },
    attribution: input.attribution || t('export.defaultAttribution'),
    notice: t('export.notice', { wind: windText }),
    legend: {
      title: t('export.legendTitle'),
      stops: RAMP.map(([p, c]) => [p, `rgb(${c.join(',')})`]),
      labels: legendValues(scale).map((v) => formatNumber(v)),
    },
  };
  // A contributed comparison replaces the concentration layer (and its threshold
  // colouring): the notice then says wind and buildings belong to the baseline run.
  const comparing = input.contributions.report.comparison != null;
  if (comparing) report.notice += t('export.comparisonNotice');
  else if (thresholds.length) {
    report.legend = {
      title: t('export.thresholdLegendTitle'),
      categories: thresholds.map((th) => ({ label: `${th.label}: > ${th.value}`, color: `rgb(${thresholdColour(th.key).join(',')})` })),
      labels: [],
    };
    report.notice += t('export.thresholdNotice');
  }
  Object.assign(report, input.contributions.report);
  return report;
}

/** Stable identity of a snapshot (exported_at excluded), to detect changes during PNG capture. */
export function reportKey(report: Report): string {
  const { exported_at: _ignored, ...stable } = report.metadata;
  return JSON.stringify([stable, report.mode]);
}
