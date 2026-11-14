/**
 * Tool-panel registry — the ONE place panels are registered.
 *
 * Each panel lives in `src/panels/<name>/` and exports a `PanelDefinition`
 * (see ./types.ts). Order here is the order of the tool buttons.
 */
import { analysisPanel } from './analysis';
import { illustrationPanel } from './illustration';
import { mapOptionsPanel } from './map-options';
import { simulationPanel } from './simulation';
import { statsPanel } from './stats';
import type { PanelDefinition } from './types';

export const PANELS: readonly PanelDefinition[] = [
  simulationPanel,
  mapOptionsPanel,
  statsPanel,
  analysisPanel,
  illustrationPanel,
];

export type { PanelDefinition, PanelProps } from './types';
