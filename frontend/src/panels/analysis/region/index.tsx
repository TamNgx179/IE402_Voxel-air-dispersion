/**
 * Region analysis sub-mode (port of the region part of web/viewer-analysis.js).
 *
 * Draw a polygon on the map (≥3 clicks, Finish / Cancel / Escape, max 499 vertices),
 * choose a height range and reference threshold, then POST /runs/:id/region.
 * Only the latest request may update the UI; the result (and its CSV) is dropped
 * whenever the run, the inputs or the illustration state change.
 */
import { PathLayer } from '@deck.gl/layers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpTrigger } from '../../../components/Help';
import { useExportContribution } from '../../../export/ExportProvider';
import { useI18n } from '../../../i18n';
import {
  MAX_DRAWN_VERTICES,
  analysisErrorKey,
  closePolygon,
  latestTask,
  regionRequest,
  type LngLat,
  type PolygonGeometry,
  type RegionRequest,
} from '../../../lib/analysis';
import { analysisCsvFilename, csvBlob, download } from '../../../lib/export';
import { runLabel } from '../../../lib/labels';
import { useMapClick, useMapInstance, useMapLayers } from '../../../map/hooks';
import { selectExact, selectGrid, selectZ } from '../../../store/selectors';
import { useApi } from '../../../store/controller';
import { useViewer } from '../../../store/store';
import { useRenderMessage, type PanelMessage } from '../messages';
import type { AnalysisModeDefinition, AnalysisModeProps } from '../modes';
import { RegionSummary, type RegionResult } from './RegionSummary';

interface SavedResult {
  result: RegionResult;
  request: RegionRequest;
  run: string;
}

const OUTLINE_COLOR: [number, number, number] = [66, 106, 133];

function RegionMode({ active }: AnalysisModeProps) {
  const { t } = useI18n();
  const render = useRenderMessage();
  const api = useApi();
  const instance = useMapInstance();
  const runId = useViewer((s) => s.selectedRunId);
  const runs = useViewer((s) => s.runs);
  const exact = useViewer(selectExact);
  const grid = useViewer(selectGrid);
  const z = useViewer(selectZ);
  const height = grid ? grid.nz * grid.dz_m : 0;

  const [polygon, setPolygonState] = useState<PolygonGeometry | null>(null);
  const [points, setPoints] = useState<LngLat[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('15');
  const [threshold, setThreshold] = useState('15');
  const [result, setResult] = useState<SavedResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [feedback, setFeedback] = useState<PanelMessage | null>(null);
  const [note, setNote] = useState<PanelMessage | null>(null);

  const task = useRef(latestTask());
  const polygonRef = useRef<PolygonGeometry | null>(null);
  const pointsRef = useRef<LngLat[]>([]);
  const resultRef = useRef<SavedResult | null>(null);
  const busyRef = useRef(false);
  const exportBusyRef = useRef(false);
  /** doubleClickZoom state saved when drawing starts (null = not drawing). */
  const zoomBackup = useRef<boolean | null>(null);
  const focusDraw = useRef(false);
  const drawButton = useRef<HTMLButtonElement>(null);
  const resultSection = useRef<HTMLElement>(null);
  const mapRef = useRef(instance?.map ?? null);
  mapRef.current = instance?.map ?? null;

  const updatePolygon = (value: PolygonGeometry | null) => {
    polygonRef.current = value;
    setPolygonState(value);
  };
  const updatePoints = (value: LngLat[]) => {
    pointsRef.current = value;
    setPoints(value);
  };

  /** Form changes drop the result and its CSV, even while the old request is in flight. */
  const clearRegion = useCallback(() => {
    task.current.invalidate();
    resultRef.current = null;
    setResult(null);
    busyRef.current = false;
    setBusy(false);
    exportBusyRef.current = false;
    setExportBusy(false);
    setFeedback(null);
  }, []);

  const restoreZoom = useCallback(() => {
    if (zoomBackup.current === null) return;
    if (zoomBackup.current) mapRef.current?.doubleClickZoom?.enable();
    zoomBackup.current = null;
  }, []);

  const endDrawing = useCallback(() => {
    setDrawing(false);
    restoreZoom();
  }, [restoreZoom]);

  const cancelDrawing = useCallback(() => {
    updatePoints([]);
    endDrawing();
    clearRegion();
    setNote(polygonRef.current ? { key: 'region.note.keptPrevious' } : null);
  }, [endDrawing, clearRegion]);

  const startDrawing = () => {
    if (drawing || busyRef.current || !runId) return;
    clearRegion();
    updatePoints([]);
    setDrawing(true);
    const map = mapRef.current;
    if (map?.doubleClickZoom) {
      zoomBackup.current = map.doubleClickZoom.isEnabled();
      map.doubleClickZoom.disable();
    } else zoomBackup.current = false;
    setNote({ key: 'region.note.start' });
  };

  const finishDrawing = () => {
    try {
      const value = closePolygon(pointsRef.current);
      updatePolygon(value);
      updatePoints([]);
      endDrawing();
      clearRegion();
      setNote({ key: 'region.note.selected', params: { count: value.coordinates[0].length - 1 } });
    } catch (error) {
      setNote(analysisErrorKey(error));
    }
  };

  const clearPolygon = () => {
    updatePolygon(null);
    cancelDrawing();
  };

  // Map clicks add vertices while drawing (cell/building picks are off meanwhile).
  useMapClick(
    (event) => {
      const current = pointsRef.current;
      if (current.length >= MAX_DRAWN_VERTICES) {
        setNote({ key: 'region.note.maxVertices', params: { max: MAX_DRAWN_VERTICES } });
        return;
      }
      const next = [...current, event.lngLat];
      updatePoints(next);
      setNote(
        next.length < 3
          ? { key: 'region.note.progress', params: { count: next.length } }
          : { key: 'region.note.ready', params: { count: next.length } },
      );
    },
    { enabled: active && drawing, drawing: true },
  );

  // Switching mode or tool cancels drawing (legacy analysisMode / tool change).
  useEffect(() => {
    if (!active && drawing) cancelDrawing();
  }, [active, drawing, cancelDrawing]);

  // Escape cancels drawing and returns focus to the draw button.
  useEffect(() => {
    if (!drawing) {
      if (focusDraw.current) {
        focusDraw.current = false;
        drawButton.current?.focus();
      }
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      focusDraw.current = true;
      cancelDrawing();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawing, cancelDrawing]);

  // Never leave the map with double-click zoom disabled.
  useEffect(() => () => restoreZoom(), [restoreZoom]);

  // A run switch keeps the polygon but drops the result of the previous run.
  const previousRun = useRef(runId);
  useEffect(() => {
    if (previousRun.current === runId) return;
    previousRun.current = runId;
    clearRegion();
    setNote(polygonRef.current ? { key: 'region.note.runChanged' } : null);
  }, [runId, clearRegion]);

  // Entering or leaving the illustration drops the exact result.
  const previousExact = useRef(exact);
  useEffect(() => {
    if (previousExact.current === exact) return;
    previousExact.current = exact;
    clearRegion();
  }, [exact, clearRegion]);

  useEffect(() => {
    if (result && active) resultSection.current?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
  }, [result, active]);

  const onInput = (setter: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setter(event.target.value);
    clearRegion();
    setNote({ key: 'region.note.inputChanged' });
  };

  const query = async () => {
    if (busyRef.current) return;
    clearRegion();
    let request: RegionRequest;
    try {
      request = regionRequest({ polygon: polygonRef.current, runId, modified: !exact, min, max, threshold, height });
    } catch (error) {
      setFeedback(analysisErrorKey(error));
      return;
    }
    const run = runId as string;
    busyRef.current = true;
    setBusy(true);
    setFeedback({ key: 'region.feedback.loading' });
    await task.current.run(
      () => api<RegionResult>(`/runs/${encodeURIComponent(run)}/region`, { method: 'POST', body: JSON.stringify(request) }),
      (data) => {
        const saved = { result: data, request, run };
        resultRef.current = saved;
        setResult(saved);
        busyRef.current = false;
        setBusy(false);
        setFeedback(null);
      },
      (error) => {
        busyRef.current = false;
        setBusy(false);
        setFeedback(analysisErrorKey(error));
      },
    );
  };

  const exportCsv = async () => {
    const saved = resultRef.current;
    if (!saved || exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExportBusy(true);
    try {
      const text = await api<string>(`/runs/${encodeURIComponent(saved.run)}/region/csv`, {
        method: 'POST',
        body: JSON.stringify(saved.request),
        responseType: 'text',
      });
      if (saved !== resultRef.current) return;
      download(document, csvBlob(text), analysisCsvFilename('region', saved.run));
      setFeedback({ key: 'region.feedback.csvDone' });
    } catch (error) {
      if (saved === resultRef.current) setFeedback({ key: 'analysis.error.csvFailed', reason: analysisErrorKey(error) });
    } finally {
      if (saved === resultRef.current) {
        exportBusyRef.current = false;
        setExportBusy(false);
      }
    }
  };

  useExportContribution('region', () => {
    const saved = resultRef.current;
    return saved ? { run: saved.run, request: saved.request } : null;
  });

  const layers = useMemo(() => {
    const rings = (drawing ? [points] : (polygon?.coordinates ?? [])).filter((ring) => ring.length > 1);
    if (!rings.length) return null;
    return [
      new PathLayer<number[][]>({
        id: 'analysis-region-outline',
        data: rings,
        getPath: (ring) => ring.map((p) => [p[0], p[1], z + 0.2] as [number, number, number]),
        getColor: OUTLINE_COLOR,
        getWidth: 3,
        widthUnits: 'pixels',
        pickable: false,
      }),
    ];
  }, [drawing, points, polygon, z]);
  // Legacy drew the outline in every mode (and with the tool panel closed).
  useMapLayers('analysis-region', layers);

  const entry = runs.find((run) => run.id === result?.run);
  const shownNote = !runId ? { key: 'region.note.noRun' as const } : note;
  const shownFeedback = !exact ? { key: 'region.feedback.illustration' as const } : feedback;

  return (
    <section className="analysis-section" id="region-panel" aria-labelledby="region-heading">
      <div className="section-heading">
        <h2 id="region-heading">{t('region.title')}</h2>
        <HelpTrigger label={t('region.helpLabel')} text={t('region.help')} />
      </div>
      <div className="analysis-actions">
        <button type="button" id="region-draw" ref={drawButton} hidden={drawing} disabled={!runId || busy} onClick={startDrawing}>
          {polygon ? t('region.redraw') : t('region.draw')}
        </button>
        <button
          type="button"
          id="region-finish"
          className="action-primary"
          hidden={!drawing}
          disabled={points.length < 3}
          onClick={finishDrawing}
        >
          {t('region.finish')}
        </button>
        <button type="button" id="region-cancel" hidden={!drawing} onClick={cancelDrawing}>
          {t('region.cancel')}
        </button>
        <button type="button" id="region-clear" hidden={!polygon || drawing} disabled={busy} onClick={clearPolygon}>
          {t('region.clear')}
        </button>
      </div>
      <p className="note" id="region-note" role="status">
        {render(shownNote)}
      </p>
      <div id="region-settings" hidden={!polygon || drawing}>
        <h3 className="step-title">{t('region.heightTitle')}</h3>
        <div className="analysis-height">
          <label htmlFor="region-min">
            {t('region.min')}
            <input id="region-min" type="number" min={0} step="any" value={min} onChange={onInput(setMin)} />
          </label>
          <label htmlFor="region-max">
            {t('region.max')}
            <input id="region-max" type="number" min={0} max={height || undefined} step="any" value={max} onChange={onInput(setMax)} />
          </label>
        </div>
        <div className="field-heading">
          <label htmlFor="region-threshold">{t('region.threshold')}</label>
          <HelpTrigger label={t('region.thresholdHelpLabel')} text={t('region.thresholdHelp')} />
        </div>
        <input id="region-threshold" type="number" min={0} step="any" value={threshold} onChange={onInput(setThreshold)} />
        <div className="analysis-actions">
          <button
            type="button"
            id="region-query"
            className="action-primary"
            disabled={busy || drawing || !polygon || !exact || !runId}
            onClick={() => void query()}
          >
            {busy ? t('region.querying') : result ? t('region.requery') : t('region.query')}
          </button>
        </div>
      </div>
      <p className="note analysis-feedback" id="region-feedback" role="status" aria-busy={busy}>
        {render(shownFeedback)}
      </p>
      <section id="region-result" ref={resultSection} className="analysis-result" aria-label={t('region.resultLabel')} hidden={!result}>
        <div className="section-heading">
          <h3>{t('region.resultTitle')}</h3>
          <HelpTrigger label={t('region.resultHelpLabel')} text={t('region.resultHelp')} />
        </div>
        <div id="region-result-content">
          {result && <RegionSummary result={result.result} runLabel={entry ? runLabel(entry, t) : t('region.summary.runFallback')} />}
        </div>
        <button type="button" id="region-export" hidden={!result} disabled={!result || exportBusy} onClick={() => void exportCsv()}>
          {exportBusy ? t('region.exporting') : t('region.export')}
        </button>
      </section>
    </section>
  );
}

export const regionMode: AnalysisModeDefinition = {
  id: 'region',
  labelKey: 'region.modeLabel',
  Component: RegionMode,
};
