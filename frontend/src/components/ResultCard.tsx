/** "Simulation result" card: result select, height slider + milestones, legend and grid toggle. */
import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { activeThresholds, colourScale, legendValues, position, rampGradient } from '../lib/concentration';
import { milestones } from '../lib/heightMarks';
import { useConcentrationSuppressed } from '../map/hooks';
import { runLabel } from '../lib/labels';
import { useViewerActions } from '../store/controller';
import { selectCurrentRun, selectExact } from '../store/selectors';
import { useViewer, useViewerDispatch } from '../store/store';
import type { BootstrapData } from '../store/types';
import { HelpTrigger } from './Help';

export function ResultCard({ bootstrap }: { bootstrap: BootstrapData | null }) {
  const { t } = useI18n();
  return (
    <section className="control-card" aria-labelledby="view-title">
      <div className="section-heading">
        <h2 id="view-title" className="card-title">
          {t('viewer.resultTitle')}
        </h2>
        <HelpTrigger label={t('viewer.resultHelpLabel')} text={t('viewer.resultHelp')} />
      </div>
      <ResultSelect />
      <HeightControl heights={bootstrap?.grid.z_centres_m ?? []} dz={bootstrap?.grid.dz_m ?? 0} />
      <div className="group">
        <Legend />
        <GridToggle />
      </div>
    </section>
  );
}

function ResultSelect() {
  const { t } = useI18n();
  const runs = useViewer((s) => s.runs);
  const selected = useViewer((s) => s.selectedRunId);
  const pending = useViewer((s) => s.pendingRunId);
  const ready = useViewer((s) => s.bootstrap.status === 'ready');
  const { selectResult } = useViewerActions();
  return (
    <fieldset className="group">
      <legend className="sr-only">{t('viewer.resultLegend')}</legend>
      <label htmlFor="scenario-list" className="sr-only">
        {t('viewer.resultSelectLabel')}
      </label>
      <select
        id="scenario-list"
        value={selected ?? ''}
        disabled={!ready || !runs.length}
        aria-busy={pending !== null}
        onChange={(event) => event.target.value && void selectResult(event.target.value)}
      >
        {!runs.length && <option value="">{t('viewer.noResults')}</option>}
        {runs.length > 0 && selected === null && <option value="" disabled />}
        {runs.map((run) => (
          <option key={run.id} value={run.id}>
            {runLabel(run, t)}
          </option>
        ))}
      </select>
    </fieldset>
  );
}

export function HeightControl({ heights, dz }: { heights: number[]; dz: number }) {
  const { t, formatNumber, locale } = useI18n();
  const dispatch = useViewerDispatch();
  const layer = useViewer((s) => s.layer);
  const hasRun = useViewer((s) => selectCurrentRun(s) !== null);
  const marks = useMemo(() => milestones(heights, locale), [heights, locale]);
  const z = heights[layer] ?? 0;
  const half = dz / 2;
  const disabled = !hasRun;
  const progress = heights.length > 1 ? (layer / (heights.length - 1)) * 100 : 0;
  return (
    <div className="group">
      <div className="row">
        <label htmlFor="height-slider">{t('viewer.heightLabel')}</label>
        <output id="height-value" htmlFor="height-slider">
          {t('viewer.metres', { value: formatNumber(z) })}
        </output>
      </div>
      <div className="height-control">
        <input
          id="height-slider"
          type="range"
          min={0}
          max={Math.max(0, heights.length - 1)}
          step={1}
          value={layer}
          disabled={disabled}
          aria-valuetext={t('viewer.heightValueText', { level: layer + 1, min: formatNumber(z - half), max: formatNumber(z + half) })}
          style={{ '--height-progress': `${progress}%` } as React.CSSProperties}
          onChange={(event) => dispatch({ type: 'layer/set', layer: Number(event.target.value) })}
        />
        <div id="height-dots" className="height-dots" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.index} className={`height-dot${mark.index === layer ? ' is-current' : ''}`} style={{ left: `${mark.position}%` }} />
          ))}
        </div>
        <div id="height-marks" className="ticks" role="group" aria-label={t('viewer.heightMarksLabel')}>
          {marks.map((mark) => (
            <button
              key={mark.index}
              type="button"
              className="height-mark"
              style={{ left: `${mark.position}%` }}
              aria-label={t('viewer.heightMarkAria', { label: mark.label })}
              aria-pressed={mark.index === layer}
              disabled={disabled}
              data-index={mark.index}
              onClick={() => dispatch({ type: 'layer/set', layer: mark.index })}
            >
              {mark.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Legend() {
  const { t, formatNumber } = useI18n();
  const run = useViewer(selectCurrentRun);
  const display = useViewer((s) => s.display);
  const exact = useViewer(selectExact);
  const thresholds = useViewer((s) => s.bootstrap.data?.thresholds);
  const enabled = useViewer((s) => s.thresholdsEnabled);
  // The legend describes the concentration layer; hide it while a panel replaces that layer.
  const hidden = useConcentrationSuppressed();
  const scale = colourScale(run?.volume.scale, display);
  const markers = activeThresholds(thresholds ?? {}, enabled)
    .map((threshold) => ({ ...threshold, p: position(threshold.value, scale) }))
    .filter((m) => m.p >= 0 && m.p <= 1);
  return (
    <>
      <div className="legend-title" id="legend-title" hidden={hidden}>
        {t('viewer.legendTitle')}
        {exact ? '' : t('viewer.legendAdjusted', { multiplier: formatNumber(display.multiplier), background: formatNumber(display.background) })}
      </div>
      <div className="legend" id="legend" hidden={hidden} style={{ background: `linear-gradient(90deg, ${rampGradient()})` }}>
        {markers.map((m) => (
          <span key={m.key} className="legend-marker" style={{ left: `${m.p * 100}%` }} title={m.label} />
        ))}
      </div>
      <div className="legend-labels" id="legend-labels" hidden={hidden}>
        {legendValues(scale).map((value, index) => (
          <span key={index}>{formatNumber(value)}</span>
        ))}
      </div>
    </>
  );
}

function GridToggle() {
  const { t } = useI18n();
  const dispatch = useViewerDispatch();
  const visible = useViewer((s) => s.layers.grid);
  const hasRun = useViewer((s) => selectCurrentRun(s) !== null);
  return (
    <label className="check">
      <input
        id="show-grid"
        type="checkbox"
        checked={visible}
        disabled={!hasRun}
        onChange={(event) => dispatch({ type: 'layers/set', layer: 'grid', visible: event.target.checked })}
      />{' '}
      {t('viewer.showGrid')}
    </label>
  );
}
