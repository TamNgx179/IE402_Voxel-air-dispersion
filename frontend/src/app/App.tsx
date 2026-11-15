/** App shell: providers, sidebar, map and overlays. */
import { useState } from 'react';
import { HelpProvider } from '../shared/ui/Help';
import { LanguageSwitch } from '../shared/ui/LanguageSwitch';
import { CameraToolbar, MapInteraction, QueryFeedback, StatusBox } from '../shared/ui/MapChrome';
import { ResultCard } from '../shared/ui/ResultCard';
import { PanelHost, ToolNav } from '../shared/ui/ToolPanels';
import { ExportProvider } from '../export/ExportProvider';
import { I18nProvider, useI18n } from '../i18n';
import { MapProvider } from '../map/hooks';
import { MapView, type MapFactory } from '../map/MapView';
import { PANELS } from '../features';
import type { PanelDefinition } from '../features/types';
import { ViewerActionsProvider, type ApiFn } from './viewerFacade';
import { ViewerStoreProvider, useViewer, type ViewerStore } from '../store/store';

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
  const activePanel = useViewer((s) => s.activePanel);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      {bootstrap ? <MapView bootstrap={bootstrap} factory={mapFactory} /> : <div id="map" role="region" aria-label={t('viewer.mapLabel')} />}
      <MapInteraction />
      <div className="map-controls">
        <CameraToolbar />
      </div>

      <section className={`panel${collapsed ? ' collapsed' : ''}`} id="panel" aria-label={t('viewer.panelLabel')}>
        <header className="panel-head">
          <h1>{t('viewer.workspaceTitle')}</h1>
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
          <ToolNav panels={panels} />
          <StatusBox />
          <ResultCard bootstrap={bootstrap} overview={activePanel === null || activePanel === 'simulation'} />
          <PanelHost panels={panels} />
          <QueryFeedback />
        </div>
      </section>

    </>
  );
}
