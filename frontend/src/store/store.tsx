/**
 * Tiny external store (reducer + useSyncExternalStore). Components subscribe to
 * a slice with `useViewer(selector)` and only re-render when that slice changes.
 */
import { createContext, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { initialState, viewerReducer, type ViewerAction } from './reducer';
import type { ViewerState } from './types';

export interface ViewerStore {
  getState(): ViewerState;
  dispatch(action: ViewerAction): void;
  subscribe(listener: () => void): () => void;
}

export function createViewerStore(preloaded: Partial<ViewerState> = {}): ViewerStore {
  let state: ViewerState = { ...initialState, ...preloaded };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = viewerReducer(state, action);
      if (next === state) return;
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const StoreContext = createContext<ViewerStore | null>(null);

export function ViewerStoreProvider({ store, children }: { store?: ViewerStore; children: ReactNode }) {
  const ref = useRef<ViewerStore | null>(store ?? null);
  if (!ref.current) ref.current = createViewerStore();
  return <StoreContext.Provider value={ref.current}>{children}</StoreContext.Provider>;
}

export function useViewerStore(): ViewerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useViewerStore must be used inside <ViewerStoreProvider>');
  return store;
}

/**
 * Subscribe to a slice of state. The selector must return a stable value for an
 * unchanged state (select existing objects/primitives; do not build new arrays here —
 * derive them with useMemo in the component instead).
 */
export function useViewer<T>(selector: (state: ViewerState) => T): T {
  const store = useViewerStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export function useViewerDispatch(): (action: ViewerAction) => void {
  return useViewerStore().dispatch;
}
