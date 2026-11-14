/** Read-only selectors. Each returns existing objects or primitives (safe for useViewer). */
import { areaKey, profileKey } from './reducer';
import type { RunData, RunEntry, ViewerState } from './types';

export const selectBootstrap = (s: ViewerState) => s.bootstrap.data;
export const selectGrid = (s: ViewerState) => s.bootstrap.data?.grid ?? null;
export const selectThresholds = (s: ViewerState) => s.bootstrap.data?.thresholds ?? null;

/** Loaded data of the selected run, or null while nothing is shown. */
export const selectCurrentRun = (s: ViewerState): RunData | null =>
  (s.selectedRunId && s.runData[s.selectedRunId]) || null;

export const selectCurrentEntry = (s: ViewerState): RunEntry | null =>
  s.runs.find((run) => run.id === s.selectedRunId) ?? null;

/** True when the original data is shown (no illustrative multiplier/background). */
export const selectExact = (s: ViewerState) => s.display.multiplier === 1 && s.display.background === 0;

/** Centre height (m) of the current layer. */
export const selectZ = (s: ViewerState) => s.bootstrap.data?.grid.z_centres_m[s.layer] ?? 0;

/** Exceedance areas (m²) of the current run/layer from the API, if loaded. */
export const selectExactAreas = (s: ViewerState) =>
  s.selectedRunId ? s.queries.areas[areaKey(s.selectedRunId, s.layer)] : undefined;

/** Exact vertical profile of the selected cell, if loaded. */
export const selectSelectedProfile = (s: ViewerState) =>
  s.selectedRunId && s.selectedCell
    ? s.queries.profiles[profileKey(s.selectedRunId, s.selectedCell.i, s.selectedCell.j)]
    : undefined;
