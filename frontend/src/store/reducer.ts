/**
 * Viewer actions. All state changes go through `dispatch(action)`; async work
 * (fetching runs, exact queries) lives in store/controller.ts and dispatches these.
 */
import type { ProfileResult } from '../api/types';
import type { Cell } from '../lib/grid';
import type {
  Basemap,
  BootstrapData,
  Display,
  LayerToggles,
  MapMode,
  RunData,
  RunEntry,
  StatusState,
  ViewerState,
} from './types';

export type ViewerAction =
  /** Start-up data arrived; `runs` fill the result select, `selectedRunId` is the initial choice. */
  | { type: 'bootstrap/loaded'; data: BootstrapData; runs: RunEntry[] }
  | { type: 'bootstrap/failed'; error: unknown }
  | { type: 'bootstrap/retry' }
  /** A run finished (e.g. created by the simulation panel); prepended if not listed. */
  | { type: 'runs/added'; entry: RunEntry }
  /** Selection started: data is being fetched (select shows aria-busy). */
  | { type: 'run/pending'; id: string | null }
  /** Run data is cached; does not change the selection. */
  | { type: 'run/loaded'; data: RunData }
  /** Show this (already loaded) run. Keeps layer, cell, display and toggles. */
  | { type: 'run/select'; id: string | null }
  | { type: 'layer/set'; layer: number }
  | { type: 'display/set'; display: Partial<Display> }
  | { type: 'display/reset' }
  | { type: 'threshold/toggle'; key: string; enabled: boolean }
  | { type: 'cell/select'; cell: Cell | null }
  | { type: 'building/select'; id: string | null }
  | { type: 'mapMode/set'; mode: MapMode }
  /** Open a tool panel by registry id, or close all with null. */
  | { type: 'panel/open'; id: string | null }
  | { type: 'layers/set'; layer: keyof LayerToggles; visible: boolean }
  | { type: 'wind/paused'; paused: boolean }
  | { type: 'basemap/set'; basemap: Basemap }
  | { type: 'queries/loading' }
  | { type: 'queries/area'; runId: string; k: number; areas: Record<string, number> }
  | { type: 'queries/profile'; runId: string; profile: ProfileResult }
  | { type: 'queries/done' }
  | { type: 'queries/failed'; error: unknown }
  | { type: 'status/set'; status: StatusState };

export const initialState: ViewerState = {
  bootstrap: { status: 'loading', data: null, error: null },
  runs: [],
  selectedRunId: null,
  pendingRunId: null,
  runData: {},
  layer: 0,
  display: { multiplier: 1, background: 0 },
  thresholdsEnabled: {},
  selectedCell: null,
  selectedBuildingId: null,
  mapMode: 'pan',
  activePanel: null,
  layers: { buildings: true, facades: true, roads: false, wind: true, grid: true },
  windPaused: false,
  basemap: 'vector',
  queries: { areas: {}, profiles: {}, status: 'idle', error: null },
  status: { message: { key: 'viewer.statusLoadingLibraries' }, kind: 'info' },
};

export const areaKey = (runId: string, k: number) => `${runId}:${k}`;
export const profileKey = (runId: string, i: number, j: number) => `${runId}:${i}:${j}`;

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'bootstrap/loaded':
      return {
        ...state,
        bootstrap: { status: 'ready', data: action.data, error: null },
        runs: action.runs,
        layer: Math.min(state.layer, action.data.grid.nz - 1),
        thresholdsEnabled: Object.fromEntries(Object.keys(action.data.thresholds).map((key) => [key, false])),
      };
    case 'bootstrap/failed':
      return { ...state, bootstrap: { status: 'error', data: null, error: action.error } };
    case 'bootstrap/retry':
      return { ...state, bootstrap: { status: 'loading', data: null, error: null } };
    case 'runs/added':
      if (state.runs.some((run) => run.id === action.entry.id)) return state;
      return { ...state, runs: [action.entry, ...state.runs] };
    case 'run/pending':
      return { ...state, pendingRunId: action.id };
    case 'run/loaded':
      return { ...state, runData: { ...state.runData, [action.data.id]: action.data } };
    case 'run/select':
      return { ...state, selectedRunId: action.id, pendingRunId: null };
    case 'layer/set': {
      const nz = state.bootstrap.data?.grid.nz ?? 1;
      const layer = Math.max(0, Math.min(nz - 1, Math.round(action.layer)));
      return layer === state.layer ? state : { ...state, layer };
    }
    case 'display/set': {
      const next = { ...state.display, ...action.display };
      if (!Number.isFinite(next.multiplier) || next.multiplier <= 0) next.multiplier = 1;
      if (!Number.isFinite(next.background) || next.background < 0) next.background = 0;
      return { ...state, display: next };
    }
    case 'display/reset':
      return { ...state, display: { multiplier: 1, background: 0 } };
    case 'threshold/toggle':
      return { ...state, thresholdsEnabled: { ...state.thresholdsEnabled, [action.key]: action.enabled } };
    case 'cell/select':
      return { ...state, selectedCell: action.cell };
    case 'building/select':
      return { ...state, selectedBuildingId: action.id };
    case 'mapMode/set':
      return { ...state, mapMode: action.mode };
    case 'panel/open':
      return { ...state, activePanel: action.id };
    case 'layers/set':
      return { ...state, layers: { ...state.layers, [action.layer]: action.visible } };
    case 'wind/paused':
      return { ...state, windPaused: action.paused };
    case 'basemap/set':
      return { ...state, basemap: action.basemap };
    case 'queries/loading':
      return { ...state, queries: { ...state.queries, status: 'loading', error: null } };
    case 'queries/area':
      return {
        ...state,
        queries: { ...state.queries, areas: { ...state.queries.areas, [areaKey(action.runId, action.k)]: action.areas } },
      };
    case 'queries/profile':
      return {
        ...state,
        queries: {
          ...state.queries,
          profiles: {
            ...state.queries.profiles,
            [profileKey(action.runId, action.profile.i, action.profile.j)]: action.profile,
          },
        },
      };
    case 'queries/done':
      return { ...state, queries: { ...state.queries, status: 'idle', error: null } };
    case 'queries/failed':
      return { ...state, queries: { ...state.queries, status: 'error', error: action.error } };
    case 'status/set':
      return { ...state, status: action.status };
    default:
      return state;
  }
}
