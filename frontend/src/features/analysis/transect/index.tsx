/** Transect (vertical section) analysis sub-mode: see ./TransectPanel.tsx. */
import type { AnalysisModeDefinition } from '../modes';
import { TransectPanel } from './TransectPanel';

export { TransectPanel } from './TransectPanel';

export const transectMode: AnalysisModeDefinition = {
  id: 'transect',
  labelKey: 'transect.modeLabel',
  Component: TransectPanel,
};
