/**
 * Road corridor × altitude analysis (port of web/viewer-corridor.js + #corridor-panel).
 * Statistics come only from the server's volume-weighted SQL; this component picks
 * roads (map or keyboard list), sends the request and presents the per-band table.
 */
import type { PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, PathLayer } from '@deck.gl/layers';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Feature, Geometry, Position } from '../../../api/geojson';
import type { RoadProperties } from '../../../api/types';
import { HelpTrigger } from '../../../components/Help';
import { useExportContribution } from '../../../export/ExportProvider';
import { useI18n } from '../../../i18n';
import {
  MAX_ROADS,
  bandColor,
  corridorErrorKey,
  corridorRequest,
  lift,
  nearestRoad,
  roadClass,
  roadLabelParts,
  type CorridorRequest,
  type LiftedGeometry,
} from '../../../lib/corridor';
import { analysisCsvFilename, csvBlob, download } from '../../../lib/export';
import { latestTask, throwKeyed } from '../../../lib/analysis';
import { runLabel } from '../../../lib/labels';
import { useMapClick, useMapInstance, useMapLayers } from '../../../map/hooks';
import { selectExact, selectGrid, selectZ } from '../../../store/selectors';
import { useApi } from '../../../store/controller';
import { useViewer } from '../../../store/store';
import { fromError, renderMsg, type Msg } from '../transect/message';

export interface CorridorPanelProps {
  active: boolean;
}

export interface CorridorBand {
  inner_m: number;
  outer_m: number;
  area_m2?: number;
  geometry: Geometry | null;
  air_volume_m3?: number | null;
  valid_volume_m3: number | string | null;
  coverage: number | string | null;
  mean_ug_m3: number | string | null;
  exceedance_volume_m3: number | string | null;
}

export interface CorridorResult {
  run_id: string;
  units: string;
  road_ids: string[];
  z_min_m: number;
  z_max_m: number;
  threshold_ug_m3: number;
  bands: CorridorBand[];
}

interface Saved {
  data: CorridorResult;
  request: CorridorRequest;
  run: string;
}

type Road = Feature<RoadProperties>;

const EMPTY_ROADS: readonly Road[] = [];

function lines(geometry: Geometry | null | undefined): Position[][] {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

const present = (value: unknown): boolean =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

export function CorridorPanel({ active }: CorridorPanelProps) {
  const { t, formatNumber } = useI18n();
  const api = useApi();
  const runId = useViewer((s) => s.selectedRunId);
  const runs = useViewer((s) => s.runs);
  const modified = !useViewer(selectExact);
  const grid = useViewer(selectGrid);
  const z = useViewer(selectZ);
  const roads = (useViewer((s) => s.bootstrap.data?.scene.roads?.features) ?? EMPTY_ROADS) as readonly Road[];
  const height = grid ? grid.nz * grid.dz_m : 0;
  const instance = useMapInstance();

  const [task] = useState(latestTask);
  const [selected, setSelectedState] = useState<string[]>([]);
  const [picking, setPickingState] = useState(false);
  const [distances, setDistances] = useState('10, 25, 50');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('15');
  const [threshold, setThreshold] = useState('15');
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [result, setResultState] = useState<Saved | null>(null);
  const [note, setNote] = useState<Msg | null>(null);
  const [feedback, setFeedback] = useState<Msg | null>(null);

  const resultRef = useRef<Saved | null>(null);
  const selectedRef = useRef<string[]>([]);
  const pickingRef = useRef(false);
  const zoomBackup = useRef<boolean | null>(null);
  const focusPick = useRef(false);
  const pickRef = useRef<HTMLButtonElement>(null);
  const instanceRef = useRef(instance);
  instanceRef.current = instance;

  const setResult = (value: Saved | null) => {
    resultRef.current = value;
    setResultState(value);
  };
  const setSelected = (value: string[]) => {
    selectedRef.current = value;
    setSelectedState(value);
  };
  const setPicking = (value: boolean) => {
    pickingRef.current = value;
    setPickingState(value);
  };

  const selectionNote = (count: number, isPicking: boolean): Msg | null =>
    count
      ? { key: isPicking ? 'corridor.selectedPicking' : 'corridor.selected', params: { count } }
      : isPicking
        ? { key: 'corridor.pickHint' }
        : null;

  function clearResult() {
    task.invalidate();
    setResult(null);
    setBusy(false);
    setExportBusy(false);
    setFeedback(null);
  }

  function commitSelection(next: string[]) {
    setSelected(next);
    clearResult();
    setNote(selectionNote(next.length, pickingRef.current));
  }

  function toggle(id: string) {
    const current = selectedRef.current;
    if (current.includes(id)) commitSelection(current.filter((x) => x !== id));
    else if (current.length >= MAX_ROADS) setNote({ key: 'analysis.corridor.maxRoads', params: { max: MAX_ROADS } });
    else commitSelection([...current, id]);
  }

  function stopPicking() {
    if (!pickingRef.current) return;
    setPicking(false);
    if (zoomBackup.current) instanceRef.current?.map?.doubleClickZoom?.enable();
    zoomBackup.current = null;
    setNote(selectionNote(selectedRef.current.length, false));
  }

  function startPicking() {
    if (pickingRef.current || busy || !runId) return;
    setPicking(true);
    const zoom = instanceRef.current?.map?.doubleClickZoom;
    zoomBackup.current = zoom?.isEnabled() ?? false;
    zoom?.disable();
    setNote(selectionNote(selectedRef.current.length, true));
  }

  useMapClick(
    (event) => {
      if (!pickingRef.current) return;
      const lngLat = event.lngLat;
      const zoom = instanceRef.current?.map?.getZoom?.() ?? 17;
      const metresPerPixel = (78271.517 * Math.cos((lngLat[1] * Math.PI) / 180)) / 2 ** zoom;
      const feature = nearestRoad(roads, lngLat, Math.max(4, 12 * metresPerPixel));
      if (!feature) {
        setNote({ key: 'corridor.noRoadNear' });
        return;
      }
      toggle(feature.properties.source_feature_id);
    },
    { enabled: active && picking, drawing: true },
  );

  // Drop selected ids that are not in the (new) scene.
  useEffect(() => {
    const ids = new Set(roads.map((f) => f.properties.source_feature_id));
    const kept = selectedRef.current.filter((id) => ids.has(id));
    if (kept.length !== selectedRef.current.length) setSelected(kept);
  }, [roads]);

  // Run change: keep the roads, drop the result.
  const lastRun = useRef(runId);
  useEffect(() => {
    if (lastRun.current === runId) return;
    lastRun.current = runId;
    clearResult();
    if (selectedRef.current.length) setFeedback({ key: 'corridor.keptRoads' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const lastModified = useRef(modified);
  useEffect(() => {
    if (lastModified.current === modified) return;
    lastModified.current = modified;
    clearResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modified]);

  useEffect(() => {
    if (!active) stopPicking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !picking) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !pickingRef.current) return;
      stopPicking();
      focusPick.current = true;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, picking]);

  useEffect(() => {
    if (!focusPick.current) return;
    focusPick.current = false;
    pickRef.current?.focus({ preventScroll: true });
  });

  useEffect(
    () => () => {
      if (pickingRef.current && zoomBackup.current) instanceRef.current?.map?.doubleClickZoom?.enable();
    },
    [],
  );

  function listChange(event: ChangeEvent<HTMLSelectElement>) {
    const chosen = [...event.target.options].filter((o) => o.selected).map((o) => o.value);
    if (chosen.length > MAX_ROADS) {
      setNote({ key: 'analysis.corridor.maxRoads', params: { max: MAX_ROADS } });
      // Controlled select: re-render restores the previous selection.
      setSelected([...selectedRef.current]);
      return;
    }
    commitSelection(chosen);
  }

  function changeInput(setter: (value: string) => void, value: string) {
    setter(value);
    if (!resultRef.current) return;
    clearResult();
    setNote({ key: 'corridor.refresh' });
  }

  async function query() {
    if (busy) return;
    clearResult();
    let request: CorridorRequest;
    try {
      if (!runId) throwKeyed('analysis.corridor.noRun');
      if (modified) throwKeyed('analysis.validation.modified');
      request = corridorRequest({ roadIds: selected, distances, min, max, threshold, height });
    } catch (error) {
      setFeedback(fromError(corridorErrorKey(error)));
      return;
    }
    const run = runId as string;
    setBusy(true);
    setFeedback({ key: 'corridor.loading' });
    await task.run(
      () => api<CorridorResult>(`/runs/${run}/road-corridor`, { method: 'POST', body: JSON.stringify(request) }),
      (data) => {
        setBusy(false);
        setResult({ data, request, run });
        setFeedback(null);
      },
      (error) => {
        setBusy(false);
        setFeedback(fromError(corridorErrorKey(error)));
      },
    );
  }

  async function exportCsv() {
    const saved = resultRef.current;
    if (!saved || exportBusy) return;
    setExportBusy(true);
    try {
      const text = await api<string>(`/runs/${saved.run}/road-corridor/csv`, {
        method: 'POST',
        body: JSON.stringify(saved.request),
        responseType: 'text',
      });
      if (saved !== resultRef.current) return;
      download(document, csvBlob(text), analysisCsvFilename('road-corridor', saved.run));
      setFeedback({ key: 'corridor.csvDone' });
    } catch (error) {
      if (saved === resultRef.current)
        setFeedback({ key: 'analysis.error.csvFailed', reason: fromError(corridorErrorKey(error)) });
    } finally {
      if (saved === resultRef.current) setExportBusy(false);
    }
  }

  useExportContribution('road_corridor', () => (result ? { run: result.run, request: result.request } : null));

  // ---------------------------------------------------------------- map layers
  const fmt = useCallback(
    (value: unknown, digits = 4) =>
      present(value) ? formatNumber(Number(value), { maximumSignificantDigits: digits }) : t('corridor.noData'),
    [formatNumber, t],
  );

  const roadPaths = useMemo(
    () => roads.flatMap((f) => lines(f.geometry).map((path) => ({ path, id: f.properties.source_feature_id }))),
    [roads],
  );

  const layers = useMemo(() => {
    if (!active) return null;
    const out = [];
    if (result && result.run === runId) {
      const means = result.data.bands.map((b) => b.mean_ug_m3).filter(present).map(Number);
      const lo = means.length ? Math.min(...means) : 0,
        hi = means.length ? Math.max(...means) : 1;
      const features = result.data.bands
        .map((band) => ({ type: 'Feature' as const, geometry: lift(band.geometry, z + 0.1), properties: band }))
        .filter((f): f is { type: 'Feature'; geometry: LiftedGeometry; properties: CorridorBand } => Boolean(f.geometry));
      out.push(
        new GeoJsonLayer({
          id: 'corridor-bands',
          data: { type: 'FeatureCollection', features } as never,
          filled: true,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 1,
          getLineColor: [66, 106, 133, 160],
          getFillColor: ((f: { properties: CorridorBand }) =>
            bandColor(f.properties.mean_ug_m3 as number | null, lo, hi)) as never,
          pickable: !picking,
          parameters: { depthWriteEnabled: false } as never,
          updateTriggers: { getFillColor: [result] },
        }),
      );
    }
    const chosen = new Set(selected);
    out.push(
      new PathLayer<{ path: Position[]; id: string }>({
        id: 'corridor-roads',
        data: roadPaths,
        getPath: (d) => d.path.map((p) => [p[0], p[1], z + 0.25]) as never,
        getColor: (d) => (chosen.has(d.id) ? [214, 92, 38, 255] : [107, 126, 116, picking ? 200 : 110]),
        getWidth: (d) => (chosen.has(d.id) ? 5 : 2),
        widthUnits: 'pixels',
        pickable: false,
        parameters: { depthWriteEnabled: false } as never,
        updateTriggers: { getColor: [selected.join(), picking], getWidth: [selected.join()], getPath: [z] },
      }),
    );
    return out;
  }, [active, result, runId, z, selected, picking, roadPaths]);

  const tooltip = useCallback(
    (info: PickingInfo) => {
      if (info.layer?.id !== 'corridor-bands' || !info.object) return null;
      const band = (info.object as { properties: CorridorBand }).properties;
      return t('corridor.tooltip', { inner: fmt(band.inner_m), outer: fmt(band.outer_m), mean: fmt(band.mean_ug_m3) });
    },
    [t, fmt],
  );
  useMapLayers('corridor', layers, { tooltip });

  // ---------------------------------------------------------------- render
  const roadOptions = useMemo(
    () =>
      roads.map((feature, index) => {
        const kind = roadClass(feature);
        const parts = roadLabelParts(feature, index);
        return {
          id: feature.properties.source_feature_id,
          label: t('analysis.corridor.roadLabel', {
            index: parts.index,
            kind: 'key' in kind ? t(kind.key) : kind.text,
            length: formatNumber(parts.lengthM, { maximumSignificantDigits: 3 }),
          }),
        };
      }),
    [roads, t, formatNumber],
  );

  const shownNote: Msg | null = !runId ? { key: 'corridor.noRunNote' } : note;
  const shownFeedback: Msg | null = modified ? { key: 'corridor.illustration' } : feedback;
  const entry = result ? runs.find((r) => r.id === result.run) : undefined;
  const label = entry ? runLabel(entry, t) : t('corridor.currentResult');
  const hasSelection = selected.length > 0;

  return (
    <section className="analysis-section" id="corridor-panel" aria-labelledby="corridor-heading">
      <div className="section-heading">
        <h2 id="corridor-heading">{t('corridor.title')}</h2>
        <HelpTrigger label={t('corridor.helpLabel')} text={t('corridor.help')} />
      </div>
      <div className="analysis-actions">
        <button ref={pickRef} type="button" id="corridor-pick" hidden={picking} disabled={!runId || busy} onClick={startPicking}>
          {t('corridor.pick')}
        </button>
        <button type="button" id="corridor-pick-done" className="action-primary" hidden={!picking} onClick={stopPicking}>
          {t('corridor.pickDone')}
        </button>
        <button
          type="button"
          id="corridor-clear"
          hidden={!hasSelection || picking}
          disabled={busy}
          onClick={() => commitSelection([])}
        >
          {t('corridor.clear')}
        </button>
      </div>
      <p className="note" id="corridor-note" role="status">
        {renderMsg(shownNote, t, formatNumber)}
      </p>
      <label htmlFor="corridor-road-list">{t('corridor.list')}</label>
      <select id="corridor-road-list" multiple size={5} value={selected} onChange={listChange}>
        {roadOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <div id="corridor-settings" hidden={!hasSelection || picking}>
        <div className="field-heading">
          <label htmlFor="corridor-distances">{t('corridor.distances')}</label>
          <HelpTrigger label={t('corridor.distancesHelpLabel')} text={t('corridor.distancesHelp')} />
        </div>
        <input
          id="corridor-distances"
          type="text"
          inputMode="decimal"
          value={distances}
          onChange={(event) => changeInput(setDistances, event.target.value)}
        />
        <div className="analysis-height">
          <label htmlFor="corridor-min">
            {t('corridor.min')}
            <input
              id="corridor-min"
              type="number"
              min={0}
              step="any"
              value={min}
              onChange={(event) => changeInput(setMin, event.target.value)}
            />
          </label>
          <label htmlFor="corridor-max">
            {t('corridor.max')}
            <input
              id="corridor-max"
              type="number"
              min={0}
              max={height || undefined}
              step="any"
              value={max}
              onChange={(event) => changeInput(setMax, event.target.value)}
            />
          </label>
        </div>
        <label htmlFor="corridor-threshold">{t('corridor.threshold')}</label>
        <input
          id="corridor-threshold"
          type="number"
          min={0}
          step="any"
          value={threshold}
          onChange={(event) => changeInput(setThreshold, event.target.value)}
        />
        <div className="analysis-actions">
          <button
            type="button"
            id="corridor-query"
            className="action-primary"
            disabled={busy || picking || !hasSelection || modified || !runId}
            onClick={query}
          >
            {busy ? t('corridor.querying') : result ? t('corridor.queryAgain') : t('corridor.query')}
          </button>
        </div>
      </div>
      <p className="note analysis-feedback" id="corridor-feedback" role="status" aria-busy={busy}>
        {renderMsg(shownFeedback, t, formatNumber)}
      </p>
      <section id="corridor-result" className="analysis-result" aria-label={t('corridor.resultLabel')} hidden={!result}>
        <div className="section-heading">
          <h3>{t('corridor.resultTitle')}</h3>
          <HelpTrigger label={t('corridor.resultHelpLabel')} text={t('corridor.resultHelp')} />
        </div>
        <div id="corridor-result-content">{result && <CorridorSummary data={result.data} runLabel={label} fmt={fmt} />}</div>
        <button type="button" id="corridor-export" hidden={!result} disabled={!result || exportBusy} onClick={exportCsv}>
          {exportBusy ? t('corridor.downloading') : t('corridor.download')}
        </button>
      </section>
    </section>
  );
}

function CorridorSummary({
  data,
  runLabel: run,
  fmt,
}: {
  data: CorridorResult;
  runLabel: string;
  fmt: (value: unknown, digits?: number) => string;
}) {
  const { t } = useI18n();
  const valid = data.bands.filter((band) => present(band.mean_ug_m3));
  let insight: string | null = null;
  if (valid.length > 1) {
    const near = valid[0],
      far = valid[valid.length - 1];
    const diff = Number(near.mean_ug_m3) - Number(far.mean_ug_m3);
    const params = {
      nearInner: fmt(near.inner_m),
      nearOuter: fmt(near.outer_m),
      farInner: fmt(far.inner_m),
      farOuter: fmt(far.outer_m),
      diff: fmt(Math.abs(diff)),
    };
    insight = t(diff === 0 ? 'corridor.insightSame' : diff > 0 ? 'corridor.insightHigher' : 'corridor.insightLower', params);
  }
  const percent = (value: number) => t('corridor.percent', { value: fmt(value, 3) });
  return (
    <>
      <p className="result-context">
        {t('corridor.context', {
          run,
          count: data.road_ids.length,
          min: fmt(data.z_min_m),
          max: fmt(data.z_max_m),
        })}
      </p>
      {!valid.length && (
        <>
          <p className="result-insight">{t('corridor.noAir')}</p>
          <p className="note">{t('corridor.noAirNote')}</p>
        </>
      )}
      {insight && <p className="result-insight">{insight}</p>}
      <div className="result-table-scroll" tabIndex={0} role="region" aria-label={t('corridor.tableLabel')}>
        <table className="result-table">
          <caption>{t('corridor.caption', { threshold: fmt(data.threshold_ug_m3) })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('corridor.colBand')}</th>
              <th scope="col">{t('corridor.colMean')}</th>
              <th scope="col">{t('corridor.colCoverage')}</th>
              <th scope="col">{t('corridor.colExceedance')}</th>
            </tr>
          </thead>
          <tbody>
            {data.bands.map((band) => {
              const validVolume = Number(band.valid_volume_m3);
              return (
                <tr key={`${band.inner_m}-${band.outer_m}`}>
                  <td>{`${fmt(band.inner_m)}–${fmt(band.outer_m)}`}</td>
                  <td>{fmt(band.mean_ug_m3)}</td>
                  <td>{present(band.coverage) ? percent(Number(band.coverage) * 100) : t('corridor.noData')}</td>
                  <td>
                    {validVolume > 0
                      ? percent((Number(band.exceedance_volume_m3) / validVolume) * 100)
                      : t('corridor.noData')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">{t('corridor.modelNote')}</p>
    </>
  );
}
