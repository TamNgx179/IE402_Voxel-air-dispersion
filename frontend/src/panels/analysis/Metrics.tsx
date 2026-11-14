/** Shared result rendering for the analysis sub-modes (legacy `metrics` / `number`). */
import { useCallback } from 'react';
import { useI18n, type TranslationKey } from '../../i18n';

/**
 * Legacy analysis number format: up to 5 significant digits in the UI locale,
 * "No data" for null/undefined (missing data is never shown as 0).
 */
export function useAnalysisNumber(noDataKey: TranslationKey): (value: number | null | undefined) => string {
  const { t, formatNumber } = useI18n();
  return useCallback(
    (value) =>
      value === null || value === undefined
        ? t(noDataKey)
        : formatNumber(Number(value), { maximumSignificantDigits: 5 }),
    [t, formatNumber, noDataKey],
  );
}

export interface MetricEntry {
  label: string;
  value: number | null | undefined;
  unit?: string;
}

export function Metrics({ entries, format }: { entries: MetricEntry[]; format: (value: number | null | undefined) => string }) {
  return (
    <dl className="result-metrics">
      {entries.map((entry) => (
        <div key={entry.label}>
          <dt>{entry.label}</dt>
          <dd>
            {format(entry.value)}
            {entry.value !== null && entry.value !== undefined && entry.unit ? <small>{entry.unit}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
