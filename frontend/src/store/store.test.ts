import { createElement, type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api/client';
import { fakeApi, routedApi } from '../test/fixtures';
import { createViewerActions, defaultRunId } from '../app/viewerFacade';
import { initialState } from './reducer';
import { createViewerStore, useViewer, useViewerDispatch, useViewerStore, ViewerStoreProvider, type ViewerStore } from './store';
import { selectCurrentRun, selectExact } from './selectors';
import type { RunEntry } from './types';

describe('viewer store', () => {
  test('default run prefers a real FV run over a mock run', () => {
    const entries = [
      { id: 'a', model: 'fv', warnings: ['mock run'] },
      { id: 'b', model: 'gaussian', warnings: [] },
      { id: 'c', model: 'fv', warnings: [] },
    ] as unknown as RunEntry[];
    expect(defaultRunId(entries)).toBe('c');
    expect(defaultRunId(entries.slice(0, 2))).toBe('a');
    expect(defaultRunId([])).toBeNull();
  });

  test('bootstrap loads, selects the default run and enables nothing by default', async () => {
    const store = createViewerStore();
    const actions = createViewerActions(store, fakeApi());
    await actions.loadBootstrap();
    const state = store.getState();
    expect(state.bootstrap.status).toBe('ready');
    expect(state.bootstrap.data!.grid.z_centres_m).toEqual([1, 3, 5]);
    expect(state.selectedRunId).toBe('real-run');
    expect(selectCurrentRun(state)!.volume.codes.length).toBe(12);
    expect(state.status.kind).toBe('pass');
  });

  test('bootstrap keeps the failure available while retrying', async () => {
    const store = createViewerStore();
    const error = new ApiError('network');
    const actions = createViewerActions(store, fakeApi({ '/scenarios': error }));
    await actions.loadBootstrap();
    expect(store.getState().bootstrap).toMatchObject({ status: 'error', error });
    const retry = actions.loadBootstrap();
    expect(store.getState().bootstrap).toMatchObject({ status: 'loading', error });
    await retry;
    expect(store.getState().bootstrap).toMatchObject({ status: 'error', error });
  });

  test('switching runs preserves layer, cell, toggles and display state', async () => {
    const store = createViewerStore();
    const actions = createViewerActions(store, fakeApi());
    await actions.loadBootstrap();
    store.dispatch({ type: 'layer/set', layer: 2 });
    store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } });
    store.dispatch({ type: 'layers/set', layer: 'roads', visible: true });
    await actions.selectResult('mock-run');
    const state = store.getState();
    expect(state.selectedRunId).toBe('mock-run');
    expect(state.layer).toBe(2);
    expect(state.selectedCell).toEqual({ i: 1, j: 0 });
    expect(state.layers.roads).toBe(true);
  });

  test('last selection wins and cached runs are not refetched', async () => {
    const store = createViewerStore();
    const api = fakeApi();
    const actions = createViewerActions(store, api);
    await actions.loadBootstrap();
    const first = actions.selectResult('mock-run');
    const second = actions.selectResult('real-run');
    await Promise.all([first, second]);
    expect(store.getState().selectedRunId).toBe('real-run');
    const volumeCalls = api.calls.filter((c) => c === '/runs/real-run/volume').length;
    await actions.selectResult('real-run');
    expect(api.calls.filter((c) => c === '/runs/real-run/volume').length).toBe(volumeCalls);
  });

  test('unknown runs are rejected with a translatable error', async () => {
    const store = createViewerStore();
    const actions = createViewerActions(store, fakeApi());
    await actions.loadBootstrap();
    await expect(actions.ensureRun('nope')).rejects.toMatchObject({ messageKey: 'errors.runNotFound' });
  });

  test('reducer clamps layer and sanitises display values', () => {
    const store = createViewerStore();
    store.dispatch({ type: 'display/set', display: { multiplier: 10, background: -4 } });
    expect(store.getState().display).toEqual({ multiplier: 10, background: 0 });
    expect(selectExact(store.getState())).toBe(false);
    store.dispatch({ type: 'display/reset' });
    expect(selectExact(store.getState())).toBe(true);
    store.dispatch({ type: 'layer/set', layer: 99 });
    expect(store.getState().layer).toBe(0);
  });

  test('exact queries only load the selected profile (debounced)', async () => {
    vi.useFakeTimers();
    try {
      const store = createViewerStore();
      const api = fakeApi();
      const actions = createViewerActions(store, api);
      await actions.loadBootstrap();
      actions.scheduleQueries();
      await vi.advanceTimersByTimeAsync(200);
      expect(api.calls.some((path) => path.includes('exceedance') || path === '/thresholds')).toBe(false);
      store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } });
      actions.scheduleQueries();
      expect(store.getState().queries.status).toBe('loading');
      await vi.advanceTimersByTimeAsync(200);
      const state = store.getState();
      expect(state.queries.status).toBe('idle');
      expect(state.queries.profiles['real-run:1:0'].levels[0].concentration_ug_m3).toBe(12);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a late response for an older selection does not override the newer one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const base = fakeApi();
    const api = routedApi(/^\/runs\/mock-run\//, async (path, options) => {
      await gate;
      return base(path, options);
    }, base);
    const store = createViewerStore();
    const actions = createViewerActions(store, api);
    await actions.loadBootstrap();
    expect(store.getState().selectedRunId).toBe('real-run');
    const stale = actions.selectResult('mock-run');
    expect(store.getState().pendingRunId).toBe('mock-run');
    await actions.selectResult('real-run');
    expect(store.getState()).toMatchObject({ selectedRunId: 'real-run', pendingRunId: null });
    release();
    await stale;
    const state = store.getState();
    expect(state).toMatchObject({ selectedRunId: 'real-run', pendingRunId: null });
    // The stale data is still cached for a later selection.
    expect(state.runData['mock-run']).toBeDefined();
  });

  test('a late failure for an older selection does not clear the newer pending run', async () => {
    let fail!: () => void;
    const gate = new Promise<void>((_, reject) => (fail = () => reject(new ApiError('network'))));
    let releaseNew!: () => void;
    const newGate = new Promise<void>((resolve) => (releaseNew = resolve));
    const base = fakeApi();
    const store = createViewerStore();
    const actions = createViewerActions(
      store,
      routedApi(/^\/runs\/(mock|new)-run\//, async (path, options) => {
        await (path.includes('mock-run') ? gate : newGate);
        return base(path, options);
      }, base),
    );
    await actions.loadBootstrap();
    store.dispatch({ type: 'runs/added', entry: { ...store.getState().runs[0], id: 'new-run' } });
    const stale = actions.selectResult('mock-run');
    const newer = actions.selectResult('new-run');
    fail();
    await stale;
    expect(store.getState()).toMatchObject({ selectedRunId: 'real-run', pendingRunId: 'new-run' });
    expect(store.getState().status.kind).toBe('info');
    releaseNew();
    await newer;
    expect(store.getState()).toMatchObject({ selectedRunId: 'new-run', pendingRunId: null });
  });

  test('a failed selection clears pending, keeps the shown run and offers a retry', async () => {
    const store = createViewerStore();
    const actions = createViewerActions(store, fakeApi({ '/runs/mock-run/volume': new ApiError('network') }));
    await actions.loadBootstrap();
    await actions.selectResult('mock-run');
    const state = store.getState();
    expect(state).toMatchObject({ selectedRunId: 'real-run', pendingRunId: null });
    expect(state.status).toMatchObject({ kind: 'error', message: { key: 'viewer.statusResultFailed' } });
    expect(typeof state.status.retry).toBe('function');
  });
});

describe('createViewerStore', () => {
  test('merges preloaded state over the initial state', () => {
    const store = createViewerStore({ layer: 2, basemap: 'raster' });
    expect(store.getState()).toEqual({ ...initialState, layer: 2, basemap: 'raster' });
    expect(store.getState().layers).toBe(initialState.layers);
  });

  test('notifies subscribers only when the state changes and stops after unsubscribe', () => {
    const store = createViewerStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const entry = { id: 'x' } as unknown as RunEntry;
    store.dispatch({ type: 'layer/set', layer: 0 });
    store.dispatch({ type: 'runs/added', entry });
    store.dispatch({ type: 'runs/added', entry });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.dispatch({ type: 'panel/open', id: 'stats' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().activePanel).toBe('stats');
  });

  test('every subscriber is notified and the same listener is registered once', () => {
    const store = createViewerStore();
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe(a);
    store.subscribe(a);
    store.subscribe(b);
    store.dispatch({ type: 'wind/paused', paused: true });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('store hooks', () => {
  const wrapper = (store?: ViewerStore) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(ViewerStoreProvider, { store, children });
    };

  test('useViewerStore throws outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useViewerStore())).toThrow('useViewerStore must be used inside <ViewerStoreProvider>');
    } finally {
      spy.mockRestore();
    }
  });

  test('the provider uses the given store, or creates one that survives re-renders', () => {
    const store = createViewerStore();
    expect(renderHook(() => useViewerStore(), { wrapper: wrapper(store) }).result.current).toBe(store);
    const own = renderHook(() => useViewerStore(), { wrapper: wrapper() });
    const first = own.result.current;
    expect(first.getState()).toEqual(initialState);
    own.rerender();
    expect(own.result.current).toBe(first);
  });

  test('useViewer re-renders on its slice and useViewerDispatch dispatches to the store', () => {
    const store = createViewerStore();
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return { panel: useViewer((s) => s.activePanel), dispatch: useViewerDispatch() };
      },
      { wrapper: wrapper(store) },
    );
    expect(result.current.panel).toBeNull();
    act(() => result.current.dispatch({ type: 'panel/open', id: 'stats' }));
    expect(result.current.panel).toBe('stats');
    expect(store.getState().activePanel).toBe('stats');
    const count = renders;
    // A change to another slice does not re-render this subscriber.
    act(() => store.dispatch({ type: 'basemap/set', basemap: 'raster' }));
    expect(renders).toBe(count);
  });
});
