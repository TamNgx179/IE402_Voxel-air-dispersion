/**
 * Illustration panel (complete reference panel): illustrative source factor and
 * background concentration. Display-only; it never reruns the solver.
 */
import { useEffect, useState } from 'react';
import { HelpTrigger } from '../../components/Help';
import { useI18n } from '../../i18n';
import { selectExact } from '../../store/selectors';
import { useViewer, useViewerDispatch } from '../../store/store';
import type { PanelDefinition, PanelProps } from '../types';

const MULTIPLIERS = [1, 10, 30, 100, 300];

function IllustrationPanel(_props: PanelProps) {
  const { t, formatNumber } = useI18n();
  const dispatch = useViewerDispatch();
  const display = useViewer((s) => s.display);
  const exact = useViewer(selectExact);
  const [background, setBackground] = useState(String(display.background));
  useEffect(() => setBackground(String(display.background)), [display.background]);
  const commitBackground = () => {
    const v = Number(background);
    const next = Number.isFinite(v) && v >= 0 ? v : 0;
    setBackground(String(next));
    dispatch({ type: 'display/set', display: { background: next } });
  };
  return (
    <>
      <div className="section-heading">
        <h2 id="illustration-title" className="tool-panel-title">
          {t('illustration.title')}
        </h2>
        <HelpTrigger label={t('illustration.helpLabel')} text={t('illustration.help')} />
      </div>
      <div className="row">
        <label htmlFor="multiplier">{t('illustration.multiplier')}</label>
        <select
          id="multiplier"
          value={String(display.multiplier)}
          onChange={(event) => dispatch({ type: 'display/set', display: { multiplier: Number(event.target.value) } })}
        >
          {MULTIPLIERS.map((m) => (
            <option key={m} value={String(m)}>
              {m === 1 ? t('illustration.multiplierEdgar') : `× ${formatNumber(m)}`}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <label htmlFor="background">{t('illustration.background')}</label>
        <input
          id="background"
          type="number"
          min={0}
          max={200}
          step={1}
          inputMode="decimal"
          value={background}
          onChange={(event) => setBackground(event.target.value)}
          onBlur={commitBackground}
          onKeyDown={(event) => event.key === 'Enter' && commitBackground()}
        />
      </div>
      <button id="illustration-reset" className="text-button" type="button" hidden={exact} onClick={() => dispatch({ type: 'display/reset' })}>
        {t('illustration.reset')}
      </button>
    </>
  );
}

export const illustrationPanel: PanelDefinition = {
  id: 'illustration',
  icon: 'sliders',
  labelKey: 'illustration.toolLabel',
  elementId: 'illustration-options',
  Component: IllustrationPanel,
};
