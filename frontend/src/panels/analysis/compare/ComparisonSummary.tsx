/** Comparison figures at the current layer (legacy `comparisonSummary`). */
import { useI18n } from '../../../i18n';
import { Metrics, useAnalysisNumber } from '../Metrics';
import type { ComparisonPayload, ComparisonView } from './types';

/** Largest baseline/comparison value (≥ 0) at this layer; nulls are ignored. */
export function concentrationMax(payload: ComparisonPayload): number {
  let max = 0;
  for (const f of payload.feature_collection.features)
    for (const v of [f.properties.baseline_ug_m3, f.properties.comparison_ug_m3])
      if (typeof v === 'number' && Number.isFinite(v) && v > max) max = v;
  return max;
}

export function ComparisonSummary({ payload, view }: { payload: ComparisonPayload; view: ComparisonView }) {
  const { t } = useI18n();
  const number = useAnalysisNumber('compare.noData');
  const delta = view === 'delta';
  const lo = delta ? payload.stats.delta.min_ug_m3 : 0;
  const hi = delta ? payload.stats.delta.max_ug_m3 : concentrationMax(payload);
  const limit = Math.max(Math.abs(lo ?? 0), Math.abs(hi ?? 0));
  const difference = payload.stats.delta.mean_ug_m3;
  const baselineMean = payload.stats.baseline.mean_ug_m3 ?? 0;
  const comparisonMean = payload.stats.comparison.mean_ug_m3 ?? 0;
  const maxMean = Math.max(baselineMean, comparisonMean, 1e-12);
  return (
    <>
      <div
        className="analysis-ramp"
        aria-hidden="true"
        style={{
          background: delta ? 'linear-gradient(90deg,#4b6f8c,#f5f2e8,#9d534e)' : 'linear-gradient(90deg,#f8eed3,#703541)',
        }}
      />
      <p className="note">
        {delta
          ? t('compare.summary.deltaScale', { min: number(limit === 0 ? 0 : -limit), max: number(limit) })
          : t('compare.summary.linearScale', { max: number(hi) })}
      </p>
      <Metrics
        format={number}
        entries={[
          { label: t('compare.summary.meanBaseline'), value: payload.stats.baseline.mean_ug_m3, unit: 'µg/m³' },
          { label: t('compare.summary.meanComparison'), value: payload.stats.comparison.mean_ug_m3, unit: 'µg/m³' },
          { label: t('compare.summary.meanDelta'), value: difference, unit: 'µg/m³' },
        ]}
      />
      <p className="result-insight">
        {difference === null
          ? t('compare.summary.noShared')
          : difference === 0
            ? t('compare.summary.same')
            : t(difference > 0 ? 'compare.summary.higher' : 'compare.summary.lower', { value: number(Math.abs(difference)) })}
      </p>
      <div className="comparison-bars" aria-hidden="true">
        <div className="comparison-bar" style={{ width: `${(baselineMean / maxMean) * 100}%` }}>
          {t('compare.summary.barBaseline')}
        </div>
        <div className="comparison-bar" style={{ width: `${(comparisonMean / maxMean) * 100}%` }}>
          {t('compare.summary.barComparison')}
        </div>
      </div>
    </>
  );
}
