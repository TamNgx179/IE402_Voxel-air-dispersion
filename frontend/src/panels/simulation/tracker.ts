/**
 * Simulation run creation and tracking (port of web/app.js createRun/trackRun).
 *
 * One tracker exists per viewer store (WeakMap), so the panel body and the
 * always-visible progress block share it, and each test App gets a fresh one.
 *
 * Guarantees:
 * - `create()` sends exactly one POST per user action and is never retried here. The
 *   `request_id` is kept in sessionStorage per scenario/multiplier until the server
 *   confirms, so a manual re-click after a lost response is de-duplicated server side.
 * - Polling backs off after failures and stops after MAX_FAILURES; "keep tracking"
 *   (`track(id)`) only resumes polling, it never creates a run.
 * - The active run id survives reloads (sessionStorage `voxel-active-run`).
 * - All user-facing text is stored as i18n keys (language switches keep state).
 */
import { ApiError, api as defaultApi, errorMessage } from '../../api/client';
import type { RunAccepted, RunStatus, RunView } from '../../api/types';
import type { TranslationKey, TranslationParams } from '../../i18n';
import type { ApiFn, ViewerActions } from '../../store/controller';
import type { ViewerStore } from '../../store/store';

export const ACTIVE_RUN_KEY = 'voxel-active-run';
export const POLL_MS = 1500;
export const MAX_POLL_MS = 12000;
export const MAX_FAILURES = 5;
export const EMISSION_MULTIPLIERS = [1, 0.8, 0.6] as const;
export type EmissionMultiplier = (typeof EMISSION_MULTIPLIERS)[number];

const TERMINAL: readonly RunStatus[] = ['succeeded', 'failed', 'stale'];

export interface Message {
  key: TranslationKey;
  params?: TranslationParams;
  /** Run state shown as the `{state}` placeholder (translated at render time). */
  state?: RunStatus;
}

export interface TrackerState {
  activeRunId: string | null;
  creating: boolean;
  tracking: boolean;
  /** 0..100 while the progress bar is shown, otherwise null. */
  progress: number | null;
  note: Message | null;
  /** Error disclosure content (i18n key, never raw server text). */
  error: Message | null;
  /** "Keep tracking" is offered (polling stopped after repeated failures). */
  canResume: boolean;
}

export interface TrackerOptions {
  api: ApiFn;
  sleep: (ms: number) => Promise<void>;
}

export interface CreatePayload {
  scenario_id: string;
  emission_multiplier: EmissionMultiplier;
}

type AddCompletedRun = ViewerActions['addCompletedRun'];

export function pollDelay(failures: number): number {
  return failures ? Math.min(POLL_MS * 2 ** (failures - 1), MAX_POLL_MS) : POLL_MS;
}

const REASON_KEYS: Record<string, TranslationKey> = {
  input: 'simulation.reason.input',
  model: 'simulation.reason.model',
  timeout: 'simulation.reason.timeout',
  system: 'simulation.reason.system',
};

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readSession(key: string): string | null {
  try {
    return session()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null) {
  try {
    if (value === null) session()?.removeItem(key);
    else session()?.setItem(key, value);
  } catch {
    /* storage unavailable: idempotency then only lasts for this page */
  }
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 v4 fallback for non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const pendingRequestKey = (payload: CreatePayload) => `voxel-create:${payload.scenario_id}:${payload.emission_multiplier}`;

export type SimulationTracker = ReturnType<typeof createSimulationTracker>;

export function createSimulationTracker(store: ViewerStore, options: TrackerOptions) {
  const { api, sleep } = options;
  let state: TrackerState = {
    activeRunId: readSession(ACTIVE_RUN_KEY),
    creating: false,
    tracking: false,
    progress: null,
    note: null,
    error: null,
    canResume: false,
  };
  const listeners = new Set<() => void>();
  let generation = 0;

  function set(patch: Partial<TrackerState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function setActive(id: string | null) {
    writeSession(ACTIVE_RUN_KEY, id);
    set({ activeRunId: id });
  }

  function showError(error: Message, note: Message) {
    set({ note, error });
    store.dispatch({ type: 'status/set', status: { message: { key: note.key, params: note.params }, kind: 'error' } });
  }

  async function track(id: string, addCompletedRun: AddCompletedRun): Promise<void> {
    if (state.tracking) return;
    const token = generation;
    set({ tracking: true, canResume: false, error: null, progress: state.progress ?? 0 });
    store.dispatch({ type: 'status/set', status: { message: { key: 'simulation.statusTracking' }, kind: 'info' } });
    let failures = 0;
    try {
      for (;;) {
        if (token !== generation) return;
        try {
          const run = await api<RunView>(`/runs/${encodeURIComponent(id)}`);
          if (token !== generation) return;
          failures = 0;
          const percent = Math.round((Number(run.progress) || 0) * 100);
          set({
            note:
              run.status === 'running'
                ? { key: 'simulation.noteProgress', state: run.status, params: { percent } }
                : { key: `simulation.state.${run.status}` as TranslationKey },
            progress: percent,
          });
          if (TERMINAL.includes(run.status)) {
            setActive(null);
            set({ progress: null });
            if (run.status !== 'succeeded') {
              // Solver diagnostics stay in the run API/artifacts, not in sidebar copy.
              const reason = REASON_KEYS[run.error?.kind ?? ''] ?? 'simulation.reason.other';
              showError({ key: reason }, { key: run.status === 'stale' ? 'simulation.noteStale' : 'simulation.noteFailed' });
              return;
            }
            await addCompletedRun(run);
            if (token !== generation) return;
            if (store.getState().selectedRunId !== id) {
              // selectResult already put the load error (with retry) in the status box.
              const status = store.getState().status;
              set({ note: { key: 'simulation.noteLoadFailed' }, error: errorMessage(status.kind === 'error' ? status.error : undefined) });
              return;
            }
            set({ note: { key: 'simulation.noteSucceeded' }, error: null });
            store.dispatch({ type: 'status/set', status: { message: { key: 'simulation.statusSucceeded' }, kind: 'pass' } });
            return;
          }
        } catch (error) {
          if (token !== generation) return;
          const detail = errorMessage(error);
          if (error instanceof ApiError && error.kind === 'not-found') {
            setActive(null);
            set({ progress: null });
            showError(detail, { key: 'simulation.noteRunNotFound' });
            return;
          }
          failures += 1;
          set({ note: { key: 'simulation.noteReconnecting' } });
          if (failures >= MAX_FAILURES) {
            set({ progress: null, canResume: true });
            showError(detail, { key: 'simulation.noteConnectionLost' });
            return;
          }
        }
        await sleep(pollDelay(failures));
      }
    } finally {
      if (token === generation) set({ tracking: false });
    }
  }

  async function create(payload: CreatePayload, addCompletedRun: AddCompletedRun): Promise<void> {
    // One POST per user action: ignore re-entry while creating or while a run is active.
    if (state.creating || state.activeRunId) return;
    set({ creating: true, error: null, canResume: false });
    const key = pendingRequestKey(payload);
    let accepted: RunAccepted;
    try {
      // Keep the same request id across reloads until the server confirms creation.
      const requestId = readSession(key) ?? newRequestId();
      writeSession(key, requestId);
      accepted = await api<RunAccepted>('/runs', {
        method: 'POST',
        body: JSON.stringify({ ...payload, model: 'fv', request_id: requestId }),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status !== undefined && error.status >= 400 && error.status < 500) writeSession(key, null);
      const unconfirmed = error instanceof ApiError && ['network', 'timeout', 'server'].includes(error.kind);
      set({ creating: false });
      showError(errorMessage(error), { key: unconfirmed ? 'simulation.noteCreateUnconfirmed' : 'simulation.noteCreateFailed' });
      return;
    }
    writeSession(key, null);
    setActive(accepted.run_id);
    set({ creating: false, progress: 0 });
    await track(accepted.run_id, addCompletedRun);
  }

  /** Resume tracking the run stored in sessionStorage (legacy main()). */
  function resume(addCompletedRun: AddCompletedRun) {
    if (state.activeRunId && !state.tracking) void track(state.activeRunId, addCompletedRun);
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    create,
    track,
    resume,
    /** Stop any polling loop (tests / teardown). */
    dispose() {
      generation += 1;
      set({ tracking: false });
    },
  };
}

const trackers = new WeakMap<ViewerStore, SimulationTracker>();
const pendingOptions = new WeakMap<ViewerStore, Partial<TrackerOptions>>();

const defaultOptions: TrackerOptions = {
  api: defaultApi,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Inject the API/sleep for a store before its tracker is first used (tests). */
export function configureSimulationTracker(store: ViewerStore, options: Partial<TrackerOptions>) {
  trackers.get(store)?.dispose();
  trackers.delete(store);
  pendingOptions.set(store, options);
}

export function trackerFor(store: ViewerStore): SimulationTracker {
  let tracker = trackers.get(store);
  if (!tracker) {
    tracker = createSimulationTracker(store, { ...defaultOptions, ...pendingOptions.get(store) });
    trackers.set(store, tracker);
  }
  return tracker;
}
