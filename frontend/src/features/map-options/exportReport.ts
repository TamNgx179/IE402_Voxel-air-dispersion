/**
 * Map-options export: legacy file layout (web/app.js exportResult / reportSnapshot)
 * and the PNG report composer (web/viewer-export.js compose / copyCanvas).
 *
 * Field names, units and numbers in CSV/JSON are a machine-readable contract and
 * are never translated. Only the PNG header/footer text follows the UI language.
 */
import { AppError } from '../../api/client';
import type { Report } from '../../export/report';
import type { TranslationKey, TranslationParams } from '../../i18n';
import { comparisonCsv, exportFilename, layerCsv, wrapText, type ComparisonData, type ExportKind } from '../../lib/export';

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/**
 * Comparison contributed by the compare mode under `report.comparison`
 * (`useExportContribution('comparison', …, { target: 'report' })`). The current
 * view (`baseline` | `comparison` | `delta`) is read from `report.comparison_view`
 * (or `comparison.view`); `comparison_view` is used for the file name only and is
 * removed from the JSON so the file matches the legacy layout.
 */
export type ExportComparison = ComparisonData & { view?: string };

/** Legacy top-level key order of the JSON report. */
const REPORT_ORDER = ['title', 'summary', 'comparison', 'mode', 'metadata', 'attribution', 'notice', 'legend'] as const;

/** Legacy metadata key order (`locale` is new and sits after `exported_at`). */
const METADATA_ORDER = [
  'run_id',
  'model_version',
  'input_hash',
  'comparison_run_id',
  'z_requested_m',
  'z_center_m',
  'z_min_m',
  'z_max_m',
  'units',
  'exported_at',
  'locale',
  'grid',
  'provenance',
  'scene_quality',
  'camera',
  'illustration',
  'thresholds',
  'basemap',
  'selected_cell',
  'region',
  'transect',
  'road_corridor',
  'render_lod',
  'layers',
] as const;

/** Keys legacy always wrote (as null when the analysis tool had nothing). */
const NULL_METADATA = ['region', 'transect', 'road_corridor'] as const;

function ordered(source: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) if (key in source) out[key] = source[key];
  for (const key of Object.keys(source)) if (!(key in out)) out[key] = source[key];
  return out;
}

/** Legacy JSON layout: key order, `comparison`/`region`/`transect`/`road_corridor` default to null. */
export function normalizeReport(report: Report): Report {
  const metadata: Record<string, unknown> = { ...report.metadata };
  for (const key of NULL_METADATA) if (metadata[key] === undefined) metadata[key] = null;
  const top: Record<string, unknown> = { ...report, metadata: ordered(metadata, METADATA_ORDER) };
  if (top.comparison === undefined) top.comparison = null;
  delete top.comparison_view;
  return ordered(top, REPORT_ORDER) as Report;
}

export function reportComparison(report: Report): ExportComparison | null {
  const value = report.comparison as ExportComparison | null | undefined;
  return value && typeof value === 'object' && value.feature_collection ? value : null;
}

function comparisonView(report: Report): string | undefined {
  const view = report.comparison_view ?? reportComparison(report)?.view;
  return typeof view === 'string' ? view : undefined;
}

/** Download name, identical to legacy (`pm25-<run>-layers.csv`, `pm25-<run>-<z>m.png`, …). */
export function reportFilename(report: Report, kind: ExportKind): string {
  const comparison = reportComparison(report);
  return exportFilename({
    kind,
    runId: report.metadata.run_id,
    zCenterM: report.metadata.z_center_m,
    comparisonRunId: comparison?.comparison_run_id ?? null,
    view: comparisonView(report),
  });
}

/** Per-layer CSV, or the per-cell comparison CSV while a comparison is shown. */
export function reportCsv(report: Report): string {
  const comparison = reportComparison(report);
  return comparison ? comparisonCsv(comparison) : layerCsv(report);
}

/** Copy of a canvas taken right after it rendered (WebGL buffers may be cleared later). */
export function copyCanvas(doc: Document, source: HTMLCanvasElement | null | undefined): HTMLCanvasElement {
  if (!source?.width || !source?.height) throw new AppError('mapOptions.error.mapNotReady');
  const out = doc.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  out.getContext('2d')?.drawImage(source, 0, 0);
  return out;
}

/** PNG text lines below the legend (legacy compose footer). */
export function footerLines(report: Report, t: Translate): string[] {
  const m = report.metadata;
  const comparison = reportComparison(report);
  const comparisonRunId = (m.comparison_run_id as string | null | undefined) ?? comparison?.comparison_run_id;
  return [
    t('mapOptions.png.run', { run: m.run_id }) + (comparisonRunId ? t('mapOptions.png.comparisonRun', { run: comparisonRunId }) : ''),
    t('mapOptions.png.model', { model: String(m.model_version), input: String(m.input_hash) }),
    ...(comparison
      ? [t('mapOptions.png.comparisonModel', { model: String(comparison.comparison_version), input: String(comparison.comparison_input_hash) })]
      : []),
    report.notice,
    t('mapOptions.png.source', { attribution: report.attribution }),
    t('mapOptions.png.exported', { time: m.exported_at, camera: JSON.stringify(m.camera) }),
  ];
}

/** Map image + title, level, legend and provenance footer (legacy compose, same layout). */
export function composeReport(
  doc: Document,
  base: HTMLCanvasElement,
  overlay: HTMLCanvasElement | null,
  report: Report,
  t: Translate,
): HTMLCanvasElement {
  const width = Math.max(1000, Math.min(2400, base.width)),
    mapHeight = Math.round((base.height * width) / base.width);
  const out = doc.createElement('canvas');
  out.width = width;
  const c = out.getContext('2d');
  if (!c) throw new AppError('analysis.export.pngFailed');
  const m = report.metadata;
  c.font = '14px system-ui';
  const wrapped = footerLines(report, t).flatMap((text) => wrapText(text, width - 48, (s) => c.measureText(s).width));
  out.height = mapHeight + 210 + wrapped.length * 19;
  // Changing the height resets the context state.
  c.fillStyle = '#fff';
  c.fillRect(0, 0, out.width, out.height);
  c.fillStyle = '#243c4c';
  c.font = '600 24px system-ui';
  c.fillText(t('mapOptions.png.title', { title: report.title }), 24, 34);
  c.font = '16px system-ui';
  c.fillText(
    t('mapOptions.png.layer', { min: String(m.z_min_m), max: String(m.z_max_m), centre: String(m.z_center_m), mode: report.mode }),
    24,
    62,
  );
  c.drawImage(base, 0, 82, width, mapHeight);
  if (overlay) c.drawImage(overlay, 0, 82, width, mapHeight);
  let y = mapHeight + 110;
  c.fillStyle = '#243c4c';
  c.font = '600 16px system-ui';
  c.fillText(report.legend.title, 24, y);
  y += 16;
  const { categories, stops, labels } = report.legend;
  if (categories) {
    categories.forEach((item, i) => {
      const x = 24 + (i * (width - 48)) / categories.length;
      c.fillStyle = item.color;
      c.fillRect(x, y, 16, 16);
      c.fillStyle = '#253039';
      c.font = '14px system-ui';
      c.fillText(item.label, x + 24, y + 13);
    });
  } else {
    const gradient = c.createLinearGradient(24, 0, width - 24, 0);
    (stops ?? []).forEach(([stop, color]) => gradient.addColorStop(stop, color));
    c.fillStyle = gradient;
    c.fillRect(24, y, width - 48, 14);
  }
  y += 34;
  c.fillStyle = '#253039';
  c.font = '14px system-ui';
  labels.forEach((label, i) => {
    c.textAlign = i === 0 ? 'left' : i === labels.length - 1 ? 'right' : 'center';
    c.fillText(label, 24 + (i * (width - 48)) / Math.max(1, labels.length - 1), y);
  });
  c.textAlign = 'left';
  y += 26;
  for (const line of wrapped) {
    c.fillText(line, 24, y);
    y += 19;
  }
  return out;
}
