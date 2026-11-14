/**
 * Analysis panel host: a mode switch over ANALYSIS_MODES (./modes.ts).
 * The selected mode is local UI state; every mode stays mounted.
 */
import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { PanelDefinition, PanelProps } from '../types';
import { ANALYSIS_MODES } from './modes';

function AnalysisPanel({ active }: PanelProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState(ANALYSIS_MODES[0]?.id ?? '');
  return (
    <>
      <div className="analysis-switch" role="group" aria-label={t('analysis.title')}>
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
        <div key={id} id={`analysis-mode-${id}`} hidden={mode !== id}>
          <Component active={active && mode === id} />
        </div>
      ))}
    </>
  );
}

export const analysisPanel: PanelDefinition = {
  id: 'analysis',
  icon: 'intersect',
  labelKey: 'analysis.toolLabel',
  elementId: 'spatial-analysis',
  Component: AnalysisPanel,
};
