/** Road corridor analysis sub-mode: see ./CorridorPanel.tsx. */
import type { AnalysisModeDefinition } from '../modes';
import { CorridorPanel } from './CorridorPanel';

export { CorridorPanel } from './CorridorPanel';

export const corridorMode: AnalysisModeDefinition = {
  id: 'corridor',
  labelKey: 'corridor.modeLabel',
  Component: CorridorPanel,
};
