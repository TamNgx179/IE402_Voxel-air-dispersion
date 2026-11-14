/**
 * Compare-results sub-mode (port of the comparison part of web/viewer-analysis.js).
 *
 * Pick a second run and a map view; GET /runs/:id/comparison (debounced 180 ms,
 * latest request wins) for the current layer and draw the exact per-cell values
 * (baseline, comparison or signed difference) in place of the concentration layer.
 * The view stays on while the tool panel is closed and is turned off when the user
 * switches to another analysis mode (legacy analysisMode()).
 */
import { GeoJsonLayer } from '@deck.gl/layers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppError } from '../../../api/client';
import { HelpTrigger } from '../../../components/Help';
import { useExportContribution } from '../../../export/ExportProvider';
import type { ReportLegend } from '../../../export/report';
import { useI18n } from '../../../i18n';
import { analysisErrorKey, color, latestTask, type ErrorMessage } from '../../../lib/analysis';
import { comparisonLegend } from '../../../lib/export';
import { runLabel } from '../../../lib/labels';
import { useIsDrawing, useMapLayers } from '../../../map/hooks';
import { selectCurrentRun, selectExact, selectZ } from '../../../store/selectors';
import { useApi } from '../../../store/controller';
import { useViewer } from '../../../store/store';
import { useAnalysisMode } from '../context';
import { useAnalysisNumber } from '../Metrics';
import { useRenderMessage, type PanelMessage } from '../messages';
import type { AnalysisModeDefinition, AnalysisModeProps } from '../modes';
import { ComparisonSummary, concentrationMax } from './ComparisonSummary';
import { COMPARISON_VIEWS, type ComparisonPayload, type ComparisonView } from './types';

type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

const FIELD = {
  baseline: 'baseline_ug_m3',
  comparison: 'comparison_ug_m3',
  delta: 'delta_ug_m3',
} as const;

function CompareMode(_props: AnalysisModeProps) {
  const { t, formatInteger } = useI18n();
  const render = useRenderMessage();
  const number = useAnalysisNumber('compare.noData');
  const api = useApi();
  const mode = useAnalysisMode();
  const drawing = useIsDrawing();
  const runId = useViewer((s) => s.selectedRunId);
  const hasRun = useViewer((s) => selectCurrentRun(s) !== null);
  const runs = useViewer((s) => s.runs);
  const exact = useViewer(selectExact);
  const z = useViewer(selectZ);

  const [pair, setPair] = useState('');
  const [view, setView] = useState<ComparisonView>('off');
  const [payload, setPayload] = useState<ComparisonPayload | null>(null);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [error, setError] = useState<ErrorMessage | null>(null);
  const [reloads, setReloads] = useState(0);
  const [retryShown, setRetryShown] = useState(false);
  const task = useRef(latestTask());
  const comparing = view !== 'off';

  // Leaving the compare mode returns the map to the normal view.
  useEffect(() => {
    if (mode !== 'compare' && view !== 'off') setView('off');
  }, [mode, view]);

  const load = useCallback(
    async (run: string, other: string, zm: number) => {
      setStatus('loading');
      setError(null);
      await task.current.run(
        () =>
          api<ComparisonPayload>(
            `/runs/${encodeURIComponent(run)}/comparison?compare_run_id=${encodeURIComponent(other)}&z_m=${zm}`,
          ),
        (data) => {
          setPayload(data);
          setStatus('loaded');
          setRetryShown(false);
        },
        (failure) => {
          setPayload(null);
          setError(analysisErrorKey(failure));
          setStatus('error');
          setRetryShown(true);
        },
      );
    },
    [api],
  );

  // Any change of run, pair, layer, view on/off or illustration drops the old payload.
  useEffect(() => {
    task.current.invalidate();
    setPayload(null);
    setError(null);
    setRetryShown(false);
    if (!comparing || !exact || !runId || !pair) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const timer = setTimeout(() => void load(runId, pair, z), 180);
    return () => clearTimeout(timer);
  }, [runId, pair, z, comparing, exact, reloads, load]);

  useEffect(() => {
    const current = task.current;
    return () => void current.invalidate();
  }, []);

  const retry = () => {
    if (!runId || !pair) return;
    task.current.invalidate();
    setPayload(null);
    void load(runId, pair, z);
  };

  const onPair = (value: string) => {
    setPair(value);
    if (value && view === 'off') setView('delta');
    setReloads((n) => n + 1);
  };

  // Only a payload matching the current run, pair and layer may be drawn or exported.
  const valid =
    comparing && payload && payload.baseline_run_id === runId && payload.comparison_run_id === pair && payload.z_center_m === z
      ? payload
      : null;

  const layers = useMemo(() => {
    if (!valid) return null;
    const delta = view === 'delta';
    const field = FIELD[view as Exclude<ComparisonView, 'off'>];
    const lo = delta ? (valid.stats.delta.min_ug_m3 ?? 0) : 0;
    const hi = delta ? (valid.stats.delta.max_ug_m3 ?? 0) : concentrationMax(valid);
    // Built from `valid` only: a payload for another run/pair/layer is never drawn.
    const lifted = {
      type: 'FeatureCollection' as const,
      features: valid.feature_collection.features.map((f) => ({
        ...f,
        type: 'Feature' as const,
        geometry: { ...f.geometry, coordinates: f.geometry.coordinates.map((ring) => ring.map((p) => [p[0], p[1], z])) },
      })),
    };
    return [
      new GeoJsonLayer({
        id: 'analysis-comparison',
        data: lifted,
        getPolygonOffset: () => [0, -5],
        parameters: { depthWriteEnabled: false },
        filled: true,
        stroked: false,
        pickable: !drawing,
        getFillColor: (f: { properties?: unknown }) =>
          color((f.properties as Record<string, number | null | undefined> | null)?.[field], lo, hi, delta),
        updateTriggers: { getFillColor: [valid, view] },
      }),
    ];
  }, [valid, view, z, drawing]);
  // Also hides the core legend (it describes the concentration layer).
  useMapLayers('analysis-comparison', layers, { suppressConcentration: comparing });

  // ---------------------------------------------------------------- export
  useExportContribution(
    'comparison',
    () => {
      if (!comparing) return null;
      // Let the core checks (no run / drawing) report first.
      if (!hasRun || drawing) return null;
      if (!valid) throw new AppError('compare.waitForComparison');
      return valid;
    },
    { target: 'report' },
  );
  useExportContribution('comparison_run_id', () => (comparing && valid ? valid.comparison_run_id : undefined));

  const note: PanelMessage | ErrorMessage = !comparing
    ? { key: 'compare.note.off' }
    : !exact
      ? { key: 'compare.note.modified' }
      : !runId || !pair
        ? { key: 'compare.note.choose' }
        : status === 'error' && error
          ? error
          : status === 'loaded' && payload
            ? payload.stats.air_cells
              ? {
                  key: 'compare.note.loaded',
                  params: { cells: formatInteger(payload.stats.air_cells), z: number(payload.z_center_m) },
                }
              : { key: 'compare.note.noAir' }
            : { key: 'compare.note.loading' };
  const loading = comparing && exact && Boolean(runId && pair) && (status === 'loading' || status === 'idle');

  const baseline = runs.find((run) => run.id === runId);
  return (
    <section className="analysis-section" id="compare-panel" aria-labelledby="compare-heading">
      <div className="section-heading">
        <h2 id="compare-heading">{t('compare.title')}</h2>
        <HelpTrigger label={t('compare.helpLabel')} text={t('compare.help')} />
      </div>
      <p className="note" id="analysis-baseline">
        {runId ? t('compare.baseline', { label: baseline ? runLabel(baseline, t) : runId }) : t('compare.noBaseline')}
      </p>
      <label htmlFor="compare-run">{t('compare.run')}</label>
      <select id="compare-run" value={pair} onChange={(event) => onPair(event.target.value)}>
        <option value="">{t('compare.runPlaceholder')}</option>
        {runs.map((run) => (
          <option key={run.id} value={run.id}>
            {runLabel(run, t)}
          </option>
        ))}
      </select>
      <label htmlFor="analysis-view">{t('compare.view')}</label>
      <select id="analysis-view" value={view} onChange={(event) => setView(event.target.value as ComparisonView)}>
        {COMPARISON_VIEWS.map((v) => (
          <option key={v} value={v}>
            {t(`compare.view.${v}`)}
          </option>
        ))}
      </select>
      <p className="note" id="comparison-note" role="status" aria-busy={loading}>
        {render(note)}
      </p>
      <div id="comparison-result">{valid && <ComparisonSummary payload={valid} view={view} />}</div>
      <button
        type="button"
        id="comparison-retry"
        hidden={!retryShown}
        disabled={!comparing || !exact || !runId || !pair || loading}
        onClick={retry}
      >
        {t('compare.retry')}
      </button>
      {comparing && valid && <ComparisonExport payload={valid} view={view} />}
    </section>
  );
}

/**
 * Report overrides while a comparison is exported (legacy reportSnapshot): mode and
 * comparison legend (buildReport adds the comparison notice itself when `comparison`
 * is contributed). Mounted only while a valid comparison is shown, so the core
 * report is untouched otherwise.
 */
function ComparisonExport({ payload, view }: { payload: ComparisonPayload; view: ComparisonView }) {
  const { t, formatNumber } = useI18n();
  useExportContribution('mode', () => t(`compare.report.${view as Exclude<ComparisonView, 'off'>}`), { target: 'report' });
  useExportContribution(
    'legend',
    (): ReportLegend => {
      const keyed = comparisonLegend(payload, view, (v) => formatNumber(v));
      return {
        title: t(keyed.titleKey),
        ...(keyed.stops ? { stops: keyed.stops } : {}),
        ...(keyed.categories ? { categories: keyed.categories.map((c) => ({ label: t(c.labelKey), color: c.color })) } : {}),
        labels: keyed.labels,
      };
    },
    { target: 'report' },
  );
  // Legacy file names carry the view: pm25-<run>-vs-<other>-<z>m-<view>.<ext>.
  useExportContribution('comparison_view', () => view, { target: 'report' });
  return null;
}

export const compareMode: AnalysisModeDefinition = {
  id: 'compare',
  labelKey: 'compare.modeLabel',
  Component: CompareMode,
};
