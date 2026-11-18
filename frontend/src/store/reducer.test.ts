import { describe, expect, test } from 'vitest';
import type { ProfileResult } from '../api/types';
import { initialState, profileKey, viewerReducer, type ViewerAction } from './reducer';
import {
  selectBootstrap,
  selectCurrentEntry,
  selectCurrentRun,
  selectExact,
  selectGrid,
  selectSelectedProfile,
  selectZ,
} from './selectors';
import type { BootstrapData, RunData, RunEntry, ViewerState } from './types';

/** Minimal stand-ins: the reducer and selectors only read `grid.nz` / `grid.z_centres_m` and `id`. */
const bootstrapData = (nz = 3) =>
  ({ grid: { nz, z_centres_m: Array.from({ length: nz }, (_, k) => 1 + 2 * k) } }) as unknown as BootstrapData;
const runData = (id: string) => ({ id }) as unknown as RunData;
const entry = (id: string) => ({ id, name: id }) as unknown as RunEntry;
const profile = (runId: string, i: number, j: number): ProfileResult => ({
  run_id: runId,
  i,
  j,
  units: 'ug m-3',
  centre: {},
  levels: [{ k: 0, z_m: 1, concentration_ug_m3: 7 }],
});

const reduce = (state: ViewerState, ...actions: ViewerAction[]) => actions.reduce(viewerReducer, state);
const ready = (nz = 3): ViewerState =>
  viewerReducer(initialState, { type: 'bootstrap/loaded', data: bootstrapData(nz), runs: [entry('a'), entry('b')] });

describe('viewerReducer', () => {
  test('bootstrap/loaded stores data and runs and clamps a preloaded layer to the grid', () => {
    const state = viewerReducer({ ...initialState, layer: 5 }, { type: 'bootstrap/loaded', data: bootstrapData(3), runs: [entry('a')] });
    expect(state.bootstrap).toEqual({ status: 'ready', data: bootstrapData(3), error: null });
    expect(state.runs.map((run) => run.id)).toEqual(['a']);
    expect(state.layer).toBe(2);
    expect(viewerReducer({ ...initialState, layer: 1 }, { type: 'bootstrap/loaded', data: bootstrapData(3), runs: [] }).layer).toBe(1);
  });

  test('bootstrap/failed drops data; bootstrap/retry goes back to loading and keeps the last error', () => {
    const error = new Error('offline');
    const failed = viewerReducer(ready(), { type: 'bootstrap/failed', error });
    expect(failed.bootstrap).toEqual({ status: 'error', data: null, error });
    const retrying = viewerReducer(failed, { type: 'bootstrap/retry' });
    expect(retrying.bootstrap).toEqual({ status: 'loading', data: null, error });
  });

  test('runs/added prepends new runs and ignores ids already listed', () => {
    const state = ready();
    const added = viewerReducer(state, { type: 'runs/added', entry: entry('c') });
    expect(added.runs.map((run) => run.id)).toEqual(['c', 'a', 'b']);
    expect(viewerReducer(added, { type: 'runs/added', entry: entry('a') })).toBe(added);
  });

  test('run/pending only marks the pending id; run/select commits it and clears pending', () => {
    const selected = reduce(ready(), { type: 'run/loaded', data: runData('a') }, { type: 'run/select', id: 'a' });
    const pending = viewerReducer(selected, { type: 'run/pending', id: 'b' });
    expect(pending.pendingRunId).toBe('b');
    expect(pending.selectedRunId).toBe('a');
    const committed = viewerReducer(pending, { type: 'run/select', id: 'b' });
    expect(committed).toMatchObject({ selectedRunId: 'b', pendingRunId: null });
    expect(viewerReducer(committed, { type: 'run/select', id: null })).toMatchObject({ selectedRunId: null, pendingRunId: null });
  });

  test('a late run/loaded for an older selection caches the data without touching the selection', () => {
    const state = reduce(
      ready(),
      { type: 'run/pending', id: 'a' },
      { type: 'run/pending', id: 'b' },
      { type: 'run/loaded', data: runData('b') },
      { type: 'run/select', id: 'b' },
      { type: 'run/loaded', data: runData('a') },
    );
    expect(state.selectedRunId).toBe('b');
    expect(state.pendingRunId).toBeNull();
    expect(Object.keys(state.runData).sort()).toEqual(['a', 'b']);
    expect(selectCurrentRun(state)?.id).toBe('b');
  });

  test('a late run/loaded keeps a newer pending selection pending', () => {
    const state = reduce(ready(), { type: 'run/pending', id: 'b' }, { type: 'run/loaded', data: runData('a') });
    expect(state).toMatchObject({ pendingRunId: 'b', selectedRunId: null });
  });

  test('run/loaded replaces cached data for the same id and keeps other entries', () => {
    const first = runData('a');
    const other = runData('b');
    const second = runData('a');
    const state = reduce(ready(), { type: 'run/loaded', data: first }, { type: 'run/loaded', data: other }, { type: 'run/loaded', data: second });
    expect(state.runData.a).toBe(second);
    expect(state.runData.b).toBe(other);
  });

  test('layer/set rounds and clamps to 0..nz-1 and returns the same state when unchanged', () => {
    const state = ready(3);
    expect(viewerReducer(state, { type: 'layer/set', layer: 1.6 }).layer).toBe(2);
    expect(viewerReducer(state, { type: 'layer/set', layer: 2 }).layer).toBe(2);
    expect(viewerReducer(state, { type: 'layer/set', layer: 3 }).layer).toBe(2);
    expect(viewerReducer(state, { type: 'layer/set', layer: -1 }).layer).toBe(0);
    expect(viewerReducer(state, { type: 'layer/set', layer: 0.4 })).toBe(state);
    // Without a grid only layer 0 exists.
    expect(viewerReducer(initialState, { type: 'layer/set', layer: 1 })).toBe(initialState);
  });

  test('display/set merges partial values and falls back on invalid ones', () => {
    const state = viewerReducer(ready(), { type: 'display/set', display: { multiplier: 4 } });
    expect(state.display).toEqual({ multiplier: 4, background: 0 });
    expect(viewerReducer(state, { type: 'display/set', display: { background: 12 } }).display).toEqual({ multiplier: 4, background: 12 });
    for (const multiplier of [0, -2, Number.NaN, Number.POSITIVE_INFINITY])
      expect(viewerReducer(state, { type: 'display/set', display: { multiplier } }).display.multiplier).toBe(1);
    for (const background of [-0.1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(viewerReducer(state, { type: 'display/set', display: { background } }).display.background).toBe(0);
    expect(viewerReducer(state, { type: 'display/set', display: { multiplier: 0.5, background: 0 } }).display).toEqual({ multiplier: 0.5, background: 0 });
  });

  test('cell and building selection can be set and cleared independently', () => {
    const state = reduce(ready(), { type: 'cell/select', cell: { i: 1, j: 0 } }, { type: 'building/select', id: 'bldg-1' });
    expect(state).toMatchObject({ selectedCell: { i: 1, j: 0 }, selectedBuildingId: 'bldg-1' });
    const noCell = viewerReducer(state, { type: 'cell/select', cell: null });
    expect(noCell).toMatchObject({ selectedCell: null, selectedBuildingId: 'bldg-1' });
    const noBuilding = viewerReducer(state, { type: 'building/select', id: null });
    expect(noBuilding).toMatchObject({ selectedCell: { i: 1, j: 0 }, selectedBuildingId: null });
  });

  test('mapMode/set to pan clears the selected cell, to cell keeps it', () => {
    const state = reduce(ready(), { type: 'mapMode/set', mode: 'cell' }, { type: 'cell/select', cell: { i: 0, j: 1 } }, { type: 'building/select', id: 'x' });
    expect(viewerReducer(state, { type: 'mapMode/set', mode: 'cell' }).selectedCell).toEqual({ i: 0, j: 1 });
    const pan = viewerReducer(state, { type: 'mapMode/set', mode: 'pan' });
    expect(pan).toMatchObject({ mapMode: 'pan', selectedCell: null, selectedBuildingId: 'x' });
  });

  test('panel/open opens one panel at a time and null closes it', () => {
    const open = viewerReducer(ready(), { type: 'panel/open', id: 'stats' });
    expect(open.activePanel).toBe('stats');
    expect(viewerReducer(open, { type: 'panel/open', id: 'simulation' }).activePanel).toBe('simulation');
    expect(viewerReducer(open, { type: 'panel/open', id: null }).activePanel).toBeNull();
  });

  test('layers/set, wind/paused, basemap/set and status/set update only their field', () => {
    const state = ready();
    const roads = viewerReducer(state, { type: 'layers/set', layer: 'roads', visible: true });
    expect(roads.layers).toEqual({ ...state.layers, roads: true });
    expect(viewerReducer(roads, { type: 'layers/set', layer: 'buildings', visible: false }).layers).toEqual({ ...state.layers, roads: true, buildings: false });
    expect(viewerReducer(state, { type: 'wind/paused', paused: true }).windPaused).toBe(true);
    expect(viewerReducer(state, { type: 'basemap/set', basemap: 'raster' }).basemap).toBe('raster');
    const status = { message: { key: 'viewer.statusResultLoaded' as const }, kind: 'pass' as const };
    expect(viewerReducer(state, { type: 'status/set', status }).status).toBe(status);
  });

  test('queries/* move between idle, loading and error and keep loaded profiles', () => {
    const error = new Error('boom');
    const loading = viewerReducer(ready(), { type: 'queries/loading' });
    expect(loading.queries).toEqual({ profiles: {}, status: 'loading', error: null });
    const withProfile = viewerReducer(loading, { type: 'queries/profile', runId: 'a', profile: profile('a', 1, 0) });
    expect(withProfile.queries.status).toBe('loading');
    expect(Object.keys(withProfile.queries.profiles)).toEqual(['a:1:0']);
    const failed = viewerReducer(withProfile, { type: 'queries/failed', error });
    expect(failed.queries).toMatchObject({ status: 'error', error });
    expect(failed.queries.profiles).toBe(withProfile.queries.profiles);
    // A new load clears the previous error.
    expect(viewerReducer(failed, { type: 'queries/loading' }).queries).toMatchObject({ status: 'loading', error: null });
    const done = viewerReducer(failed, { type: 'queries/done' });
    expect(done.queries).toMatchObject({ status: 'idle', error: null });
    expect(done.queries.profiles['a:1:0'].i).toBe(1);
  });

  test('queries/profile keys profiles by run and cell and overwrites the same key', () => {
    const first = profile('a', 1, 0);
    const replaced = profile('a', 1, 0);
    const state = reduce(
      ready(),
      { type: 'queries/profile', runId: 'a', profile: first },
      { type: 'queries/profile', runId: 'b', profile: profile('b', 1, 0) },
      { type: 'queries/profile', runId: 'a', profile: profile('a', 0, 1) },
      { type: 'queries/profile', runId: 'a', profile: replaced },
    );
    expect(Object.keys(state.queries.profiles).sort()).toEqual(['a:0:1', 'a:1:0', 'b:1:0']);
    expect(state.queries.profiles['a:1:0']).toBe(replaced);
  });

  test('unknown actions return the same state', () => {
    const state = ready();
    expect(viewerReducer(state, { type: 'nope' } as unknown as ViewerAction)).toBe(state);
  });

  test('does not mutate the previous state and keeps unchanged slices by identity', () => {
    const before = reduce(
      ready(),
      { type: 'run/loaded', data: runData('a') },
      { type: 'queries/profile', runId: 'a', profile: profile('a', 0, 0) },
      { type: 'cell/select', cell: { i: 0, j: 0 } },
    );
    const snapshot = structuredClone({ ...before, bootstrap: { ...before.bootstrap, data: null } });
    const actions: ViewerAction[] = [
      { type: 'runs/added', entry: entry('c') },
      { type: 'run/pending', id: 'b' },
      { type: 'run/loaded', data: runData('b') },
      { type: 'run/select', id: 'b' },
      { type: 'layer/set', layer: 2 },
      { type: 'display/set', display: { multiplier: 3 } },
      { type: 'display/reset' },
      { type: 'cell/select', cell: { i: 1, j: 1 } },
      { type: 'building/select', id: 'x' },
      { type: 'mapMode/set', mode: 'pan' },
      { type: 'panel/open', id: 'stats' },
      { type: 'layers/set', layer: 'grid', visible: false },
      { type: 'wind/paused', paused: true },
      { type: 'basemap/set', basemap: 'raster' },
      { type: 'queries/loading' },
      { type: 'queries/profile', runId: 'b', profile: profile('b', 1, 1) },
      { type: 'queries/done' },
      { type: 'queries/failed', error: 'x' },
      { type: 'status/set', status: { message: null, kind: 'info' } },
      { type: 'bootstrap/failed', error: 'x' },
      { type: 'bootstrap/retry' },
    ];
    for (const action of actions) {
      const next = viewerReducer(before, action);
      expect(next, action.type).not.toBe(before);
      // Slices the action does not own are shared, not copied.
      if (!action.type.startsWith('run')) expect(next.runData, action.type).toBe(before.runData);
      if (!action.type.startsWith('queries')) expect(next.queries, action.type).toBe(before.queries);
      if (action.type !== 'layers/set') expect(next.layers, action.type).toBe(before.layers);
      if (!action.type.startsWith('display')) expect(next.display, action.type).toBe(before.display);
      if (!action.type.startsWith('bootstrap')) expect(next.bootstrap, action.type).toBe(before.bootstrap);
    }
    expect({ ...before, bootstrap: { ...before.bootstrap, data: null } }).toEqual(snapshot);
    expect(before.bootstrap.data).toEqual(bootstrapData(3));
  });

  test('initialState is never mutated by reducing from it', () => {
    const snapshot = structuredClone(initialState);
    reduce(initialState, { type: 'layers/set', layer: 'roads', visible: true }, { type: 'display/set', display: { multiplier: 2 } }, { type: 'queries/profile', runId: 'a', profile: profile('a', 0, 0) });
    expect(initialState).toEqual(snapshot);
  });
});

describe('profileKey', () => {
  test('joins run id and cell indices', () => {
    expect(profileKey('real-run', 1, 0)).toBe('real-run:1:0');
    // The separator keeps (i, j) pairs with the same digits apart.
    expect(profileKey('a', 1, 23)).not.toBe(profileKey('a', 12, 3));
    expect(profileKey('a', 1, 0)).not.toBe(profileKey('a', 0, 1));
  });
});

describe('selectors', () => {
  test('selectBootstrap and selectGrid are null before bootstrap', () => {
    expect(selectBootstrap(initialState)).toBeNull();
    expect(selectGrid(initialState)).toBeNull();
    const state = ready();
    expect(selectBootstrap(state)).toBe(state.bootstrap.data);
    expect(selectGrid(state)).toBe(state.bootstrap.data!.grid);
  });

  test('selectCurrentRun needs both a selection and loaded data', () => {
    const state = ready();
    expect(selectCurrentRun(state)).toBeNull();
    expect(selectCurrentRun({ ...state, selectedRunId: 'a' })).toBeNull();
    const loaded = viewerReducer(state, { type: 'run/loaded', data: runData('a') });
    expect(selectCurrentRun(loaded)).toBeNull();
    expect(selectCurrentRun({ ...loaded, selectedRunId: 'a' })).toBe(loaded.runData.a);
  });

  test('selectCurrentEntry finds the selected entry in the run list', () => {
    const state = ready();
    expect(selectCurrentEntry(state)).toBeNull();
    expect(selectCurrentEntry({ ...state, selectedRunId: 'b' })).toBe(state.runs[1]);
    expect(selectCurrentEntry({ ...state, selectedRunId: 'missing' })).toBeNull();
  });

  test('selectExact is true only for multiplier 1 and background 0', () => {
    expect(selectExact(initialState)).toBe(true);
    expect(selectExact({ ...initialState, display: { multiplier: 1, background: 0.5 } })).toBe(false);
    expect(selectExact({ ...initialState, display: { multiplier: 1.01, background: 0 } })).toBe(false);
  });

  test('selectZ returns the centre height of the layer and 0 without a grid or out of range', () => {
    expect(selectZ(initialState)).toBe(0);
    const state = ready(3);
    expect(selectZ(state)).toBe(1);
    expect(selectZ(viewerReducer(state, { type: 'layer/set', layer: 2 }))).toBe(5);
    expect(selectZ({ ...state, layer: 7 })).toBe(0);
  });

  test('selectSelectedProfile needs a run, a cell and a loaded profile for that pair', () => {
    const state = reduce(ready(), { type: 'queries/profile', runId: 'a', profile: profile('a', 1, 0) });
    expect(selectSelectedProfile(state)).toBeUndefined();
    expect(selectSelectedProfile({ ...state, selectedRunId: 'a' })).toBeUndefined();
    expect(selectSelectedProfile({ ...state, selectedCell: { i: 1, j: 0 } })).toBeUndefined();
    expect(selectSelectedProfile({ ...state, selectedRunId: 'a', selectedCell: { i: 1, j: 0 } })).toBe(state.queries.profiles['a:1:0']);
    // Same cell, other run (or other cell, same run): not loaded.
    expect(selectSelectedProfile({ ...state, selectedRunId: 'b', selectedCell: { i: 1, j: 0 } })).toBeUndefined();
    expect(selectSelectedProfile({ ...state, selectedRunId: 'a', selectedCell: { i: 0, j: 1 } })).toBeUndefined();
  });

  test('selectSelectedProfile works for cell 0,0', () => {
    const state = reduce(ready(), { type: 'queries/profile', runId: 'a', profile: profile('a', 0, 0) }, { type: 'cell/select', cell: { i: 0, j: 0 } });
    expect(selectSelectedProfile({ ...state, selectedRunId: 'a' })?.i).toBe(0);
  });

  test('selectors return the same references for an unchanged state', () => {
    const state = reduce(
      ready(),
      { type: 'run/loaded', data: runData('a') },
      { type: 'run/select', id: 'a' },
      { type: 'queries/profile', runId: 'a', profile: profile('a', 0, 0) },
      { type: 'cell/select', cell: { i: 0, j: 0 } },
    );
    for (const select of [selectBootstrap, selectGrid, selectCurrentRun, selectCurrentEntry, selectSelectedProfile])
      expect(select(state)).toBe(select(state));
  });
});
