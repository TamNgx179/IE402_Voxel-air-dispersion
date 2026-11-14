/**
 * Context shared by the analysis host and its sub-modes.
 *
 * `AnalysisModeContext`: the selected sub-mode id (also while the panel is closed).
 * A mode's `active` prop is "panel open AND mode selected"; some legacy behaviour
 * depends on the selected mode alone (the comparison view is reset only when the
 * user switches to another mode, not when the tool panel is closed).
 *
 * Analysis requests use the viewer's `useApi()` (store/controller.tsx).
 */
import { createContext, useContext } from 'react';

export const AnalysisModeContext = createContext<string>('region');

export function useAnalysisMode(): string {
  return useContext(AnalysisModeContext);
}
