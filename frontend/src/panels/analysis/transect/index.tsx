/**
 * PLACEHOLDER — the transect analysis sub-mode is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/transect.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../../i18n';
import type { AnalysisModeDefinition, AnalysisModeProps } from '../modes';

function TransectMode(_props: AnalysisModeProps) {
  const { t } = useI18n();
  return (
    <section className="analysis-section" aria-labelledby="transect-heading">
      <div className="section-heading">
        <h2 id="transect-heading">{t('transect.title')}</h2>
      </div>
    </section>
  );
}

export const transectMode: AnalysisModeDefinition = {
  id: 'transect',
  labelKey: 'transect.modeLabel',
  Component: TransectMode,
};
