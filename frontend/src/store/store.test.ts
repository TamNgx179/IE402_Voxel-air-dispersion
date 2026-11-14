import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api/client';
import { fakeApi } from '../test/fixtures';
import { createViewerActions, defaultRunId } from './controller';
import { createViewerStore } from './store';
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
    expect(state.thresholdsEnabled).toEqual({ who_24h: false });
    expect(state.selectedRunId).toBe('real-run');
    expect(selectCurrentRun(state)!.volume.codes.length).toBe(12);
    expect(state.status.kind).toBe('pass');
  });

  test('bootstrap failure keeps an i18n status with retry', async () => {
    const store = createViewerStore();
    const actions = createViewerActions(store, fakeApi({ '/scenarios': new ApiError('network') }));
    await actions.loadBootstrap();
    const state = store.getState();
    expect(state.bootstrap.status).toBe('error');
    expect(state.status.message!.key).toBe('viewer.statusBootstrapFailed');
    expect(state.status.kind).toBe('error');
    expect(typeof state.status.retry).toBe('function');
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

  test('exact queries load exceedance areas and the selected profile (debounced)', async () => {
    vi.useFakeTimers();
    try {
      const store = createViewerStore();
      const actions = createViewerActions(store, fakeApi());
      await actions.loadBootstrap();
      store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } });
      actions.scheduleQueries();
      expect(store.getState().queries.status).toBe('loading');
      await vi.advanceTimersByTimeAsync(200);
      const state = store.getState();
      expect(state.queries.status).toBe('idle');
      expect(state.queries.areas['real-run:0']).toEqual({ who_24h: 25 });
      expect(state.queries.profiles['real-run:1:0'].levels[0].concentration_ug_m3).toBe(12);
    } finally {
      vi.useRealTimers();
    }
  });
});
