/**
 * Machine-readable exports (port of the CSV helpers in web/viewer-export.js).
 * Column names and units are a stable contract: they are NEVER translated.
 */
import type { RunSummary } from '../api/types';

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
