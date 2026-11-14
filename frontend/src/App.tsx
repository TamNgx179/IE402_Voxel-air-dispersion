/** App shell: providers, sidebar, map and overlays. */
import { useState } from 'react';
import { HelpProvider } from './components/Help';
import { LanguageSwitch } from './components/LanguageSwitch';
import { CameraToolbar, CellInfo, MapInteraction, QueryFeedback, StatusBox, WindHud } from './components/MapChrome';
import { ResultCard } from './components/ResultCard';
import { PanelHost, ToolNav } from './components/ToolPanels';
import { ExportProvider } from './export/ExportProvider';
import { I18nProvider, useI18n } from './i18n';
import { MapProvider } from './map/hooks';
import { MapView, type MapFactory } from './map/MapView';
import { PANELS } from './panels';
import type { PanelDefinition } from './panels/types';
import { ViewerActionsProvider, type ApiFn } from './store/controller';
import { ViewerStoreProvider, useViewer, type ViewerStore } from './store/store';

export interface AppProps {
  store?: ViewerStore;
  api?: ApiFn;
  mapFactory?: MapFactory;
  panels?: readonly PanelDefinition[];
}

export function App({ store, api, mapFactory, panels = PANELS }: AppProps) {
  return (
    <I18nProvider>
      <ViewerStoreProvider store={store}>
        <ViewerActionsProvider api={api}>
          <MapProvider>
            <ExportProvider>
              <HelpProvider>
                <Viewer mapFactory={mapFactory} panels={panels} />
              </HelpProvider>
            </ExportProvider>
          </MapProvider>
        </ViewerActionsProvider>
      </ViewerStoreProvider>
    </I18nProvider>
  );
}

function Viewer({ mapFactory, panels }: { mapFactory?: MapFactory; panels: readonly PanelDefinition[] }) {
  const { t } = useI18n();
  const bootstrap = useViewer((s) => s.bootstrap.data);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      {bootstrap ? <MapView bootstrap={bootstrap} factory={mapFactory} /> : <div id="map" role="region" aria-label={t('viewer.mapLabel')} />}
      <CameraToolbar />
      <MapInteraction />
      <WindHud />

      <section className={`panel${collapsed ? ' collapsed' : ''}`} id="panel" aria-label={t('viewer.panelLabel')}>
        <header className="panel-head">
          <div>
            <h1>
              {t('viewer.title')} <span className="pollutant">{t('viewer.pollutant')}</span>
            </h1>
            <p className="subtitle">{t('viewer.subtitle')}</p>
          </div>
          <div className="panel-head-actions">
            <LanguageSwitch />
            <button
              id="panel-toggle"
              className="icon-button"
              type="button"
              aria-expanded={!collapsed}
              aria-controls="panel-body"
              aria-label={collapsed ? t('viewer.panelExpand') : t('viewer.panelCollapse')}
              title={t('viewer.panelCollapseTitle')}
              onClick={() => setCollapsed((value) => !value)}
            >
              <i className="bi bi-chevron-up" aria-hidden="true" />
            </button>
          </div>
        </header>
        <div id="panel-body">
          <ResultCard bootstrap={bootstrap} />
          <ToolNav panels={panels} />
          <QueryFeedback />
          <PanelHost panels={panels} />
        </div>
      </section>

      <StatusBox />
      <CellInfo />
    </>
  );
}
