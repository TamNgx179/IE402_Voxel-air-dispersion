/**
 * Machine-readable exports (port of the CSV helpers in web/viewer-export.js).
 * Column names and units are a stable contract: they are NEVER translated.
 */
import { AppError } from '../api/client';
import type { RunSummary } from '../api/types';
import type { TranslationKey } from '../i18n';

/** RFC 4180 CSV with CRLF; strings starting with = + @ - are prefixed with ' (formula injection). */
export function csv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return (
    rows
      .map((row) =>
        row
          .map((value) => {
            if (value === null || value === undefined) return '';
            let text = String(value);
            if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n') + '\r\n'
  );
}

export const LAYER_CSV_COLUMNS = [
  'run_id',
  'model_version',
  'input_hash',
  'emission_multiplier',
  'z_min_m',
  'z_max_m',
  'z_center_m',
  'mean_ug_m3',
  'max_ug_m3',
  'air_cells',
  'units',
] as const;

/** Per-layer summary CSV (legacy layerCsv). */
export function layerCsv(report: {
  metadata: { run_id: string; model_version: string | null | undefined; input_hash: string | null | undefined };
  summary: Pick<RunSummary, 'layers' | 'grid' | 'units' | 'emission_multiplier'>;
}): string {
  const meta = report.metadata;
  const rows: unknown[][] = [[...LAYER_CSV_COLUMNS]];
  for (const layer of report.summary.layers)
    rows.push([
      meta.run_id,
      meta.model_version,
      meta.input_hash,
      report.summary.emission_multiplier ?? 1,
      layer.z_m - report.summary.grid.dz_m / 2,
      layer.z_m + report.summary.grid.dz_m / 2,
      layer.z_m,
      layer.mean_ug_m3,
      layer.max_ug_m3,
      layer.air_cells,
      report.summary.units,
    ]);
  return csv(rows);
}

/** UTF-8 CSV blob with BOM (so spreadsheet apps detect µ correctly). */
export function csvBlob(text: string): Blob {
  return new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
}

export function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
}

export function download(doc: Document, blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob),
    a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- comparison export
// Port of comparisonCsv / comparisonLegend / png and the file naming in web/app.js.

export const COMPARISON_CSV_COLUMNS = [
  'baseline_run_id',
  'comparison_run_id',
  'baseline_version',
  'comparison_version',
  'baseline_input_hash',
  'comparison_input_hash',
  'baseline_emission_multiplier',
  'comparison_emission_multiplier',
  'requested_z_m',
  'z_center_m',
  'i',
  'j',
  'baseline_ug_m3',
  'comparison_ug_m3',
  'delta_ug_m3',
  'units',
] as const;

export interface ComparisonCellProperties {
  i?: number;
  j?: number;
  baseline_ug_m3: number | null;
  comparison_ug_m3: number | null;
  delta_ug_m3?: number | null;
}

export interface ComparisonData {
  baseline_run_id?: string;
  comparison_run_id?: string;
  baseline_version?: string | null;
  comparison_version?: string | null;
  baseline_input_hash?: string | null;
  comparison_input_hash?: string | null;
  baseline_emission_multiplier?: number | null;
  comparison_emission_multiplier?: number | null;
  requested_z_m?: number;
  z_center_m?: number;
  units?: string;
  feature_collection: { features: ReadonlyArray<{ properties: ComparisonCellProperties }> };
}

/** Per-cell exact comparison CSV (legacy comparisonCsv); multipliers default to 1. */
export function comparisonCsv(data: ComparisonData): string {
  const rows: unknown[][] = [[...COMPARISON_CSV_COLUMNS]];
  for (const f of data.feature_collection.features) {
    const p = f.properties;
    rows.push([
      data.baseline_run_id,
      data.comparison_run_id,
      data.baseline_version,
      data.comparison_version,
      data.baseline_input_hash,
      data.comparison_input_hash,
      data.baseline_emission_multiplier ?? 1,
      data.comparison_emission_multiplier ?? 1,
      data.requested_z_m,
      data.z_center_m,
      p.i,
      p.j,
      p.baseline_ug_m3,
      p.comparison_ug_m3,
      p.delta_ug_m3,
      data.units,
    ]);
  }
  return csv(rows);
}

export interface ComparisonLegendInput {
  feature_collection: { features: ReadonlyArray<{ properties: ComparisonCellProperties }> };
  stats: { air_cells: number; delta: { min_ug_m3: number | null; max_ug_m3: number | null } };
}

/** Legend whose titles/labels are i18n keys; numeric labels are pre-formatted with `format`. */
export interface KeyedLegend {
  titleKey: TranslationKey;
  categories?: Array<{ labelKey: TranslationKey; color: string }>;
  stops?: Array<[number, string]>;
  labels: string[];
}

/**
 * Comparison legend (legacy comparisonLegend). Null is never coerced to 0: a layer
 * without shared air cells differs from two identical solutions.
 */
export function comparisonLegend(
  data: ComparisonLegendInput,
  view: string,
  format: (value: number) => string,
): KeyedLegend {
  if (!data.feature_collection.features.length || data.stats.air_cells === 0)
    return {
      titleKey: 'analysis.legend.compareEmptyTitle',
      categories: [{ labelKey: 'analysis.legend.compareEmptyLabel', color: '#cbd5db' }],
      labels: [],
    };
  const delta = view === 'delta';
  const min = delta ? Math.min(0, Number(data.stats.delta.min_ug_m3)) : 0;
  const max = delta
    ? Math.max(0, Number(data.stats.delta.max_ug_m3))
    : Math.max(
        0,
        ...data.feature_collection.features.flatMap((f) => [
          Number(f.properties.baseline_ug_m3),
          Number(f.properties.comparison_ug_m3),
        ]),
      );
  const limit = Math.max(Math.abs(min), Math.abs(max));
  if (delta && limit === 0)
    return {
      titleKey: 'analysis.legend.deltaZeroTitle',
      categories: [{ labelKey: 'analysis.legend.deltaZeroLabel', color: '#f5f2e8' }],
      labels: [],
    };
  return delta
    ? {
        titleKey: 'analysis.legend.deltaTitle',
        stops: [
          [0, '#4b6f8c'],
          [0.5, '#f5f2e8'],
          [1, '#9d534e'],
        ],
        labels: [format(-limit), '0', format(limit)],
      }
    : {
        titleKey: 'analysis.legend.concentrationTitle',
        stops: [
          [0, '#f8eed3'],
          [1, '#703541'],
        ],
        labels: ['0', format(max)],
      };
}

export type ExportKind = 'png' | 'csv' | 'json';

/**
 * Download file name (legacy exportResult): `pm25-<run>-layers.csv` for a plain CSV,
 * otherwise `pm25-<run>[-vs-<other>]-<z>m[-<view>].<ext>`.
 */
export function exportFilename(input: {
  kind: ExportKind;
  runId: string;
  zCenterM: number;
  comparisonRunId?: string | null;
  view?: string;
}): string {
  const base = `pm25-${input.runId}`,
    comparing = Boolean(input.comparisonRunId),
    pair = comparing ? `-vs-${input.comparisonRunId}` : '';
  const name =
    input.kind === 'csv' && !comparing
      ? `${base}-layers`
      : `${base}${pair}-${input.zCenterM}m${comparing ? '-' + (input.view ?? '') : ''}`;
  return `${name}.${input.kind}`;
}

/** Analysis CSV names (legacy region / road-corridor / transect downloads). */
export function analysisCsvFilename(kind: 'region' | 'road-corridor' | 'transect', runId: string): string {
  return `${kind}-${runId}.csv`;
}

/** Splits `text` into lines no wider than `maxWidth` (character wrap, legacy report footer). */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (measure(line + char) > maxWidth) {
      lines.push(line);
      line = '';
    }
    line += char;
  }
  lines.push(line);
  return lines;
}

/** PNG blob of a canvas; a null blob or a tainted (CORS) canvas reject with keyed errors. */
export function png(canvas: Pick<HTMLCanvasElement, 'toBlob'>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new AppError('analysis.export.pngFailed'))),
        'image/png',
      );
    } catch {
      reject(new AppError('analysis.export.pngCors'));
    }
  });
}
