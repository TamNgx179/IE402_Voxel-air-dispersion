/**
 * PLACEHOLDER — the stats panel is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/stats.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../i18n';
import type { PanelDefinition, PanelProps } from '../types';

function StatsPanel(_props: PanelProps) {
  const { t } = useI18n();
  return (
    <div className="section-heading">
      <h2 className="tool-panel-title">{t('stats.title')}</h2>
    </div>
  );
}

export const statsPanel: PanelDefinition = {
  id: 'stats',
  icon: 'bar-chart-line',
  labelKey: 'stats.toolLabel',
  elementId: 'analysis-details',
  Component: StatsPanel,
};
