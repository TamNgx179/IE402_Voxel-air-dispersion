/** App shell: providers, sidebar, map and overlays. */
import { useEffect, useState } from 'react';
import { HelpProvider } from '../shared/ui/Help';
import { LanguageSwitch } from '../shared/ui/LanguageSwitch';
import { CameraToolbar, MapInteraction, QueryFeedback, StatusBox } from '../shared/ui/MapChrome';
import { ResultCard } from '../shared/ui/ResultCard';
import { PanelHost, ToolNav } from '../shared/ui/ToolPanels';
import { ExportProvider } from '../export/ExportProvider';
import { I18nProvider, useI18n } from '../i18n';
import { MapProvider } from '../map/hooks';
import { MapView, VECTOR_BASEMAP, type MapFactory } from '../map/MapView';
import { PANELS } from '../features';
import type { PanelDefinition } from '../features/types';
import { ViewerActionsProvider, useViewerActions, type ApiFn } from './viewerFacade';
import { ViewerStoreProvider, useViewer, useViewerStore, type ViewerStore } from '../store/store';
import { ConnectionScreen } from './ConnectionScreen';
import { cacheOfflineArtwork } from './offlineArtwork';

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
  const { t, locale } = useI18n();
  useEffect(() => { void cacheOfflineArtwork(locale); }, [locale]);
  const { data: bootstrap, status, error } = useViewer((s) => s.bootstrap);
  const store = useViewerStore();
  const { loadBootstrap } = useViewerActions();
  const activePanel = useViewer((s) => s.activePanel);
  const [collapsed, setCollapsed] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [basemapUnavailable, setBasemapUnavailable] = useState(false);
  useEffect(() => {
    const disconnected = () => setOffline(true);
    const connected = () => {
      setOffline(false);
      if (store.getState().bootstrap.status === 'error') void loadBootstrap();
    };
    window.addEventListener('offline', disconnected);
    window.addEventListener('online', connected);
    return () => {
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('online', connected);
    };
  }, [store, loadBootstrap]);

  useEffect(() => {
    if (offline || status !== 'error') return;
    const timer = setTimeout(() => void loadBootstrap(), 4000);
    return () => clearTimeout(timer);
  }, [offline, status, loadBootstrap]);

  // A tile provider can go down without triggering the browser's offline event.
  useEffect(() => {
    if (!basemapUnavailable || offline) return;
    let controller: AbortController | undefined;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function probe() {
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 5000);
      try {
        const response = await fetch(VECTOR_BASEMAP, {
          cache: 'no-store',
          signal: request.signal,
        });
        if (response.ok && !disposed) {
          store.dispatch({ type: 'basemap/set', basemap: 'vector' });
          setBasemapUnavailable(false);
          return;
        }
      } catch {
        // Remain on the artwork until the provider answers.
      } finally {
        clearTimeout(timeout);
      }
      if (!disposed) timer = setTimeout(probe, 8000);
    }
    void probe();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [basemapUnavailable, offline, store]);

  if (offline || basemapUnavailable) return <ConnectionScreen offline />;
  if (status === 'error' || (status === 'loading' && error !== null)) {
    return <ConnectionScreen retrying={status === 'loading'} onRetry={() => void loadBootstrap()} />;
  }
  return (
    <>
      {bootstrap ? <MapView bootstrap={bootstrap} factory={mapFactory} onBasemapUnavailable={setBasemapUnavailable} /> : <div id="map" role="region" aria-label={t('viewer.mapLabel')} />}
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
