/**
 * PLACEHOLDER — the map-options panel is built in this directory.
 * Keep the exported definition name; replace the component body.
 * Copy: src/i18n/{en,vi}/mapOptions.ts. Extension APIs: see frontend/README.md.
 */
import { useI18n } from '../../i18n';
import type { PanelDefinition, PanelProps } from '../types';

function MapOptionsPanel(_props: PanelProps) {
  const { t } = useI18n();
  return (
    <div className="section-heading">
      <h2 className="tool-panel-title">{t('mapOptions.title')}</h2>
    </div>
  );
}

export const mapOptionsPanel: PanelDefinition = {
  id: 'map-options',
  icon: 'map',
  labelKey: 'mapOptions.toolLabel',
  elementId: 'map-options',
  Component: MapOptionsPanel,
};
