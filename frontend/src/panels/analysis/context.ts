/**
 * Contexts shared by the analysis host and its sub-modes.
 *
 * - `AnalysisModeContext`: the selected sub-mode id (also while the panel is closed).
 *   A mode's `active` prop is "panel open AND mode selected"; some legacy behaviour
 *   depends on the selected mode alone (the comparison view is reset only when the
 *   user switches to another mode, not when the tool panel is closed).
 * - `AnalysisApiContext`: the REST function used by the analysis requests. Defaults
 *   to the real same-origin client; tests provide the in-memory `fakeApi()`.
 */
import { createContext, useContext } from 'react';
import { api as defaultApi } from '../../api/client';
import type { ApiFn } from '../../store/controller';

export const AnalysisModeContext = createContext<string>('region');

export function useAnalysisMode(): string {
  return useContext(AnalysisModeContext);
}

export const AnalysisApiContext = createContext<ApiFn>(defaultApi as ApiFn);

export function useAnalysisApi(): ApiFn {
  return useContext(AnalysisApiContext);
}
