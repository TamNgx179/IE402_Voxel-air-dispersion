/**
 * PNG capture (port of captureReport in web/app.js). Each canvas is copied right
 * after it rendered: the basemap on MapLibre's `render` event, the deck overlay in
 * deck's `onAfterRender` of the next frame. If the snapshot changed meanwhile
 * (camera, run, layer, toggles) the capture is rejected instead of mixing states.
 */
import { AppError } from '../../api/client';
import { reportKey, type Report } from '../../export/report';
import type { MapInstance } from '../../map/hooks';
import { composeReport, copyCanvas } from './exportReport';

type Translate = Parameters<typeof composeReport>[4];

const NOOP = () => {};

export function captureReport(
  instance: MapInstance,
  report: Report,
  snapshot: () => Report,
  t: Translate,
  doc: Document = document,
  timeoutMs = 8000,
): Promise<HTMLCanvasElement> {
  const { map, overlay } = instance;
  if (!map.loaded() || map.isMoving()) return Promise.reject(new AppError('mapOptions.error.mapBusy'));
  const key = reportKey(report);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error: unknown, result?: HTMLCanvasElement) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      map.off('render', captureBase);
      // Restore outside deck's draw call.
      setTimeout(() => overlay.setProps({ onAfterRender: NOOP }), 0);
      if (error || !result) reject(error ?? new AppError('mapOptions.error.captureTimeout'));
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new AppError('mapOptions.error.captureTimeout')), timeoutMs);
    function captureBase() {
      try {
        const base = copyCanvas(doc, map.getCanvas());
        overlay.setProps({
          onAfterRender: () => {
            try {
              if (reportKey(snapshot()) !== key) throw new AppError('mapOptions.error.changed');
              const deckCanvas = overlay.getCanvas();
              finish(null, composeReport(doc, base, deckCanvas ? copyCanvas(doc, deckCanvas) : null, report, t));
            } catch (error) {
              finish(error);
            }
          },
        });
        instance.redraw();
        // Unchanged layers may not schedule a deck frame: force one draw so
        // onAfterRender runs now (MapboxOverlay keeps its Deck in `_deck`).
        (overlay as unknown as { _deck?: { redraw?(reason?: string): void } })._deck?.redraw?.('map-options-export');
      } catch (error) {
        finish(error);
      }
    }
    map.once('render', captureBase);
    map.triggerRepaint();
  });
}
