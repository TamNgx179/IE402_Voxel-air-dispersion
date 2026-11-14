/**
 * The MapLibre map + deck.gl overlay. Created once in an effect when the bootstrap
 * data is ready and fully cleaned up on unmount. Language and viewer state changes
 * never recreate it: layers are re-rendered imperatively from the store and the
 * map registry.
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import { AmbientLight, DirectionalLight, LightingEffect, type PickingInfo } from '@deck.gl/core';
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../i18n';
import { build as buildAppearance, lighting } from '../lib/buildingAppearance';
import { rasterStyle } from '../lib/flow';
import { buildCells, buildNodes, lines, validCell } from '../lib/grid';
import { controller as lodController, prepare as prepareLod } from '../lib/lod';
import { usePrefersReducedMotion } from '../components/usePrefersReducedMotion';
import { useViewerStore } from '../store/store';
import { selectCurrentRun } from '../store/selectors';
import type { BootstrapData } from '../store/types';
import {
  advanceWind,
  buildingLayer,
  concentrationLayer,
  createWindState,
  ensureWind,
  facadeLayers,
  greenLayer,
  roadLayer,
  selectionLayer,
  voxelGridLayer,
  waterLayer,
  windLayers,
  type CoreContext,
} from './coreLayers';
import { useMapRegistry, useSetMapInstance, type MapInstance } from './hooks';
import type { MapClickEvent } from './registry';

export const VECTOR_BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

export interface MapFactoryResult {
  map: MapLibreMap;
  overlay: MapboxOverlay;
}

export type MapFactory = (args: {
  container: HTMLElement;
  centre: [number, number];
  overlayProps: ConstructorParameters<typeof MapboxOverlay>[0];
}) => MapFactoryResult;

/** Default factory: real MapLibre + deck overlay (non-interleaved, as in the legacy viewer). */
export const createMapLibre: MapFactory = ({ container, centre, overlayProps }) => {
  const map = new maplibregl.Map({
    container,
    style: VECTOR_BASEMAP,
    center: centre,
    zoom: 16.2,
    pitch: 55,
    bearing: -25,
    maxPitch: 80,
    attributionControl: { compact: true },
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  map.dragRotate.enable();
  map.touchZoomRotate?.enableRotation?.();
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 120 }), 'bottom-left');
  const overlay = new MapboxOverlay(overlayProps);
  map.addControl(overlay);
  return { map, overlay };
};

export interface MapViewProps {
  bootstrap: BootstrapData;
  factory?: MapFactory;
}

type Notice = { key: TranslationKey } | null;

export function MapView({ bootstrap, factory = createMapLibre }: MapViewProps) {
  const store = useViewerStore();
  const registry = useMapRegistry();
  const setInstance = useSetMapInstance();
  const { t, formatNumber } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [notice, setNotice] = useState<Notice>(null);

  // Translation helpers for deck callbacks, read through a ref so a language change
  // does not recreate the map.
  const i18nRef = useRef({ t, formatNumber });
  i18nRef.current = { t, formatNumber };
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const controlsRef = useRef<{ render(): void; restartWind(): void; retryBasemap(): void } | null>(null);

  const derived = useMemo(() => {
    const { node } = buildNodes(bootstrap.grid, bootstrap.corners);
    const appearance = buildAppearance(bootstrap.scene.buildings);
    return {
      node,
      cells: buildCells(bootstrap.grid),
      gridLines: lines(bootstrap.grid, node),
      appearance,
      lod: lodController(prepareLod(bootstrap.scene.buildings, appearance)),
    };
  }, [bootstrap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const c = bootstrap.corners;
    const centre: [number, number] = [(c.sw[0] + c.ne[0]) / 2, (c.sw[1] + c.ne[1]) / 2];
    let disposed = false;
    let sceneLayers: ReturnType<typeof buildSceneLayers> = [];
    const wind = createWindState();
    let frame: number | null = null;
    let renderQueued: number | null = null;
    let lastFrame = 0;
    let basemapFallback = false;
    let basemapError = false;
    let tileErrors = 0;
    let basemapTimer: ReturnType<typeof setTimeout> | undefined;
    let appliedBasemap = store.getState().basemap;

    const { map, overlay } = factory({
      container,
      centre,
      overlayProps: {
        interleaved: false,
        layers: [],
        effects: [lighting({ LightingEffect, AmbientLight, DirectionalLight })],
        getCursor: ({ isDragging }) =>
          registry.isDrawing() ? 'crosshair' : store.getState().mapMode === 'cell' ? 'default' : isDragging ? 'grabbing' : 'grab',
        getTooltip: (info: PickingInfo) => {
          // Cell values are shown only after a click, never as a hover tooltip.
          const layerId = info.layer?.id ?? '';
          if (layerId === 'concentration') return null;
          const contributed = registry.tooltip(info);
          if (contributed) return contributed;
          const object = info.object as { id?: string; properties?: { source_feature_id?: string } } | undefined;
          const id = object?.properties?.source_feature_id || object?.id;
          const building = id ? derived.appearance.features.get(id) : undefined;
          if (!building) return null;
          const { t: tr, formatNumber: fmt } = i18nRef.current;
          return tr('viewer.buildingTooltip', { id: building.id, height: fmt(building.height) });
        },
      },
    });

    const instance: MapInstance = {
      map,
      overlay,
      resetView: (duration?: number) => resetView(duration),
      renderLod: () => {
        const plan = derived.lod(map);
        return { level: plan.level, vertices: plan.vertices };
      },
      redraw: () => render(),
    };

    function resetView(duration = 450) {
      const mobile = window.matchMedia('(max-width: 640px)').matches;
      const panel = document.getElementById('panel');
      map.fitBounds([c.sw, c.ne], {
        maxZoom: mobile ? 15.8 : 16.4,
        bearing: -25,
        pitch: mobile ? 45 : 55,
        padding: mobile
          ? { top: 130, bottom: Math.round(window.innerHeight * 0.56), left: 50, right: 50 }
          : { top: 110, bottom: 80, left: (panel?.offsetWidth ?? 0) + 50, right: 90 },
        duration: reducedMotionRef.current ? 0 : duration,
      });
    }

    function onCellClick(cell: { i: number; j: number }) {
      if (registry.isDrawing()) return;
      if (!selectCurrentRun(store.getState()) || !validCell(bootstrap.grid, cell.i, cell.j)) return;
      store.dispatch({ type: 'cell/select', cell: { i: cell.i, j: cell.j } });
      store.dispatch({ type: 'panel/open', id: 'stats' });
    }

    function onBuildingClick(id: string) {
      // Building clicks while drawing must not switch tools or cancel the draft.
      if (registry.isDrawing()) return;
      if (!derived.appearance.features.get(id)) return;
      store.dispatch({ type: 'building/select', id });
      store.dispatch({ type: 'panel/open', id: 'map-options' });
    }

    function buildSceneLayers() {
      const state = store.getState();
      const ctx: CoreContext = {
        state,
        bootstrap,
        run: selectCurrentRun(state),
        node: derived.node,
        cells: derived.cells,
        gridLines: derived.gridLines,
        appearance: derived.appearance,
        lod: derived.lod,
        camera: map,
        drawing: registry.isDrawing(),
        suppressConcentration: registry.concentrationSuppressed(),
        onCellClick,
        onBuildingClick,
      };
      return [
        waterLayer(ctx),
        greenLayer(ctx),
        roadLayer(ctx),
        ...registry.layers('below-concentration'),
        concentrationLayer(ctx),
        ...registry.layers('above-concentration'),
        voxelGridLayer(ctx),
        buildingLayer(ctx),
        ...facadeLayers(ctx),
        selectionLayer(ctx),
        ...registry.layers('top'),
      ].filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));
    }

    function renderWindFrame() {
      const state = store.getState();
      overlay.setProps({ layers: [...sceneLayers, ...windLayers(wind, bootstrap, state.layers.wind)] });
    }

    function syncInteraction() {
      const state = store.getState();
      const drawing = registry.isDrawing();
      const picking = state.mapMode === 'cell';
      if (picking || drawing) map.dragPan.disable();
      else map.dragPan.enable();
      map.getCanvas().style.cursor = drawing ? 'crosshair' : picking ? 'default' : '';
    }

    function render() {
      renderQueued = null;
      if (disposed) return;
      const state = store.getState();
      syncInteraction();
      ensureWind(wind, bootstrap, selectCurrentRun(state), state.layer);
      sceneLayers = buildSceneLayers();
      renderWindFrame();
      applyBasemap();
    }

    function scheduleRender() {
      if (renderQueued !== null || disposed) return;
      renderQueued = requestAnimationFrame(render);
    }

    function stopWind() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      lastFrame = 0;
    }

    function restartWind() {
      stopWind();
      const state = store.getState();
      if (disposed || !state.layers.wind || state.windPaused || reducedMotionRef.current || document.hidden || !wind.field) return;
      const step = (now: number) => {
        const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
        advanceWind(wind, dt);
        lastFrame = now;
        renderWindFrame();
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    }

    // ---------------------------------------------------------------- basemap
    function watchBasemap() {
      clearTimeout(basemapTimer);
      basemapTimer = setTimeout(() => {
        if (disposed) return;
        const empty = !basemapFallback && map.queryRenderedFeatures().length === 0;
        if (basemapError || !map.isStyleLoaded() || !map.areTilesLoaded() || empty) {
          if (!basemapFallback) switchToFallback();
          else setNotice({ key: 'viewer.basemapSlow' });
        }
      }, 12000);
    }

    function setStyle(kind: 'vector' | 'raster') {
      appliedBasemap = kind;
      map.setStyle((kind === 'raster' ? rasterStyle() : VECTOR_BASEMAP) as StyleSpecification | string);
    }

    function switchToFallback() {
      basemapFallback = true;
      basemapError = false;
      setNotice({ key: 'viewer.basemapFallback' });
      setStyle('raster');
      if (store.getState().basemap !== 'raster') store.dispatch({ type: 'basemap/set', basemap: 'raster' });
      watchBasemap();
    }

    /** Apply a basemap chosen in the store (map-options panel). */
    function applyBasemap() {
      const wanted = store.getState().basemap;
      if (wanted === appliedBasemap) return;
      tileErrors = 0;
      basemapError = false;
      if (wanted === 'raster') switchToFallback();
      else {
        basemapFallback = false;
        setNotice(null);
        setStyle('vector');
        watchBasemap();
      }
    }

    function retryBasemap() {
      tileErrors = 0;
      basemapError = false;
      setNotice({ key: 'viewer.basemapReloading' });
      setStyle(basemapFallback ? 'raster' : 'vector');
      watchBasemap();
    }

    map.on('error', (event: { error?: unknown }) => {
      console.warn('MapLibre:', event.error || event);
      if (++tileErrors >= 2 && !basemapFallback) switchToFallback();
      else if (basemapFallback) {
        basemapError = true;
        setNotice({ key: 'viewer.basemapFailed' });
      }
    });
    map.on('idle', () => {
      if (map.areTilesLoaded() && !basemapError) setNotice(null);
    });
    watchBasemap();

    // ---------------------------------------------------------------- clicks
    map.on('click', (event: maplibregl.MapMouseEvent) => {
      const click: MapClickEvent = {
        lngLat: [event.lngLat.lng, event.lngLat.lat],
        point: [event.point.x, event.point.y],
        pick: (layerIds) =>
          (overlay.pickObject({ x: event.point.x, y: event.point.y, radius: 4, layerIds }) as PickingInfo | null) ?? null,
        originalEvent: event.originalEvent,
      };
      registry.dispatchClick(click);
    });

    map.on('moveend', scheduleRender);
    const unsubscribeStore = store.subscribe(() => {
      scheduleRender();
      restartWindIfNeeded();
    });
    const unsubscribeRegistry = registry.subscribe(scheduleRender);

    let windKey = '';
    function restartWindIfNeeded() {
      const s = store.getState();
      const key = `${s.selectedRunId}|${s.layer}|${s.layers.wind}|${s.windPaused}|${Boolean(selectCurrentRun(s))}`;
      if (key === windKey) return;
      windKey = key;
      const state = store.getState();
      ensureWind(wind, bootstrap, selectCurrentRun(state), state.layer);
      restartWind();
    }
    const onVisibility = () => restartWind();
    document.addEventListener('visibilitychange', onVisibility);

    controlsRef.current = { render: scheduleRender, restartWind, retryBasemap };
    resetView(0);
    render();
    restartWindIfNeeded();
    setInstance(instance);

    return () => {
      disposed = true;
      controlsRef.current = null;
      setInstance(null);
      stopWind();
      if (renderQueued !== null) cancelAnimationFrame(renderQueued);
      clearTimeout(basemapTimer);
      unsubscribeStore();
      unsubscribeRegistry();
      document.removeEventListener('visibilitychange', onVisibility);
      try {
        map.removeControl(overlay);
      } catch {
        /* already detached */
      }
      overlay.finalize();
      map.remove();
    };
    // The map is created once per bootstrap; everything else is read through refs/stores.
  }, [bootstrap, derived, factory]);

  // prefers-reduced-motion stops or resumes the animation without recreating the map.
  useEffect(() => {
    controlsRef.current?.restartWind();
  }, [reducedMotion]);

  return (
    <>
      <div id="map" ref={containerRef} role="region" aria-label={t('viewer.mapLabel')} />
      <aside id="basemap-notice" className="basemap-notice" hidden={!notice} role="status">
        <span id="basemap-message">{notice ? t(notice.key) : ''}</span>
        <button id="basemap-retry" type="button" onClick={() => controlsRef.current?.retryBasemap()}>
          {t('viewer.basemapRetry')}
        </button>
      </aside>
    </>
  );
}
