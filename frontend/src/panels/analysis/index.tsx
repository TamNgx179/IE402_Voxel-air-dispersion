/**
 * Analysis panel host (port of the mode switch in web/viewer-analysis.js): a mode
 * switch over ANALYSIS_MODES (./modes.ts). The selected mode is local UI state;
 * every mode stays mounted and receives `active` = panel open AND mode selected,
 * so switching mode (or closing the panel) cancels any drawing in progress —
 * only one mode can draw at a time.
 */
import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { PanelDefinition, PanelProps } from '../types';
import './analysis.css';
import { AnalysisModeContext } from './context';
import { ANALYSIS_MODES } from './modes';

function AnalysisPanel({ active }: PanelProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState(ANALYSIS_MODES[0]?.id ?? '');
  return (
    <AnalysisModeContext.Provider value={mode}>
      <div className="analysis-switch" role="group" aria-label={t('analysis.switchLabel')}>
        {ANALYSIS_MODES.map((m) => (
          <button
            key={m.id}
            id={`analysis-${m.id}-mode`}
            type="button"
            aria-pressed={mode === m.id}
            aria-controls={`analysis-mode-${m.id}`}
            onClick={() => setMode(m.id)}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      {ANALYSIS_MODES.map(({ id, Component }) => (
        <div key={id} id={`analysis-mode-${id}`} className="analysis-mode" hidden={mode !== id}>
          <Component active={active && mode === id} />
        </div>
      ))}
    </AnalysisModeContext.Provider>
  );
}

export const analysisPanel: PanelDefinition = {
  id: 'analysis',
  icon: 'intersect',
  labelKey: 'analysis.toolLabel',
  elementId: 'spatial-analysis',
  Component: AnalysisPanel,
};
