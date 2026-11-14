/**
 * Map-options panel (legacy #map-options): basemap, display layers, building note,
 * result information (model note + run evidence) and the PNG/CSV/JSON export.
 * Display options never change the simulation data.
 */
import { useMemo, useRef, useState } from 'react';
import { AppError, errorMessage } from '../../api/client';
import { HelpTrigger } from '../../components/Help';
import { RunEvidence } from '../../components/RunEvidence';
import { useReportSnapshot } from '../../export/ExportProvider';
import { useI18n } from '../../i18n';
import { csvBlob, download, jsonBlob, png, type ExportKind } from '../../lib/export';
import { modelNoteKey } from '../../lib/labels';
import { useIsDrawing, useMapInstance } from '../../map/hooks';
import { selectBootstrap, selectCurrentEntry, selectCurrentRun } from '../../store/selectors';
import { useViewer, useViewerDispatch } from '../../store/store';
import type { Basemap, LayerToggles } from '../../store/types';
import type { PanelDefinition, PanelProps } from '../types';
import { captureReport } from './capture';
import { normalizeReport, reportCsv, reportFilename } from './exportReport';

type ExportNote = { state: 'preparing' } | { state: 'done' } | { state: 'failed'; error: unknown };

function MapOptionsPanel(_props: PanelProps) {
  const { t, formatNumber } = useI18n();
  const dispatch = useViewerDispatch();
  const bootstrap = useViewer(selectBootstrap);
  const layers = useViewer((s) => s.layers);
  const basemap = useViewer((s) => s.basemap);
  const run = useViewer(selectCurrentRun);
  const entry = useViewer(selectCurrentEntry);
  const pendingRunId = useViewer((s) => s.pendingRunId);
  const selectedBuildingId = useViewer((s) => s.selectedBuildingId);
  const drawing = useIsDrawing();
  const instance = useMapInstance();
  const snapshot = useReportSnapshot();
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [note, setNote] = useState<ExportNote | null>(null);

  const buildingHeights = useMemo(() => {
    const heights = new Map<string, number>();
    for (const feature of bootstrap?.scene.buildings.features ?? [])
      heights.set(feature.properties.source_feature_id, feature.properties.height_m);
    return heights;
  }, [bootstrap]);
  const buildingHeight = selectedBuildingId ? buildingHeights.get(selectedBuildingId) : undefined;

  const grid = bootstrap?.grid;
  const windNote =
    pendingRunId && !run ? t('mapOptions.windLoading') : !run || !layers.wind || !run.windField ? t('mapOptions.windMissing') : '';

  const setLayer = (layer: keyof LayerToggles, visible: boolean) => dispatch({ type: 'layers/set', layer, visible });

  const exportDisabled = busy || drawing || !run || !entry;

  async function exportResult(kind: ExportKind) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote({ state: 'preparing' });
    try {
      const report = snapshotRef.current();
      const filename = reportFilename(report, kind);
      let blob: Blob;
      if (kind === 'png') {
        if (!instance) throw new AppError('mapOptions.error.mapNotReady');
        blob = await png(await captureReport(instance, report, () => snapshotRef.current(), t));
      } else if (kind === 'csv') blob = csvBlob(reportCsv(report));
      else blob = jsonBlob(normalizeReport(report));
      download(document, blob, filename);
      setNote({ state: 'done' });
    } catch (error) {
      setNote({ state: 'failed', error });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const noteText = !note
    ? ''
    : note.state === 'preparing'
      ? t('mapOptions.exportPreparing')
      : note.state === 'done'
        ? t('mapOptions.exportDone')
        : (() => {
            const { key, params } = errorMessage(note.error);
            return t('mapOptions.exportFailed', { message: t(key, params) });
          })();

  return (
    <>
      <div className="section-heading">
        <h2 id="map-options-title" className="tool-panel-title">
          {t('mapOptions.title')}
        </h2>
        <HelpTrigger label={t('mapOptions.helpLabel')} text={t('mapOptions.help')} />
      </div>
      <p id="grid-size" className="note">
        {grid
          ? t('mapOptions.gridSize', {
              dx: formatNumber(grid.dx_m),
              dy: formatNumber(grid.dy_m),
              nx: String(grid.nx),
              ny: String(grid.ny),
            })
          : ''}
      </p>
      <div className="row">
        <label htmlFor="basemap-style">{t('mapOptions.basemap')}</label>
        <select
          id="basemap-style"
          value={basemap}
          onChange={(event) => dispatch({ type: 'basemap/set', basemap: event.target.value as Basemap })}
        >
          <option value="vector">{t('mapOptions.basemapVector')}</option>
          <option value="raster">{t('mapOptions.basemapRaster')}</option>
        </select>
      </div>
      <label className="check">
        <input id="show-buildings" type="checkbox" checked={layers.buildings} onChange={(e) => setLayer('buildings', e.target.checked)} />{' '}
        {t('mapOptions.buildings')}
      </label>
      <div className="option-help-row">
        <label className="check">
          <input
            id="show-facades"
            type="checkbox"
            checked={layers.facades}
            disabled={!layers.buildings}
            onChange={(e) => setLayer('facades', e.target.checked)}
          />{' '}
          {t('mapOptions.facades')}
        </label>
        <HelpTrigger label={t('mapOptions.facadesHelpLabel')} text={t('mapOptions.facadesHelp')} />
      </div>
      <p id="building-appearance-note" className="note" aria-live="polite">
        {buildingHeight !== undefined ? t('mapOptions.buildingSelected', { height: formatNumber(buildingHeight) }) : ''}
      </p>
      <label className="check">
        <input id="show-roads" type="checkbox" checked={layers.roads} onChange={(e) => setLayer('roads', e.target.checked)} />{' '}
        {t('mapOptions.roads')}
      </label>
      <div className="option-help-row">
        <label className="check">
          <input id="show-wind" type="checkbox" checked={layers.wind} onChange={(e) => setLayer('wind', e.target.checked)} />{' '}
          {t('mapOptions.wind')} <span className="wind-key" aria-hidden="true" />
        </label>
        <HelpTrigger label={t('mapOptions.windHelpLabel')} text={t('mapOptions.windHelp')} />
      </div>
      <p id="wind-source-note" className="note wind-disclaimer">
        {windNote}
      </p>
      <div className="result-info-toggle">
        <button
          type="button"
          className="text-button"
          aria-controls="result-info-content"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((open) => !open)}
        >
          {t('mapOptions.resultInfo')}
        </button>
        <HelpTrigger label={t('mapOptions.resultInfoHelpLabel')} text={t('mapOptions.resultInfoHelp')} />
      </div>
      <div id="result-info-content" hidden={!infoOpen}>
        {/* Legacy keeps the model note hidden (the evidence heading names the model). */}
        <p id="model-note" hidden>
          {t(modelNoteKey(entry?.model))}
        </p>
        <RunEvidence />
      </div>
      <div className="report-export" role="group" aria-label={t('mapOptions.exportLabel')}>
        <h3>{t('mapOptions.exportTitle')}</h3>
        <button id="export-map" type="button" aria-label={t('mapOptions.exportPngLabel')} disabled={exportDisabled} onClick={() => void exportResult('png')}>
          <i className="bi bi-image" aria-hidden="true" /> {t('mapOptions.exportPng')}
        </button>
        <button id="export-data" type="button" aria-label={t('mapOptions.exportCsvLabel')} disabled={exportDisabled} onClick={() => void exportResult('csv')}>
          <i className="bi bi-file-earmark-spreadsheet" aria-hidden="true" /> {t('mapOptions.exportCsv')}
        </button>
        <button
          id="export-metadata"
          type="button"
          aria-label={t('mapOptions.exportJsonLabel')}
          disabled={exportDisabled}
          onClick={() => void exportResult('json')}
        >
          <i className="bi bi-file-earmark-code" aria-hidden="true" /> {t('mapOptions.exportJson')}
        </button>
        <p id="export-note" role="status" aria-live="polite">
          {noteText}
        </p>
      </div>
    </>
  );
}

export const mapOptionsPanel: PanelDefinition = {
  id: 'map-options',
  icon: 'map',
  labelKey: 'mapOptions.toolLabel',
  elementId: 'map-options',
  Component: MapOptionsPanel,
};
