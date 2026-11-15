/** Concentration statistics and the vertical profile of the selected cell. */
import { useMemo } from 'react';
import { HelpTrigger } from '../../shared/ui/Help';
import { useI18n } from '../../i18n';
import { layerStats } from '../../lib/concentration';
import { selectCurrentRun, selectExact, selectGrid } from '../../store/selectors';
import { useViewer } from '../../store/store';
import type { PanelDefinition, PanelProps } from '../types';
import { ProfileView } from './ProfileView';
import './panel.css';

function useLayerStats() {
  const run = useViewer(selectCurrentRun);
  const grid = useViewer(selectGrid);
  const display = useViewer((s) => s.display);
  const layer = useViewer((s) => s.layer);
  return useMemo(() => {
    if (!run || !grid) return null;
    return layerStats({ volume: run.volume, summary: run.summary, grid, thresholds: {}, display, k: layer, exactAreas: undefined });
  }, [run, grid, display, layer]);
}

function LayerSummary({ mean, max }: { mean: number; max: number }) {
  const { t, formatNumber } = useI18n();
  const grid = useViewer(selectGrid);
  const layer = useViewer((s) => s.layer);
  const exact = useViewer(selectExact);
  const z = grid?.z_centres_m[layer];
  const half = (grid?.dz_m ?? 0) / 2;
  const context =
    z === undefined
      ? ''
      : t(exact ? 'stats.context' : 'stats.contextAdjusted', { min: formatNumber(z - half), max: formatNumber(z + half) });
  return (
    <section className="stats-block" aria-labelledby="analysis-title">
      <div className="section-heading">
        <h2 id="analysis-title" className="tool-panel-title">
          {t('stats.title')}
        </h2>
        <HelpTrigger label={t('stats.helpLabel')} text={t('stats.help')} />
      </div>
      <p id="stats-context" className="stats-context">
        {context}
      </p>
      <div className="stats concentration-stats">
        <div className="stat">
          <span className="stat-label">{t('stats.mean')}</span>
          <span id="stat-mean" className="stat-value">
            {formatNumber(mean)}
          </span>
          <span className="metric-unit">{t('common.unitConcentration')}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t('stats.max')}</span>
          <span id="stat-max" className="stat-value">
            {formatNumber(max)}
          </span>
          <span className="metric-unit">{t('common.unitConcentration')}</span>
        </div>
      </div>
    </section>
  );
}

function SelectedCell() {
  const { t } = useI18n();
  const cell = useViewer((s) => s.selectedCell);
  const hasRun = useViewer((s) => selectCurrentRun(s) !== null);
  const visible = Boolean(cell && hasRun);
  return (
    <section className="stats-block selected-cell" id="selected-cell-detail" aria-label={t('stats.cellSectionLabel')} hidden={!visible}>
      <div className="section-heading">
        <h2 id="profile-title" className="card-title">
          {t('stats.cellTitle')}
        </h2>
        <HelpTrigger label={t('stats.cellHelpLabel')} text={t('stats.cellHelp')} />
      </div>
      {visible && cell ? <ProfileView i={cell.i} j={cell.j} /> : <div id="profile" className="profile" />}
    </section>
  );
}

function StatsPanel(_props: PanelProps) {
  const stats = useLayerStats();
  return (
    <>
      <LayerSummary mean={stats?.mean ?? NaN} max={stats?.max ?? NaN} />
      <SelectedCell />
    </>
  );
}

export const statsPanel: PanelDefinition = {
  id: 'stats',
  icon: 'bar-chart-line',
  labelKey: 'stats.toolLabel',
  ariaLabelKey: 'stats.panelLabel',
  elementId: 'analysis-details',
  Component: StatsPanel,
};
