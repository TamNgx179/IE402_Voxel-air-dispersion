/** Map overlays: camera toolbar, pan/cell switch, wind HUD, cell info, status box, query feedback. */
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../api/client';
import { useI18n, type TranslationKey } from '../i18n';
import { valueAt } from '../lib/concentration';
import { compass, layerWind } from '../lib/flow';
import { useIsDrawing, useMapInstance } from '../map/hooks';
import { useViewerActions } from '../store/controller';
import { selectCurrentEntry, selectCurrentRun, selectExact, selectSelectedProfile } from '../store/selectors';
import { useViewer, useViewerDispatch } from '../store/store';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export function CameraToolbar() {
  const { t } = useI18n();
  const instance = useMapInstance();
  const reduced = usePrefersReducedMotion();
  const [camera, setCamera] = useState({ pitch: 55, bearing: -25 });
  useEffect(() => {
    if (!instance) return;
    const { map } = instance;
    const update = () => setCamera({ pitch: map.getPitch(), bearing: map.getBearing() });
    update();
    map.on('rotate', update);
    map.on('pitch', update);
    return () => {
      map.off('rotate', update);
      map.off('pitch', update);
    };
  }, [instance]);
  const is3d = camera.pitch > 5;
  const rotate = (delta: number) => instance?.map.easeTo({ bearing: instance.map.getBearing() + delta, duration: reduced ? 0 : 300 });
  return (
    <nav className="camera-toolbar" aria-label={t('viewer.cameraToolbar')}>
      <button id="rotate-left" type="button" aria-label={t('viewer.rotateLeft')} title={t('viewer.rotateLeftTitle')} onClick={() => rotate(-20)}>
        <i className="bi bi-arrow-counterclockwise" aria-hidden="true" />
      </button>
      <button
        id="reset-camera"
        type="button"
        aria-label={t('viewer.resetCamera')}
        title={t('viewer.resetCamera')}
        data-bearing={camera.bearing.toFixed(1)}
        onClick={() => instance?.resetView()}
      >
        <i className="bi bi-compass" aria-hidden="true" />
      </button>
      <button id="rotate-right" type="button" aria-label={t('viewer.rotateRight')} title={t('viewer.rotateRightTitle')} onClick={() => rotate(20)}>
        <i className="bi bi-arrow-clockwise" aria-hidden="true" />
      </button>
      <button
        id="toggle-3d"
        type="button"
        aria-pressed={is3d}
        aria-label={is3d ? t('viewer.to2d') : t('viewer.to3d')}
        data-pitch={camera.pitch.toFixed(1)}
        onClick={() => instance?.map.easeTo({ pitch: is3d ? 0 : 55, duration: reduced ? 0 : 350 })}
      >
        {is3d ? '2D' : '3D'}
      </button>
    </nav>
  );
}

export function MapInteraction() {
  const { t } = useI18n();
  const dispatch = useViewerDispatch();
  const mode = useViewer((s) => s.mapMode);
  const drawing = useIsDrawing();
  return (
    <div className="map-interaction" role="group" aria-label={t('viewer.mapInteraction')}>
      <button id="map-pan-mode" type="button" aria-pressed={mode === 'pan'} disabled={drawing} onClick={() => dispatch({ type: 'mapMode/set', mode: 'pan' })}>
        <i className="bi bi-arrows-move" aria-hidden="true" /> {t('viewer.panMode')}
      </button>
      <button id="map-cell-mode" type="button" aria-pressed={mode === 'cell'} disabled={drawing} onClick={() => dispatch({ type: 'mapMode/set', mode: 'cell' })}>
        <i className="bi bi-cursor-fill" aria-hidden="true" /> {t('viewer.cellMode')}
      </button>
    </div>
  );
}

export function WindHud() {
  const { t, formatNumber } = useI18n();
  const dispatch = useViewerDispatch();
  const entry = useViewer(selectCurrentEntry);
  const run = useViewer(selectCurrentRun);
  const showWind = useViewer((s) => s.layers.wind);
  const windPaused = useViewer((s) => s.windPaused);
  const layer = useViewer((s) => s.layer);
  const reduced = usePrefersReducedMotion();
  const paused = windPaused || reduced;
  const wind = useMemo(() => {
    const vectors = run?.windField?.layers.find((item) => item.k === layer)?.vectors ?? [];
    return layerWind(vectors);
  }, [run, layer]);
  const hidden = !entry || !showWind || !run?.windField || !wind;
  const motionLabel = paused ? t('viewer.windResume') : t('viewer.windPause');
  return (
    <aside id="wind-hud" className="wind-hud" aria-live="polite" hidden={hidden}>
      <span id="wind-arrow" className="wind-arrow" aria-hidden="true" style={wind ? { transform: `rotate(${wind.toDeg}deg)` } : undefined}>
        <i className="bi bi-arrow-up" />
      </span>
      <span>
        <strong id="wind-summary">
          {wind
            ? t('viewer.windSummary', {
                speed: formatNumber(wind.speed),
                compass: t(`viewer.compass${compass(wind.fromDeg)}` as TranslationKey),
                deg: wind.fromDeg.toFixed(0),
              })
            : t('viewer.windLoading')}
        </strong>
        <small id="wind-caption">
          {run?.windField ? t('viewer.windCaptionSolver', { state: paused ? t('viewer.windPausedState') : t('viewer.windMovingState') }) : t('viewer.windCaption')}
        </small>
      </span>
      <button
        id="wind-motion"
        className="icon-button"
        type="button"
        aria-label={motionLabel}
        title={motionLabel}
        aria-pressed={paused}
        onClick={() => dispatch({ type: 'wind/paused', paused: !windPaused })}
      >
        <i className={paused ? 'bi bi-play-fill' : 'bi bi-pause-fill'} aria-hidden="true" />
      </button>
    </aside>
  );
}

export function CellInfo() {
  const { t, formatNumber } = useI18n();
  const cell = useViewer((s) => s.selectedCell);
  const run = useViewer(selectCurrentRun);
  const layer = useViewer((s) => s.layer);
  const grid = useViewer((s) => s.bootstrap.data?.grid);
  const exact = useViewer(selectExact);
  const display = useViewer((s) => s.display);
  const profile = useViewer(selectSelectedProfile);
  const queryFailed = useViewer((s) => s.queries.status === 'error');
  if (!cell || !run || !grid) return <aside id="cell-info" className="cell-info" aria-live="polite" hidden />;
  const { i, j } = cell;
  const k = layer;
  const value = exact ? profile?.levels[k]?.concentration_ug_m3 : valueAt(run.volume, grid, display, k, j, i);
  let reading: string;
  if (exact && !profile) reading = queryFailed ? t('viewer.cellInfoFailed') : t('viewer.cellInfoQuerying');
  else if (typeof value === 'number' && Number.isFinite(value))
    reading = t(exact ? 'viewer.cellInfoExact' : 'viewer.cellInfoAdjusted', { value: formatNumber(value) });
  else reading = t('viewer.cellInfoSolid');
  return (
    <aside id="cell-info" className="cell-info" aria-live="polite">
      {t('viewer.cellInfoHeader', { i, j, k })}
      {'\n'}
      {t('viewer.cellInfoGeometry', { z: formatNumber(grid.z_centres_m[k]), dx: formatNumber(grid.dx_m), dy: formatNumber(grid.dy_m) })}
      {'\n'}
      {reading}
    </aside>
  );
}

export function StatusBox() {
  const { t } = useI18n();
  const status = useViewer((s) => s.status);
  const text = status.message
    ? t(status.message.key, { ...status.message.params, message: status.error === undefined ? '' : t(errorMessage(status.error).key, errorMessage(status.error).params) })
    : '';
  // "Result loaded" confirmations are not kept on screen (legacy setStatus).
  const hidden = !text || (status.kind === 'pass' && status.message?.key === 'viewer.statusResultLoaded');
  return (
    <div id="status-box" role="status" aria-live="polite" hidden={hidden}>
      <span id="status" className={status.kind === 'info' ? '' : status.kind}>
        {text}
      </span>
      <button id="status-retry" type="button" hidden={!status.retry} onClick={() => status.retry?.()}>
        {t('common.retry')}
      </button>
    </div>
  );
}

export function QueryFeedback() {
  const { t } = useI18n();
  const { retryQueries } = useViewerActions();
  const hasRun = useViewer((s) => selectCurrentRun(s) !== null);
  const exact = useViewer(selectExact);
  const queries = useViewer((s) => s.queries);
  let note = '';
  if (hasRun && !exact) note = t('viewer.queryAdjusted');
  else if (hasRun && queries.status === 'loading') note = t('viewer.queryLoading');
  else if (hasRun && queries.status === 'error') {
    const { key, params } = errorMessage(queries.error);
    note = t('viewer.queryFailed', { message: t(key, params) });
  }
  return (
    <div className="query-feedback">
      <p id="query-note" className="note query-note" role="status">
        {note}
      </p>
      <button id="query-retry" type="button" hidden={!(hasRun && exact && queries.status === 'error')} onClick={retryQueries}>
        {t('viewer.queryRetry')}
      </button>
    </div>
  );
}
