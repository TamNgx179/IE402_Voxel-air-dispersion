import { afterEach, describe, expect, test, vi } from 'vitest';
import { AppError } from '../../api/client';
import type { Report } from '../../export/report';
import type { MapInstance } from '../../map/hooks';
import { captureReport } from './capture';
import { composeReport, footerLines, normalizeReport, reportCsv, reportFilename } from './exportReport';

const t = (key: string, params: Record<string, string | number> = {}) =>
  `${key}${Object.keys(params).length ? ' ' + JSON.stringify(params) : ''}`;

function report(extra: Partial<Report> = {}, metadata: Record<string, unknown> = {}): Report {
  return {
    title: 'Dry season · Voxel · real',
    summary: {
      layers: [{ k: 0, z_m: 1, air_cells: 3, mean_ug_m3: 30, max_ug_m3: 90 }],
      grid: { dz_m: 2 },
      units: 'ug m-3',
      emission_multiplier: 0.8,
    } as unknown as Report['summary'],
    mode: 'Original result',
    metadata: {
      layers: { buildings: true },
      run_id: 'run-a',
      model_version: 'v1',
      input_hash: 'h',
      z_center_m: 7,
      exported_at: '2026-01-01T00:00:00.000Z',
      camera: { zoom: 16 },
      ...metadata,
    },
    attribution: 'OSM',
    notice: 'Notice.',
    legend: { title: 'Legend', stops: [[0, '#000'], [1, '#fff']], labels: ['1', '10'] },
    ...extra,
  };
}

const comparison = {
  baseline_run_id: 'run-a',
  comparison_run_id: 'run-b',
  baseline_version: 'v1',
  comparison_version: 'v2',
  baseline_input_hash: 'h',
  comparison_input_hash: 'h2',
  requested_z_m: 7,
  z_center_m: 7,
  units: 'ug m-3',
  feature_collection: { features: [{ properties: { i: 0, j: 1, baseline_ug_m3: 5, comparison_ug_m3: 4, delta_ug_m3: -1 } }] },
};

afterEach(() => vi.restoreAllMocks());

describe('export file layout', () => {
  test('legacy file names', () => {
    expect(reportFilename(report(), 'csv')).toBe('pm25-run-a-layers.csv');
    expect(reportFilename(report(), 'png')).toBe('pm25-run-a-7m.png');
    expect(reportFilename(report(), 'json')).toBe('pm25-run-a-7m.json');
    const compared = report({ comparison, comparison_view: 'delta' });
    expect(reportFilename(compared, 'csv')).toBe('pm25-run-a-vs-run-b-7m-delta.csv');
    expect(reportFilename(compared, 'png')).toBe('pm25-run-a-vs-run-b-7m-delta.png');
  });

  test('CSV: per-layer rows with raw numbers, comparison CSV while comparing', () => {
    expect(reportCsv(report()).split('\r\n')[1]).toBe('"run-a","v1","h","0.8","0","2","1","30","90","3","ug m-3"');
    const rows = reportCsv(report({ comparison })).split('\r\n');
    expect(rows[0].startsWith('"baseline_run_id","comparison_run_id"')).toBe(true);
    expect(rows[1]).toBe('"run-a","run-b","v1","v2","h","h2","1","1","7","7","0","1","5","4","-1","ug m-3"');
  });

  test('JSON: legacy key order, null defaults, comparison_view removed', () => {
    const out = normalizeReport(report({ comparison_view: 'delta' }, { region: { a: 1 }, extra_key: 2 }));
    expect(Object.keys(out)).toEqual(['title', 'summary', 'comparison', 'mode', 'metadata', 'attribution', 'notice', 'legend']);
    expect(out.comparison).toBeNull();
    expect(Object.keys(out.metadata)).toEqual([
      'run_id',
      'model_version',
      'input_hash',
      'z_center_m',
      'exported_at',
      'camera',
      'region',
      'transect',
      'road_corridor',
      'layers',
      'extra_key',
    ]);
    expect(out.metadata.transect).toBeNull();
    expect(out.metadata.region).toEqual({ a: 1 });
  });
});

describe('PNG report', () => {
  test('footer lists run, model, notice, source and camera; comparison adds its lines', () => {
    expect(footerLines(report(), t)).toEqual([
      'mapOptions.png.run {"run":"run-a"}',
      'mapOptions.png.model {"model":"v1","input":"h"}',
      'Notice.',
      'mapOptions.png.source {"attribution":"OSM"}',
      'mapOptions.png.exported {"time":"2026-01-01T00:00:00.000Z","camera":"{\\"zoom\\":16}"}',
    ]);
    const lines = footerLines(report({ comparison }, { comparison_run_id: 'run-b' }), t);
    expect(lines[0]).toBe('mapOptions.png.run {"run":"run-a"}mapOptions.png.comparisonRun {"run":"run-b"}');
    expect(lines[2]).toBe('mapOptions.png.comparisonModel {"model":"v2","input":"h2"}');
  });

  function stubContext() {
    const calls: string[] = [];
    const ctx = {
      font: '',
      fillStyle: '',
      textAlign: 'left',
      measureText: (s: string) => ({ width: s.length * 7 }),
      fillRect: () => {},
      fillText: (text: string) => calls.push(text),
      drawImage: () => calls.push('<image>'),
      createLinearGradient: () => ({ addColorStop: () => {} }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    return calls;
  }

  function canvas(width: number, height: number) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }

  test('compose draws title, level, map, legend labels and footer', () => {
    const calls = stubContext();
    const out = composeReport(document, canvas(800, 400), canvas(800, 400), report({}, { z_min_m: 6, z_max_m: 8 }), t);
    expect(out.width).toBe(1000);
    expect(calls).toContain('mapOptions.png.title {"title":"Dry season · Voxel · real"}');
    expect(calls).toContain('mapOptions.png.layer {"min":"6","max":"8","centre":"7","mode":"Original result"}');
    expect(calls.filter((c) => c === '<image>')).toHaveLength(2);
    expect(calls).toEqual(expect.arrayContaining(['Legend', '1', '10', 'Notice.']));
  });

  function fakeInstance(options: { loaded?: boolean; moving?: boolean } = {}) {
    const listeners: Record<string, () => void> = {};
    let onAfterRender: (() => void) | undefined;
    const mapCanvas = canvas(800, 400);
    const instance = {
      map: {
        loaded: () => options.loaded ?? true,
        isMoving: () => options.moving ?? false,
        once: (type: string, fn: () => void) => (listeners[type] = fn),
        off: vi.fn(),
        triggerRepaint: () => listeners.render?.(),
        getCanvas: () => mapCanvas,
      },
      overlay: {
        setProps: vi.fn((props: { onAfterRender?: () => void }) => (onAfterRender = props.onAfterRender)),
        getCanvas: () => canvas(800, 400),
      },
      redraw: () => onAfterRender?.(),
      resetView: () => {},
      renderLod: () => ({ level: 'near', vertices: 0 }),
    };
    return instance as unknown as MapInstance & { overlay: { setProps: ReturnType<typeof vi.fn> } };
  }

  test('capture composes after the overlay rendered and restores onAfterRender', async () => {
    stubContext();
    const instance = fakeInstance();
    const r = report();
    const out = await captureReport(instance, r, () => r, t);
    expect(out.width).toBe(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calls = instance.overlay.setProps.mock.calls.map((c) => c[0] as { onAfterRender: () => void });
    expect(calls).toHaveLength(2);
    expect(calls.every((props) => Object.keys(props).join() === 'onAfterRender')).toBe(true);
    expect(calls[1].onAfterRender).not.toBe(calls[0].onAfterRender);
  });

  test('capture rejects while the map moves and when the selection changed', async () => {
    stubContext();
    await expect(captureReport(fakeInstance({ moving: true }), report(), report, t)).rejects.toMatchObject({
      messageKey: 'mapOptions.error.mapBusy',
    });
    const changed = captureReport(fakeInstance(), report(), () => report({}, { z_center_m: 9 }), t);
    await expect(changed).rejects.toBeInstanceOf(AppError);
    await expect(changed).rejects.toMatchObject({ messageKey: 'mapOptions.error.changed' });
  });
});
