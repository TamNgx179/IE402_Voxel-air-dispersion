/**
 * PNG capture (port of captureReport in web/app.js). Each canvas is copied right
 * after it rendered: the basemap on MapLibre's `render` event, the deck overlay in
 * the next deck frame (`MapInstance.captureFrame`). If the snapshot changed meanwhile
 * (camera, run, layer, toggles) the capture is rejected instead of mixing states.
 */
import { AppError } from '../../api/client';
import { reportKey, type Report } from '../../export/report';
import type { MapInstance } from '../../map/hooks';
import { composeReport, copyCanvas } from './exportReport';

type Translate = Parameters<typeof composeReport>[4];

export function captureReport(
  instance: MapInstance,
  report: Report,
  snapshot: () => Report,
  t: Translate,
  doc: Document = document,
  timeoutMs = 8000,
): Promise<HTMLCanvasElement> {
  const { map } = instance;
  if (!map.loaded() || map.isMoving()) return Promise.reject(new AppError('mapOptions.error.mapBusy'));
  const key = reportKey(report);
  return new Promise((resolve, reject) => {
    let done = false;
    let cancelFrame = () => {};
    const finish = (error: unknown, result?: HTMLCanvasElement) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('render', captureBase);
      cancelFrame();
      if (error || !result) reject(error ?? new AppError('mapOptions.error.captureTimeout'));
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new AppError('mapOptions.error.captureTimeout')), timeoutMs);
    function captureBase() {
      try {
        const base = copyCanvas(doc, map.getCanvas());
        cancelFrame = instance.captureFrame((deckCanvas) => {
          try {
            if (reportKey(snapshot()) !== key) throw new AppError('mapOptions.error.changed');
            finish(null, composeReport(doc, base, deckCanvas ? copyCanvas(doc, deckCanvas) : null, report, t));
          } catch (error) {
            finish(error);
          }
        });
      } catch (error) {
        finish(error);
      }
    }
    map.once('render', captureBase);
    map.triggerRepaint();
  });
}
