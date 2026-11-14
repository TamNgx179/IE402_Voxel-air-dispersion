/**
 * Map contribution registry. Panels contribute deck.gl layers and claim map clicks
 * through the hooks in map/hooks.ts; the core map (MapView) reads this registry.
 */
import type { Layer, PickingInfo } from '@deck.gl/core';

/**
 * Where contributed layers are drawn, relative to the core stack
 *   water, green, roads, [below-concentration], concentration, [above-concentration],
 *   voxel grid, buildings, facades, selection, [top], wind.
 */
export type LayerSlot = 'below-concentration' | 'above-concentration' | 'top';

export type LayerList = ReadonlyArray<Layer | null | false | undefined>;

export interface LayerContribution {
  layers: LayerList;
  slot: LayerSlot;
  /** Hide the core concentration layer while this contribution is registered (e.g. comparison view). */
  suppressConcentration: boolean;
  /** Tooltip for picked objects of this contribution's layers; return null to fall through. */
  tooltip?: (info: PickingInfo) => string | null;
}

export interface MapClickEvent {
  /** [longitude, latitude] WGS84. */
  lngLat: [number, number];
  /** Screen pixel [x, y] relative to the map canvas. */
  point: [number, number];
  /** Pick the top deck.gl object under the click, optionally limited to layer ids. */
  pick(layerIds?: string[]): PickingInfo | null;
  originalEvent: MouseEvent | undefined;
}

export interface ClickClaim {
  handler: (event: MapClickEvent) => void;
  /** A drawing claim disables cell picking, building picks and drag-pan, and shows a crosshair. */
  drawing: boolean;
}

export class MapRegistry {
  private contributions = new Map<string, LayerContribution>();
  private claims = new Map<symbol, ClickClaim>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Monotonic version, bumped on every change (useSyncExternalStore snapshot). */
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }

  setLayers(id: string, contribution: LayerContribution | null) {
    if (contribution) this.contributions.set(id, contribution);
    else if (!this.contributions.delete(id)) return;
    this.emit();
  }

  layers(slot: LayerSlot): Layer[] {
    const out: Layer[] = [];
    for (const c of this.contributions.values())
      if (c.slot === slot) for (const layer of c.layers) if (layer) out.push(layer);
    return out;
  }

  concentrationSuppressed(): boolean {
    for (const c of this.contributions.values()) if (c.suppressConcentration) return true;
    return false;
  }

  tooltip(info: PickingInfo): string | null {
    for (const c of this.contributions.values()) {
      const text = c.tooltip?.(info);
      if (text) return text;
    }
    return null;
  }

  claim(key: symbol, claim: ClickClaim | null) {
    const before = this.isDrawing();
    if (claim) this.claims.set(key, claim);
    else if (!this.claims.delete(key)) return;
    // Handler identity changes do not need a re-render; drawing changes do.
    if (before !== this.isDrawing() || !claim) this.emit();
  }

  isDrawing(): boolean {
    for (const claim of this.claims.values()) if (claim.drawing) return true;
    return false;
  }

  dispatchClick(event: MapClickEvent) {
    for (const claim of [...this.claims.values()]) claim.handler(event);
  }
}
