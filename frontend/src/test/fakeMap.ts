/** A minimal MapLibre/deck stand-in for jsdom tests (no WebGL). */
import { vi } from 'vitest';
import type { MapFactory } from '../map/MapView';

export interface FakeMap {
  handlers: Map<string, Set<(event: unknown) => void>>;
  fire(type: string, event?: unknown): void;
  pitch: number;
  bearing: number;
  remove: ReturnType<typeof vi.fn>;
  dragPan: { enable: ReturnType<typeof vi.fn>; disable: ReturnType<typeof vi.fn>; enabled: boolean };
  [key: string]: unknown;
}

export function createFakeMapFactory() {
  const maps: FakeMap[] = [];
  const overlays: Array<{ setProps: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn>; props: Record<string, unknown> }> = [];
  const factory: MapFactory = ({ container, overlayProps }) => {
    const handlers = new Map<string, Set<(event: unknown) => void>>();
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);
    const map: FakeMap = {
      handlers,
      pitch: 55,
      bearing: -25,
      fire(type, event = {}) {
        handlers.get(type)?.forEach((h) => h(event));
      },
      on(type: string, handler: (event: unknown) => void) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(handler);
        return map;
      },
      off(type: string, handler: (event: unknown) => void) {
        handlers.get(type)?.delete(handler);
        return map;
      },
      once: vi.fn(),
      fitBounds: vi.fn(),
      easeTo: vi.fn((options: { pitch?: number; bearing?: number }) => {
        if (options.pitch !== undefined) map.pitch = options.pitch;
        if (options.bearing !== undefined) map.bearing = options.bearing;
        map.fire('pitch');
        map.fire('rotate');
      }),
      getCanvas: () => canvas,
      dragPan: {
        enabled: true,
        enable: vi.fn(() => (map.dragPan.enabled = true)),
        disable: vi.fn(() => (map.dragPan.enabled = false)),
      },
      queryRenderedFeatures: () => [1],
      isStyleLoaded: () => true,
      areTilesLoaded: () => true,
      setStyle: vi.fn(),
      getZoom: () => 16.2,
      getPitch: () => map.pitch,
      getBearing: () => map.bearing,
      getCenter: () => ({ lng: 106.705, lat: 10.775 }),
      getBounds: () => ({ getSouth: () => 10.77, getNorth: () => 10.78, getWest: () => 106.7, getEast: () => 106.71 }),
      removeControl: vi.fn(),
      remove: vi.fn(),
    };
    const overlay = {
      props: overlayProps as Record<string, unknown>,
      setProps: vi.fn((props: Record<string, unknown>) => Object.assign(overlay.props, props)),
      pickObject: vi.fn(() => null),
      finalize: vi.fn(),
    };
    maps.push(map);
    overlays.push(overlay);
    return { map: map as never, overlay: overlay as never };
  };
  return { factory, maps, overlays };
}
