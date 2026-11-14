/**
 * Export contributions. Panels add their state to the export with
 *
 *   useExportContribution('region', () => regionExportState ?? null);
 *
 * and the map-options panel builds the snapshot with `useReportSnapshot()()`.
 * A getter may throw an `AppError` to block the export (e.g. "wait for comparison").
 */
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../components/usePrefersReducedMotion';
import { useI18n } from '../i18n';
import { useIsDrawing, useMapInstance } from '../map/hooks';
import { useViewerStore } from '../store/store';
import { buildReport, type Report } from './report';

export type ExportTarget = 'metadata' | 'report';

interface Contribution {
  key: string;
  target: ExportTarget;
  get: () => unknown;
}

class ExportRegistry {
  private items = new Map<symbol, Contribution>();
  set(id: symbol, item: Contribution | null) {
    if (item) this.items.set(id, item);
    else this.items.delete(id);
  }
  collect(): { metadata: Record<string, unknown>; report: Record<string, unknown> } {
    const out = { metadata: {} as Record<string, unknown>, report: {} as Record<string, unknown> };
    for (const item of this.items.values()) out[item.target][item.key] = item.get();
    return out;
  }
}

const ExportContext = createContext<ExportRegistry | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const ref = useRef(new ExportRegistry());
  return <ExportContext.Provider value={ref.current}>{children}</ExportContext.Provider>;
}

function useExportRegistry() {
  const registry = useContext(ExportContext);
  if (!registry) throw new Error('Export hooks must be used inside <ExportProvider>');
  return registry;
}

/**
 * Add `getValue()` to every export under `key`: `report.metadata[key]` (default) or
 * `report[key]` with `{ target: 'report' }`. Use snake_case keys with units in the
 * name (e.g. `road_corridor`, `z_min_m`); never translate keys or values.
 */
export function useExportContribution(key: string, getValue: () => unknown, options: { target?: ExportTarget } = {}): void {
  const registry = useExportRegistry();
  const getRef = useRef(getValue);
  getRef.current = getValue;
  const idRef = useRef(Symbol(key));
  const target = options.target ?? 'metadata';
  useEffect(() => {
    const id = idRef.current;
    registry.set(id, { key, target, get: () => getRef.current() });
    return () => registry.set(id, null);
  }, [registry, key, target]);
}

/** Returns a function that builds the current report or throws an AppError. */
export function useReportSnapshot(): () => Report {
  const registry = useExportRegistry();
  const store = useViewerStore();
  const instance = useMapInstance();
  const drawing = useIsDrawing();
  const reducedMotion = usePrefersReducedMotion();
  const { t, formatNumber, locale } = useI18n();
  return useCallback(() => {
    const map = instance?.map;
    const centre = map?.getCenter();
    return buildReport({
      state: store.getState(),
      locale,
      t,
      formatNumber,
      camera: {
        longitude: centre?.lng ?? NaN,
        latitude: centre?.lat ?? NaN,
        zoom: map?.getZoom() ?? NaN,
        pitch: map?.getPitch() ?? NaN,
        bearing: map?.getBearing() ?? NaN,
      },
      attribution: Array.from(document.querySelectorAll('.maplibregl-ctrl-attrib-inner'))
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' | '),
      renderLod: instance?.renderLod() ?? null,
      drawing,
      reducedMotion,
      contributions: registry.collect(),
    });
  }, [registry, store, instance, drawing, reducedMotion, t, formatNumber, locale]);
}
