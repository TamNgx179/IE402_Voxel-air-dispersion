/**
 * Analysis panel host (port of the mode switch in web/viewer-analysis.js): a mode
 * switch over ANALYSIS_MODES (./modes.ts). The selected mode is local UI state;
 * every mode stays mounted and receives `active` = panel open AND mode selected,
 * so switching mode (or closing the panel) cancels any drawing in progress —
 * only one mode can draw at a time.
 */
import { useState } from 'react';
import { ToolButton } from '../../shared/ui/ToolButton';
import { useViewer, useViewerDispatch } from '../../store/store';
import { selectExact } from '../../store/selectors';
import { useI18n } from '../../i18n';
import type { PanelDefinition, PanelProps } from '../types';
import './analysis.css';
import { AnalysisModeContext } from './context';
import { ANALYSIS_MODES } from './modes';

const modeIcons: Record<string, string> = {
  region: 'bounding-box-circles',
  transect: 'activity',
  compare: 'intersect',
  corridor: 'signpost-split',
};

function AnalysisPanel({ active }: PanelProps) {
  const { t } = useI18n();
  const exact = useViewer(selectExact);
  const dispatch = useViewerDispatch();
  const [mode, setMode] = useState(ANALYSIS_MODES[0]?.id ?? '');
  return (
    <AnalysisModeContext.Provider value={mode}>
      <h2 className="analysis-heading">{t('analysis.toolLabel')}</h2>
      {!exact && (
        <button className="text-button analysis-reset" type="button" onClick={() => dispatch({ type: 'display/reset' })}>
          {t('illustration.reset')}
        </button>
      )}
      <div className="analysis-switch" role="group" aria-label={t('analysis.switchLabel')}>
        {ANALYSIS_MODES.map((m) => (
          <ToolButton
            key={m.id}
            id={`analysis-${m.id}-mode`}
            icon={modeIcons[m.id]}
            aria-pressed={mode === m.id}
            aria-controls={`analysis-mode-${m.id}`}
            onClick={() => setMode(m.id)}
          >
            {t(m.labelKey)}
          </ToolButton>
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
