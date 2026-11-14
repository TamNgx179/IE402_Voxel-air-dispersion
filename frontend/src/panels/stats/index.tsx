/**
 * Statistics panel (legacy #analysis-details): current-layer mean/max, threshold
 * cards (toggle the map highlight + exceedance area at this level) and the
 * vertical profile of the selected cell.
 *
 * Exact vs illustration follows legacy `exactMode()`: with multiplier 1 and
 * background 0 the figures come from the API (summary, exceedance and profile
 * queries scheduled by the store controller); otherwise they are recomputed from
 * the adjusted render codes and labelled as an illustration.
 *
 * The map highlight itself is drawn by the core concentration layer from
 * `state.thresholdsEnabled`; a cell click opens this panel (MapView).
 */
import { useMemo } from 'react';
import { HelpTrigger } from '../../components/Help';
import { useI18n } from '../../i18n';
import { layerStats, thresholdColour } from '../../lib/concentration';
import { selectCurrentRun, selectExact, selectExactAreas, selectGrid, selectThresholds } from '../../store/selectors';
import { useViewer, useViewerDispatch } from '../../store/store';
import type { PanelDefinition, PanelProps } from '../types';
import { ProfileView } from './ProfileView';
import './panel.css';

/** Short card title (legacy): QCVN / WHO, otherwise the server label. */
export function thresholdName(key: string, label: string): string {
  if (key.startsWith('qcvn')) return 'QCVN';
  if (key.startsWith('who')) return 'WHO';
  return label;
}

function useLayerStats() {
  const run = useViewer(selectCurrentRun);
  const grid = useViewer(selectGrid);
  const thresholds = useViewer(selectThresholds);
  const display = useViewer((s) => s.display);
  const layer = useViewer((s) => s.layer);
  const exactAreas = useViewer(selectExactAreas);
  return useMemo(() => {
    if (!run || !grid || !thresholds) return null;
    return layerStats({ volume: run.volume, summary: run.summary, grid, thresholds, display, k: layer, exactAreas });
  }, [run, grid, thresholds, display, layer, exactAreas]);
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

function ThresholdCards({ area, hasRun }: { area: Record<string, number>; hasRun: boolean }) {
  const { t, formatNumber, formatInteger } = useI18n();
  const dispatch = useViewerDispatch();
  const thresholds = useViewer(selectThresholds);
  const enabled = useViewer((s) => s.thresholdsEnabled);
  const exact = useViewer(selectExact);
  const failed = useViewer((s) => s.queries.status === 'error');
  return (
    <section className="stats-block" aria-labelledby="threshold-title">
      <div className="section-heading">
        <h2 id="threshold-title">{t('stats.thresholdTitle')}</h2>
        <HelpTrigger label={t('stats.thresholdHelpLabel')} text={t('stats.thresholdHelp')} />
      </div>
      <div id="threshold-list" className="threshold-cards">
        {Object.entries(thresholds ?? {}).map(([key, threshold]) => {
          const value = formatNumber(threshold.value);
          const a = area[key];
          // A zero area is a valid result; a missing response is reported separately.
          let outcome: string;
          if (!hasRun) outcome = t('stats.thresholdNone');
          else if (!Number.isFinite(a)) outcome = exact && failed ? t('stats.thresholdFailed') : t('stats.thresholdLoading');
          else if (a === 0) outcome = t('stats.thresholdZero', { value });
          else outcome = t('stats.thresholdArea', { area: formatInteger(a) });
          return (
            <section key={key} className="threshold-card">
              <label className="threshold-choice" title={threshold.label}>
                <input
                  type="checkbox"
                  value={key}
                  checked={Boolean(enabled[key])}
                  aria-label={t('stats.thresholdToggle', { label: threshold.label, value })}
                  aria-describedby={`threshold-outcome-${key}`}
                  onChange={(event) => dispatch({ type: 'threshold/toggle', key, enabled: event.target.checked })}
                />
                <span className="swatch" style={{ background: `rgb(${thresholdColour(key).join(',')})` }} aria-hidden="true" />
                <span className="threshold-name">{thresholdName(key, threshold.label)}</span>
                <span className="threshold-limit">
                  {value} {t('common.unitConcentration')}
                </span>
              </label>
              <p className="threshold-outcome" id={`threshold-outcome-${key}`}>
                {outcome}
              </p>
            </section>
          );
        })}
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
      <ThresholdCards area={stats?.area ?? {}} hasRun={stats !== null} />
      <SelectedCell />
    </>
  );
}

export const statsPanel: PanelDefinition = {
  id: 'stats',
  icon: 'bar-chart-line',
  labelKey: 'stats.toolLabel',
  elementId: 'analysis-details',
  Component: StatsPanel,
};
