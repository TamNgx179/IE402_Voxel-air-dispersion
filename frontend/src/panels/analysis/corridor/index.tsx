/**
 * PLACEHOLDER — the corridor analysis sub-mode is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/corridor.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../../i18n';
import type { AnalysisModeDefinition, AnalysisModeProps } from '../modes';

function CorridorMode(_props: AnalysisModeProps) {
  const { t } = useI18n();
  return (
    <section className="analysis-section" aria-labelledby="corridor-heading">
      <div className="section-heading">
        <h2 id="corridor-heading">{t('corridor.title')}</h2>
      </div>
    </section>
  );
}

export const corridorMode: AnalysisModeDefinition = {
  id: 'corridor',
  labelKey: 'corridor.modeLabel',
  Component: CorridorMode,
};
