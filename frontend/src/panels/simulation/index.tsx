/**
 * PLACEHOLDER — the simulation panel is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/simulation.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../i18n';
import type { PanelDefinition, PanelProps } from '../types';

function SimulationPanel(_props: PanelProps) {
  const { t } = useI18n();
  return (
    <div className="section-heading">
      <h2 className="tool-panel-title">{t('simulation.title')}</h2>
    </div>
  );
}

export const simulationPanel: PanelDefinition = {
  id: 'simulation',
  icon: 'play-fill',
  labelKey: 'simulation.toolLabel',
  elementId: 'simulation-options',
  Component: SimulationPanel,
};
