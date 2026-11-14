/**
 * Compact run evidence + building data quality (port of ViewerEvidence.render).
 * Text only: warnings and provenance are rendered as text, never HTML. Ready for
 * the map-options panel: `<RunEvidence />`.
 */
import { useMemo } from 'react';
import { useI18n, type TranslationKey } from '../i18n';
import { hasDataWarning, viewModel, type DataQuality } from '../lib/evidence';
import { selectCurrentRun } from '../store/selectors';
import { useViewer } from '../store/store';

export function RunEvidence() {
  const { locale } = useI18n();
  const run = useViewer(selectCurrentRun);
  const runId = useViewer((s) => s.selectedRunId);
  const quality = useViewer((s) => s.bootstrap.data?.quality ?? null);
  const model = useMemo(() => viewModel(run?.summary, runId, locale), [run, runId, locale]);
  return (
    <div id="run-evidence" aria-live="polite">
      <EvidenceView model={model} quality={quality} />
    </div>
  );
}

export function EvidenceView({ model, quality }: { model: ReturnType<typeof viewModel>; quality: DataQuality | null }) {
  const { t, formatNumber } = useI18n();
  if (!model.identity || !model.metrics) {
    return <p className={`evidence-status evidence-${model.state}`}>{t(model.message.key, model.message.params)}</p>;
  }
  const metric = (key: TranslationKey) => model.metrics!.find(([k]) => k === key)?.[1] ?? null;
  const heading = model.model === 'fv' ? t('evidence.headingFv') : model.model === 'gaussian' ? t('evidence.headingGaussian') : t('evidence.headingOther');
  return (
    <>
      <section className="result-overview">
        <div className="result-overview-heading">
          <h3>{heading}</h3>
          <span className={`result-state evidence-${model.state}`}>{model.state === 'pass' ? t('evidence.statePass') : t('evidence.stateUnverified')}</span>
        </div>
        <dl className="result-times">
          <div>
            <dt>{t('evidence.timeCompute')}</dt>
            <dd>{metric('evidence.metric.wallClock') ?? t('evidence.missing')}</dd>
          </div>
          <div>
            <dt>{t('evidence.timeSimulated')}</dt>
            <dd>{metric('evidence.metric.simulated') ?? t('evidence.missing')}</dd>
          </div>
        </dl>
      </section>
      {quality && (
        <section className="scene-quality">
          <div className="quality-heading">
            <h3>{t('evidence.quality.heading')}</h3>
            {quality.total !== null && <span className="quality-count">{t('evidence.quality.count', { count: formatNumber(quality.total, { maximumSignificantDigits: 5 }) })}</span>}
          </div>
          {quality.total === null ? (
            <p className="quality-empty">{t('evidence.quality.noHeights')}</p>
          ) : !quality.total ? (
            <p className="quality-empty">{t('evidence.quality.noBuildings')}</p>
          ) : (
            <>
              <dl className="quality-sources">
                <dt>{t('evidence.quality.footprint')}</dt>
                <dd>{quality.footprint_source?.replace(' contributors', '') || t('evidence.quality.unknownSource')}</dd>
                <dt>{t('evidence.quality.height')}</dt>
                <dd>{quality.height_source?.replace(' 2.5D Temporal', '') || t('evidence.quality.unknownSource')}</dd>
              </dl>
              {quality.groups.length === 1 && quality.groups[0].count === quality.total ? (
                <p className="quality-coverage">{t(`evidence.quality.all.${quality.groups[0].key}` as TranslationKey)}</p>
              ) : (
                <dl className="quality-sources quality-breakdown">
                  {quality.groups.map((group) => (
                    <div key={group.key} style={{ display: 'contents' }}>
                      <dt>{t(group.labelKey)}</dt>
                      <dd>{formatNumber(group.count, { maximumSignificantDigits: 5 })}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </section>
      )}
      <aside className="model-caveat">
        <strong>{t('evidence.caveatTitle')}</strong>
        <p>{t('evidence.caveat')}</p>
      </aside>
      {hasDataWarning(model.warnings) && <p className="model-warning">{t('evidence.warning')}</p>}
    </>
  );
}
