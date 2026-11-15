/**
 * Analysis sub-mode registry (hosted by the analysis panel). Each mode lives in
 * `src/panels/analysis/<mode>/` and exports an `AnalysisModeDefinition`.
 * Order here is the order of the mode switch buttons.
 */
import type { ComponentType } from 'react';
import type { TranslationKey } from '../../i18n';
import { compareMode } from './compare';
import { corridorMode } from './corridor';
import { regionMode } from './region';
import { transectMode } from './transect';

export interface AnalysisModeProps {
  /**
   * True only while the analysis panel is open AND this mode is selected.
   * Modes stay mounted when inactive; cancel any drawing when this turns false
   * (the legacy viewer cancels drawing on tool or mode change).
   */
  active: boolean;
}

export interface AnalysisModeDefinition {
  id: string;
  labelKey: TranslationKey;
  Component: ComponentType<AnalysisModeProps>;
}

export const ANALYSIS_MODES: readonly AnalysisModeDefinition[] = [regionMode, transectMode, compareMode, corridorMode];
