/**
 * Async viewer operations (bootstrap, run loading/selection, exact queries).
 * Panels call these through `useViewerActions()`; they only dispatch reducer actions.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AppError, api as defaultApi, type RequestOptions } from '../api/client';
import type {
  ArtifactList,
  ExceedanceResult,
  ProfileResult,
  RunListItem,
  RunSummary,
  RunView,
  Scenario,
  Scene,
  StudyArea,
  Threshold,
  VolumePayload,
  WindField,
} from '../api/types';
import { decodeVolume } from '../lib/concentration';
import { dataQuality } from '../lib/evidence';
import { cornersFromBounds, zCentres } from '../lib/grid';
import { isMockRun } from '../lib/labels';
import { areaKey, profileKey } from './reducer';
import { useViewerStore, type ViewerStore } from './store';
import type { BootstrapData, RunData, RunEntry } from './types';

export type ApiFn = <T>(path: string, options?: RequestOptions) => Promise<T>;

export interface ViewerActions {
  /** (Re)load study area, scenarios, thresholds, runs and scene, then show the default run. */
  loadBootstrap(): Promise<void>;
  /** Load (cached) and show a run. Concurrent calls: the last one wins. */
  selectResult(id: string): Promise<void>;
  /** Load and cache a run's volume/summary/wind without selecting it (e.g. for comparison). */
  ensureRun(id: string): Promise<RunData>;
  /** Add a newly succeeded run to the select and show it (used by the simulation panel). */
  addCompletedRun(run: RunView): Promise<void>;
  /** Re-run the failed exceedance/profile queries for the current view. */
  retryQueries(): void;
}

export function runEntryFromList(run: RunListItem): RunEntry {
  return {
    id: run.run_id,
    scenario_id: run.scenario_id,
    name: run.scenario_name,
    emission_multiplier: run.emission_multiplier ?? 1,
    wind_from_deg: run.wind_from_deg,
    wind_speed_m_s: run.wind_speed_m_s,
    model: run.model,
    model_version: run.model_version,
    warnings: run.warnings || [],
  };
}

export function runEntryFromView(run: RunView): RunEntry {
  return {
    id: run.run_id,
    scenario_id: run.scenario.id,
    name: run.scenario.name,
    emission_multiplier: run.emission_multiplier ?? 1,
    wind_from_deg: run.scenario.wind_from_deg,
    wind_speed_m_s: run.scenario.wind_speed_m_s,
    model: run.model,
    model_version: run.model_version,
    warnings: run.warnings || [],
  };
}

/** Prefer a real (non-mock) FV run, then any FV run, then the first run (legacy main()). */
export function defaultRunId(runs: RunEntry[]): string | null {
  return (
    runs.find((run) => run.model === 'fv' && !isMockRun(run))?.id ||
    runs.find((run) => run.model === 'fv')?.id ||
    runs[0]?.id ||
    null
  );
}

export async function fetchBootstrap(api: ApiFn): Promise<{ data: BootstrapData; runs: RunEntry[] }> {
  const [areas, scenarios, thresholds, runs] = await Promise.all([
    api<StudyArea[]>('/study-areas'),
    api<Scenario[]>('/scenarios'),
    api<Threshold[]>('/thresholds'),
    api<RunListItem[]>('/runs?status=succeeded&limit=20'),
  ]);
  if (!areas.length) throw new AppError('errors.noStudyArea');
  const area = areas[0];
  const scene = await api<Scene>(`/study-areas/${area.id}/scene`);
  const grid = { ...area.grid, z_centres_m: zCentres(area.grid) };
  return {
    data: {
      area,
      grid,
      corners: cornersFromBounds(area.bounds),
      scenarios,
      thresholds: Object.fromEntries(thresholds.map((item) => [item.key, { value: item.value_ug_m3, label: item.label }])),
      scene,
      provenance: area.provenance || {},
      quality: dataQuality(scene.buildings, area.provenance || {}),
    },
    runs: runs.map(runEntryFromList),
  };
}

export async function fetchRun(api: ApiFn, id: string): Promise<RunData> {
  const [payload, summary, windField] = await Promise.all([
    api<VolumePayload>(`/runs/${id}/volume`),
    api<RunSummary>(`/runs/${id}/summary`),
    api<ArtifactList>(`/runs/${id}/artifacts`)
      .then(async (result) => {
        const artifact = result.artifacts.find((item) => item.kind === 'wind_vectors');
        if (!artifact) return null;
        const field = await api<WindField>(`/runs/${id}/artifacts/wind_vectors/download`);
        if (field.run_id !== id || field.units !== 'm s-1') throw new AppError('errors.windMismatch');
        return field;
      })
      // The wind overlay is optional; a missing or mismatched field only hides it.
      .catch(() => null),
  ]);
  return { id, volume: decodeVolume(payload), summary, windField };
}

export function createViewerActions(store: ViewerStore, api: ApiFn): ViewerActions & { scheduleQueries(): void; dispose(): void } {
  const inflight = new Map<string, Promise<RunData>>();
  let selection = 0;
  let bootstrapToken = 0;
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  const { dispatch, getState } = store;

  function ensureRun(id: string): Promise<RunData> {
    const cached = getState().runData[id];
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(id);
    if (pending) return pending;
    if (!getState().runs.some((run) => run.id === id)) return Promise.reject(new AppError('errors.runNotFound', { id }));
    const promise = fetchRun(api, id)
      .then((data) => {
        dispatch({ type: 'run/loaded', data });
        return data;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, promise);
    return promise;
  }

  async function selectResult(id: string) {
    const token = ++selection;
    dispatch({ type: 'run/pending', id });
    if (!getState().runData[id]) dispatch({ type: 'status/set', status: { message: { key: 'viewer.statusLoadingResult' }, kind: 'info' } });
    try {
      await ensureRun(id);
      if (token !== selection) return;
      dispatch({ type: 'run/select', id });
      dispatch({ type: 'status/set', status: { message: { key: 'viewer.statusResultLoaded' }, kind: 'pass' } });
    } catch (error) {
      if (token !== selection) return;
      dispatch({ type: 'run/pending', id: null });
      dispatch({
        type: 'status/set',
        status: {
          message: { key: 'viewer.statusResultFailed' },
          kind: 'error',
          retry: () => void selectResult(id),
          error,
        },
      });
    }
  }

  async function loadBootstrap() {
    const token = ++bootstrapToken;
    dispatch({ type: 'bootstrap/retry' });
    dispatch({ type: 'status/set', status: { message: { key: 'viewer.statusLoadingLibraries' }, kind: 'info' } });
    let result: Awaited<ReturnType<typeof fetchBootstrap>>;
    try {
      result = await fetchBootstrap(api);
    } catch (error) {
      if (token !== bootstrapToken) return;
      dispatch({ type: 'bootstrap/failed', error });
      dispatch({
        type: 'status/set',
        status: { message: { key: 'viewer.statusBootstrapFailed' }, kind: 'error', retry: () => void loadBootstrap(), error },
      });
      return;
    }
    if (token !== bootstrapToken) return;
    dispatch({ type: 'bootstrap/loaded', data: result.data, runs: result.runs });
    const id = defaultRunId(result.runs);
    if (id) await selectResult(id);
    else dispatch({ type: 'status/set', status: { message: { key: 'viewer.statusChooseScenario' }, kind: 'info' } });
  }

  async function addCompletedRun(run: RunView) {
    dispatch({ type: 'runs/added', entry: runEntryFromView(run) });
    await selectResult(run.run_id);
  }

  /** Debounced exceedance areas for the layer and the selected cell's profile (exact mode only). */
  function scheduleQueries() {
    clearTimeout(queryTimer);
    const state = getState();
    const data = state.bootstrap.data;
    const id = state.selectedRunId;
    const exact = state.display.multiplier === 1 && state.display.background === 0;
    if (!data || !id || !state.runData[id] || !exact) {
      if (state.queries.status !== 'idle') dispatch({ type: 'queries/done' });
      return;
    }
    const k = state.layer;
    const cell = state.selectedCell && { ...state.selectedCell };
    const needArea = !state.queries.areas[areaKey(id, k)];
    const needProfile = Boolean(cell && !state.queries.profiles[profileKey(id, cell.i, cell.j)]);
    if (!needArea && !needProfile) {
      if (state.queries.status !== 'idle') dispatch({ type: 'queries/done' });
      return;
    }
    dispatch({ type: 'queries/loading' });
    const stale = () => {
      const s = getState();
      return (
        s.selectedRunId !== id ||
        s.layer !== k ||
        s.display.multiplier !== 1 ||
        s.display.background !== 0 ||
        (cell !== null && (s.selectedCell?.i !== cell.i || s.selectedCell?.j !== cell.j))
      );
    };
    queryTimer = setTimeout(async () => {
      try {
        const requests: Array<Promise<unknown>> = [];
        if (needArea)
          requests.push(
            Promise.all(
              Object.keys(data.thresholds).map(async (key) => {
                const result = await api<ExceedanceResult>(
                  `/runs/${id}/exceedance?z_m=${data.grid.z_centres_m[k]}&threshold_key=${encodeURIComponent(key)}`,
                );
                return [key, result.area_m2] as const;
              }),
            ).then((entries) => dispatch({ type: 'queries/area', runId: id, k, areas: Object.fromEntries(entries) })),
          );
        if (cell && needProfile)
          requests.push(
            api<ProfileResult>(`/runs/${id}/profile?i=${cell.i}&j=${cell.j}`).then((profile) =>
              dispatch({ type: 'queries/profile', runId: id, profile }),
            ),
          );
        await Promise.all(requests);
        if (stale()) return;
        dispatch({ type: 'queries/done' });
      } catch (error) {
        if (stale()) return;
        dispatch({ type: 'queries/failed', error });
      }
    }, 180);
  }

  return {
    loadBootstrap,
    selectResult,
    ensureRun,
    addCompletedRun,
    retryQueries: scheduleQueries,
    scheduleQueries,
    dispose: () => clearTimeout(queryTimer),
  };
}

const ActionsContext = createContext<ViewerActions | null>(null);

/**
 * Provides `useViewerActions()`, loads the bootstrap once on mount and keeps the
 * exact queries in sync with run/layer/cell/display.
 */
export function ViewerActionsProvider({ children, api = defaultApi, autoLoad = true }: { children: ReactNode; api?: ApiFn; autoLoad?: boolean }) {
  const store = useViewerStore();
  const actionsRef = useRef<ReturnType<typeof createViewerActions> | null>(null);
  if (!actionsRef.current) actionsRef.current = createViewerActions(store, api);
  const actions = actionsRef.current;

  useEffect(() => {
    if (autoLoad) void actions.loadBootstrap();
    return () => actions.dispose();
  }, [actions, autoLoad]);

  useEffect(() => {
    let previous = store.getState();
    return store.subscribe(() => {
      const next = store.getState();
      if (
        next.selectedRunId !== previous.selectedRunId ||
        next.layer !== previous.layer ||
        next.selectedCell !== previous.selectedCell ||
        next.display !== previous.display ||
        next.runData !== previous.runData
      ) {
        previous = next;
        actions.scheduleQueries();
      } else previous = next;
    });
  }, [store, actions]);

  const value = useMemo<ViewerActions>(
    () => ({
      loadBootstrap: actions.loadBootstrap,
      selectResult: actions.selectResult,
      ensureRun: actions.ensureRun,
      addCompletedRun: actions.addCompletedRun,
      retryQueries: actions.retryQueries,
    }),
    [actions],
  );
  return <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>;
}

export function useViewerActions(): ViewerActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useViewerActions must be used inside <ViewerActionsProvider>');
  return value;
}
