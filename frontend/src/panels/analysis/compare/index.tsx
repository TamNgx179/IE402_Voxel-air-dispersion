/**
 * PLACEHOLDER — the compare analysis sub-mode is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/compare.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../../i18n';
import type { AnalysisModeDefinition, AnalysisModeProps } from '../modes';

function CompareMode(_props: AnalysisModeProps) {
  const { t } = useI18n();
  return (
    <section className="analysis-section" aria-labelledby="compare-heading">
      <div className="section-heading">
        <h2 id="compare-heading">{t('compare.title')}</h2>
      </div>
    </section>
  );
}

export const compareMode: AnalysisModeDefinition = {
  id: 'compare',
  labelKey: 'compare.modeLabel',
  Component: CompareMode,
};
