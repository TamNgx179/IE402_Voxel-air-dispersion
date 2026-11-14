/**
 * Vertical section (port of web/viewer-transect.js + #transect-panel / #transect-result).
 * The API owns the numbers; this component owns drawing the line and presenting the
 * exact API cells on a canvas (no interpolation, never reading pixel colours back).
 */
import { PathLayer } from '@deck.gl/layers';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { HelpTrigger } from '../../../components/Help';
import { useExportContribution } from '../../../export/ExportProvider';
import { useI18n } from '../../../i18n';
import { analysisErrorKey, latestTask } from '../../../lib/analysis';
import { csvBlob, download } from '../../../lib/export';
import { runLabel } from '../../../lib/labels';
import {
  NO_DATA_STROKE,
  SELECTION_STROKE,
  TRANSECT_MAX_POINTS,
  addTransectPoint,
  axisTicks,
  canFinishTransect,
  cellFill,
  hasAir,
  moveSelection,
  pickCell,
  plotBox,
  readingText,
  sampleSpan,
  selectedReading,
  transectCsvFilename,
  transectLine,
  transectMax,
  transectRequest,
  xScale,
  yScale,
  type LngLat,
  type Selection,
  type TransectLine,
  type TransectRequest,
  type TransectResult,
} from '../../../lib/transect';
import { useMapClick, useMapInstance, useMapLayers } from '../../../map/hooks';
import { selectExact, selectGrid, selectZ } from '../../../store/selectors';
import { useApi } from '../../../store/controller';
import { useViewer } from '../../../store/store';
import { fromError, renderMsg, type Msg } from './message';

export interface TransectPanelProps {
  active: boolean;
}

interface Saved {
  result: TransectResult;
  body: TransectRequest;
  run: string;
}

const START: Selection = { position: 0, layer: 0 };

export function TransectPanel({ active }: TransectPanelProps) {
  const { t, formatNumber, locale } = useI18n();
  const api = useApi();
  const runId = useViewer((s) => s.selectedRunId);
  const runs = useViewer((s) => s.runs);
  const modified = !useViewer(selectExact);
  const grid = useViewer(selectGrid);
  const z = useViewer(selectZ);
  const height = grid ? grid.nz * grid.dz_m : 0;
  const instance = useMapInstance();

  const [task] = useState(latestTask);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<LngLat[]>([]);
  const [line, setLine] = useState<TransectLine | null>(null);
  const [note, setNote] = useState<Msg | null>(null);
  const [feedback, setFeedback] = useState<Msg | null>(null);
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('50');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saved, setSavedState] = useState<Saved | null>(null);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(START);
  const [canvasWidth, setCanvasWidth] = useState(0);

  // Refs mirror state read by async callbacks and document listeners.
  const savedRef = useRef<Saved | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<LngLat[]>([]);
  const lineRef = useRef<TransectLine | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const zoomBackup = useRef(false);
  const focusNext = useRef<'draw' | 'query' | 'canvas' | null>(null);
  const drawRef = useRef<HTMLButtonElement>(null);
  const queryRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef(instance);
  instanceRef.current = instance;

  const format = useCallback((value: number) => formatNumber(value, { maximumSignificantDigits: 5 }), [formatNumber]);
  const setSaved = (value: Saved | null) => {
    savedRef.current = value;
    setSavedState(value);
  };
  const setDrawingBoth = (value: boolean) => {
    drawingRef.current = value;
    setDrawing(value);
  };
  const setPointsBoth = (value: LngLat[]) => {
    pointsRef.current = value;
    setPoints(value);
  };
  const setLineBoth = (value: TransectLine | null) => {
    lineRef.current = value;
    setLine(value);
  };

  /** Revokes in-flight requests before dropping the result and its CSV. */
  function invalidate() {
    task.invalidate();
    setSaved(null);
    setBusy(false);
    setExporting(false);
    setSelection(START);
    setOpen(false);
    setFeedback(null);
  }

  /** Restores the double-click zoom setting from before drawing (never forces it on). */
  function endDrawing() {
    if (!drawingRef.current) return;
    setDrawingBoth(false);
    setPointsBoth([]);
    if (zoomBackup.current) instanceRef.current?.map?.doubleClickZoom?.enable();
  }

  function cancelDrawing() {
    if (!drawingRef.current) return;
    endDrawing();
    setNote(lineRef.current ? { key: 'transect.noteKept' } : null);
  }

  // Run, illustration or model height change: the section is no longer valid.
  const contextKey = JSON.stringify([runId, modified, height]);
  useEffect(() => {
    cancelDrawing();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  // Leaving the mode/panel stops drawing and hides the floating result.
  useEffect(() => {
    if (!active) {
      cancelDrawing();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Escape cancels drawing (the help tooltip handles Escape first when open).
  useEffect(() => {
    if (!active || !drawing) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !drawingRef.current) return;
      cancelDrawing();
      focusNext.current = 'draw';
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, drawing]);

  // Restore double-click zoom if unmounted mid-drawing.
  useEffect(
    () => () => {
      if (drawingRef.current && zoomBackup.current) instanceRef.current?.map?.doubleClickZoom?.enable();
    },
    [],
  );

  // Move focus once the target is rendered (buttons are hidden while drawing).
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const element = target === 'draw' ? drawRef.current : target === 'query' ? queryRef.current : canvasRef.current;
    element?.focus({ preventScroll: true });
  });

  function startDrawing() {
    if (busy || !runId) return;
    invalidate();
    setDrawingBoth(true);
    setPointsBoth([]);
    const zoom = instanceRef.current?.map?.doubleClickZoom;
    zoomBackup.current = zoom?.isEnabled() ?? false;
    zoom?.disable();
    setNote({ key: 'transect.notePickTwo' });
  }

  useMapClick(
    (event) => {
      if (!drawingRef.current) return;
      const added = addTransectPoint(pointsRef.current, event.lngLat);
      if (added.status === 'full') {
        setNote({ key: 'analysis.transect.maxPoints', params: { max: TRANSECT_MAX_POINTS } });
        return;
      }
      if (added.status === 'duplicate') return;
      setPointsBoth(added.points);
      setNote(
        added.points.length < 2
          ? { key: 'transect.noteOne' }
          : { key: 'transect.noteCount', params: { count: added.points.length } },
      );
    },
    { enabled: active && drawing, drawing: true },
  );

  function finish() {
    const next = transectLine(pointsRef.current);
    if (!next) return;
    setLineBoth(next);
    endDrawing();
    invalidate();
    setNote({ key: 'transect.noteChosen', params: { count: next.coordinates.length } });
  }

  function clear() {
    endDrawing();
    setLineBoth(null);
    invalidate();
    setNote(null);
  }

  function changeHeight(setter: (value: string) => void, value: string) {
    setter(value);
    invalidate();
    setFeedback({ key: 'transect.refresh' });
  }

  async function query() {
    if (busy) return;
    if (saved) {
      setOpen(true);
      focusNext.current = 'canvas';
      return;
    }
    let body: TransectRequest;
    try {
      body = transectRequest({ line, runId, modified, min, max, height });
    } catch (error) {
      setFeedback(fromError(analysisErrorKey(error)));
      return;
    }
    const run = runId as string;
    setBusy(true);
    setFeedback({ key: 'transect.loading' });
    await task.run(
      () => api<TransectResult>(`/runs/${run}/transect`, { method: 'POST', body: JSON.stringify(body) }),
      (result) => {
        setBusy(false);
        setSaved({ result, body, run });
        setSelection(START);
        setFeedback(null);
        if (activeRef.current) {
          setOpen(true);
          focusNext.current = 'canvas';
        }
      },
      (error) => {
        setBusy(false);
        setFeedback(fromError(analysisErrorKey(error)));
      },
    );
  }

  async function exportCsv() {
    const current = savedRef.current;
    if (!current || exporting) return;
    setExporting(true);
    try {
      const text = await api<string>(`/runs/${current.run}/transect/csv`, {
        method: 'POST',
        body: JSON.stringify(current.body),
        responseType: 'text',
      });
      if (savedRef.current !== current) return;
      download(document, csvBlob(text), transectCsvFilename(current.run));
      setFeedback({ key: 'transect.csvDone' });
    } catch (error) {
      if (savedRef.current === current) setFeedback(fromError(analysisErrorKey(error)));
    } finally {
      if (savedRef.current === current) setExporting(false);
    }
  }

  function close() {
    setOpen(false);
    focusNext.current = 'query';
  }

  useExportContribution('transect', () => (active && saved ? { run: saved.run, request: saved.body } : null));

  // ---------------------------------------------------------------- map layer
  const layers = useMemo(() => {
    const path = drawing ? points : line?.coordinates;
    if (!active || !path || path.length < 2) return null;
    return [
      new PathLayer<number[][]>({
        id: 'transect-line',
        data: [path],
        getPath: (p) => p.map((x) => [x[0], x[1], z + 0.4]) as never,
        getColor: [45, 82, 109],
        getWidth: 4,
        widthUnits: 'pixels',
        pickable: false,
      }),
    ];
  }, [active, drawing, points, line, z]);
  useMapLayers('transect', layers);

  // ---------------------------------------------------------------- chart
  const shown = Boolean(saved && open && active);
  const result = saved?.result ?? null;
  const maxValue = useMemo(() => (result ? transectMax(result) : 0), [result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shown || !canvas || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => setCanvasWidth(canvas.getBoundingClientRect().width));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [shown]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!shown || !result || !canvas) return;
    const b = plotBox(canvas.getBoundingClientRect().width);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(b.width * ratio);
    canvas.height = Math.round(b.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);
    const x = xScale(result, b),
      y = yScale(result, b);
    for (let n = 0; n < result.samples.length; n++) {
      // Cells span to the midpoints between samples: a display symbol, not a new voxel.
      const [lo, hi] = sampleSpan(result, n);
      for (let k = 0; k < result.layers.length; k++) {
        const cell = result.samples[n].cells[k],
          layer = result.layers[k];
        const left = x(lo),
          top = y(layer.overlap_max_m),
          w = x(hi) - x(lo),
          h = y(layer.overlap_min_m) - y(layer.overlap_max_m);
        ctx.fillStyle = cellFill(cell, maxValue);
        ctx.fillRect(left, top, w + 0.25, h + 0.25);
        if (cell.status === 'no_data') {
          ctx.strokeStyle = NO_DATA_STROKE;
          ctx.lineWidth = 1;
          ctx.strokeRect(left, top, w, h);
        }
        if (n === selection.position && k === selection.layer) {
          ctx.strokeStyle = SELECTION_STROKE;
          ctx.lineWidth = 2;
          ctx.strokeRect(left + 1, top + 1, Math.max(1, w - 2), Math.max(1, h - 2));
        }
      }
    }
    ctx.fillStyle = '#253039';
    ctx.font = '11px system-ui';
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#7a8f9c';
    ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    const ticks = axisTicks(result);
    ticks.z.forEach((value, n) => {
      ctx.textAlign = 'right';
      ctx.fillText(format(value), b.left - 7, y(value) + 4);
      const d = ticks.d[n];
      ctx.textAlign = n === 0 ? 'left' : n === 4 ? 'right' : 'center';
      ctx.fillText(format(d), x(d), b.bottom + 16);
    });
    ctx.textAlign = 'left';
    ctx.fillText(t('transect.axisZ'), 4, 11);
    ctx.textAlign = 'center';
    ctx.fillText(t('transect.axisDistance'), (b.left + b.right) / 2, b.height - 3);
  }, [shown, result, selection, maxValue, canvasWidth, format, t, locale]);

  function chartClick(event: MouseEvent<HTMLCanvasElement>) {
    if (!result) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const picked = pickCell(result, plotBox(rect.width), event.clientX - rect.left, event.clientY - rect.top);
    if (picked) setSelection(picked);
  }

  function chartKey(event: KeyboardEvent<HTMLCanvasElement>) {
    if (!result) return;
    const next = moveSelection(result, selection, event.key);
    if (!next) return;
    event.preventDefault();
    setSelection(next);
  }

  // ---------------------------------------------------------------- render
  const entry = saved ? runs.find((r) => r.id === saved.run) : undefined;
  const label = entry ? runLabel(entry, t) : t('transect.currentResult');
  const shownFeedback: Msg | null = modified ? { key: 'transect.illustration' } : feedback;
  const queryLabel = busy ? t('transect.querying') : saved ? t('transect.queryAgain') : t('transect.query');

  const resultPanel =
    saved && result ? (
      <section
        id="transect-result"
        className="transect-result-panel"
        aria-labelledby="transect-result-title"
        hidden={!shown}
      >
        <div className="transect-header">
          <div>
            <div className="section-heading">
              <h2 id="transect-result-title">{t('transect.resultTitle')}</h2>
              <HelpTrigger label={t('transect.resultHelpLabel')} text={t('transect.resultHelp')} />
            </div>
            <p id="transect-context">
              {t('transect.context', {
                run: label,
                length: format(result.length_m),
                min: format(result.z_min_m),
                max: format(result.z_max_m),
              })}
            </p>
          </div>
          <div className="analysis-actions">
            <button id="transect-export" type="button" disabled={exporting} onClick={exportCsv}>
              {exporting ? t('transect.downloading') : t('transect.download')}
            </button>
            <button id="transect-close" type="button" aria-label={t('transect.close')} onClick={close}>
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </div>
        </div>
        <p id="transect-empty" className="instruction" hidden={hasAir(result)}>
          {t('transect.empty')}
        </p>
        <canvas
          ref={canvasRef}
          id="transect-chart"
          height={250}
          tabIndex={0}
          role="img"
          aria-label={t('transect.chartLabel')}
          aria-describedby="transect-reading"
          onClick={chartClick}
          onKeyDown={chartKey}
        >
          {t('transect.chartFallback')}
        </canvas>
        <div className="transect-key">
          <span className="transect-color-ramp" aria-hidden="true" />
          <span id="transect-scale">{t('transect.scale', { max: format(maxValue) })}</span>
          <span>
            <i className="transect-solid" aria-hidden="true" />
            {t('transect.legendSolid')}
          </span>
          <span>
            <i className="transect-no-data" aria-hidden="true" />
            {t('transect.legendNoData')}
          </span>
        </div>
        <p id="transect-reading" className="transect-reading" role="status" aria-live="polite">
          {readingText(selectedReading(result, selection.position, selection.layer), t, format)}
        </p>
      </section>
    ) : null;

  return (
    <section className="analysis-section" id="transect-panel" aria-labelledby="transect-heading">
      <div className="section-heading">
        <h2 id="transect-heading">{t('transect.title')}</h2>
        <HelpTrigger label={t('transect.helpLabel')} text={t('transect.help')} />
      </div>
      <div className="analysis-actions">
        <button ref={drawRef} id="transect-draw" type="button" hidden={drawing} disabled={!runId || busy} onClick={startDrawing}>
          {line ? t('transect.redraw') : t('transect.draw')}
        </button>
        <button
          id="transect-finish"
          type="button"
          className="action-primary"
          hidden={!drawing}
          disabled={!canFinishTransect(points)}
          onClick={finish}
        >
          {t('transect.finish')}
        </button>
        <button id="transect-cancel" type="button" hidden={!drawing} onClick={cancelDrawing}>
          {t('transect.cancel')}
        </button>
        <button id="transect-clear" type="button" hidden={!line || drawing} onClick={clear}>
          {t('transect.clear')}
        </button>
      </div>
      <p id="transect-note" className="note" role="status">
        {renderMsg(note, t, formatNumber)}
      </p>
      <div id="transect-settings" hidden={!line || drawing}>
        <div className="analysis-height">
          <label htmlFor="transect-min">
            {t('transect.min')}
            <input
              id="transect-min"
              type="number"
              min={0}
              step="any"
              value={min}
              onChange={(event) => changeHeight(setMin, event.target.value)}
            />
          </label>
          <label htmlFor="transect-max">
            {t('transect.max')}
            <input
              id="transect-max"
              type="number"
              min={0}
              max={height || undefined}
              step="any"
              value={max}
              onChange={(event) => changeHeight(setMax, event.target.value)}
            />
          </label>
        </div>
        <div className="analysis-actions">
          <button
            ref={queryRef}
            id="transect-query"
            type="button"
            className="action-primary"
            disabled={!line || drawing || busy || !runId || modified}
            onClick={query}
          >
            {queryLabel}
          </button>
        </div>
      </div>
      <p id="transect-feedback" className="note analysis-feedback" role="status" aria-busy={busy}>
        {renderMsg(shownFeedback, t, formatNumber)}
      </p>
      {resultPanel && createPortal(resultPanel, document.body)}
    </section>
  );
}
