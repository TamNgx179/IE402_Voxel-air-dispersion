/**
 * PLACEHOLDER — the region analysis sub-mode is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/region.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../../i18n';
import type { AnalysisModeDefinition, AnalysisModeProps } from '../modes';

function RegionMode(_props: AnalysisModeProps) {
  const { t } = useI18n();
  return (
    <section className="analysis-section" aria-labelledby="region-heading">
      <div className="section-heading">
        <h2 id="region-heading">{t('region.title')}</h2>
      </div>
    </section>
  );
}

export const regionMode: AnalysisModeDefinition = {
  id: 'region',
  labelKey: 'region.modeLabel',
  Component: RegionMode,
};
