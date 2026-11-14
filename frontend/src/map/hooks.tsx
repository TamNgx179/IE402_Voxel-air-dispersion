/**
 * Public map extension API for panels.
 *
 *   useMapLayers(id, layers, options?)  contribute deck.gl layers
 *   useMapClick(handler, options?)      receive map clicks; `drawing: true` claims the map
 *   useIsDrawing()                      true while any drawing claim is active
 *   useMapInstance()                    { map, overlay } once the map exists, else null
 */
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MapRegistry, type LayerList, type LayerSlot, type MapClickEvent } from './registry';
import type { PickingInfo } from '@deck.gl/core';

export interface MapInstance {
  map: MapLibreMap;
  overlay: MapboxOverlay;
  /** Fit the study area like the compass button. */
  resetView(duration?: number): void;
  /** Current facade LoD level and vertex count (for export metadata). */
  renderLod(): { level: string; vertices: number };
  /** Re-render deck layers now (normally automatic on store/registry changes). */
  redraw(): void;
}

interface MapContextValue {
  registry: MapRegistry;
  instance: MapInstance | null;
  setInstance(instance: MapInstance | null): void;
}

const MapContext = createContext<MapContextValue | null>(null);

export function MapProvider({ children, registry }: { children: ReactNode; registry?: MapRegistry }) {
  const ref = useRef<MapRegistry>(registry ?? new MapRegistry());
  const [instance, setInstance] = useState<MapInstance | null>(null);
  return <MapContext.Provider value={{ registry: ref.current, instance, setInstance }}>{children}</MapContext.Provider>;
}

function useMapContext(): MapContextValue {
  const value = useContext(MapContext);
  if (!value) throw new Error('Map hooks must be used inside <MapProvider>');
  return value;
}

export function useMapRegistry(): MapRegistry {
  return useMapContext().registry;
}

/** The live MapLibre map and deck overlay, or null before creation / after unmount. */
export function useMapInstance(): MapInstance | null {
  return useMapContext().instance;
}

/** @internal used by MapView to publish the instance. */
export function useSetMapInstance() {
  return useMapContext().setInstance;
}

export interface MapLayersOptions {
  slot?: LayerSlot;
  suppressConcentration?: boolean;
  tooltip?: (info: PickingInfo) => string | null;
}

/**
 * Contribute deck.gl layers under a unique `id` (use your panel id as prefix, and
 * prefix every deck layer id too, e.g. `region-outline`). Pass a memoised array:
 * the map re-renders whenever the array identity changes. Pass `[]` or `null` to
 * contribute nothing. Contributions are removed on unmount.
 */
export function useMapLayers(id: string, layers: LayerList | null, options: MapLayersOptions = {}): void {
  const registry = useMapRegistry();
  const { slot = 'above-concentration', suppressConcentration = false, tooltip } = options;
  const tooltipRef = useRef(tooltip);
  tooltipRef.current = tooltip;
  useEffect(() => {
    registry.setLayers(id, {
      layers: layers ?? [],
      slot,
      suppressConcentration,
      tooltip: (info) => tooltipRef.current?.(info) ?? null,
    });
  }, [registry, id, layers, slot, suppressConcentration]);
  useEffect(() => () => registry.setLayers(id, null), [registry, id]);
}

export interface MapClickOptions {
  /** Only receive clicks while enabled (default true). */
  enabled?: boolean;
  /**
   * While true (and enabled), the map is in drawing mode: cell picking, building
   * picks, the pan/cell switch, exports and drag-pan are disabled, cursor is a crosshair.
   */
  drawing?: boolean;
}

/** Receive every map click while enabled. The latest `handler` is always used. */
export function useMapClick(handler: (event: MapClickEvent) => void, options: MapClickOptions = {}): void {
  const registry = useMapRegistry();
  const { enabled = true, drawing = false } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const keyRef = useRef<symbol>(Symbol('map-click'));
  useEffect(() => {
    const key = keyRef.current;
    if (!enabled) {
      registry.claim(key, null);
      return;
    }
    registry.claim(key, { handler: (event) => handlerRef.current(event), drawing });
    return () => registry.claim(key, null);
  }, [registry, enabled, drawing]);
}

/** True while any panel holds a drawing claim. */
export function useIsDrawing(): boolean {
  const registry = useMapRegistry();
  return useSyncExternalStore(registry.subscribe, () => registry.isDrawing(), () => registry.isDrawing());
}

export type { MapClickEvent, LayerSlot, LayerList } from './registry';
