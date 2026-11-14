/**
 * UI flows of the analysis panel (port of the DOM tests in web/tests/viewer-analysis.test.cjs):
 * region drawing / query / CSV, stale results, illustration refusal, comparison
 * error recovery and export, mode switching and language switching.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../App';
import { ApiError } from '../../api/client';
import { useReportSnapshot } from '../../export/ExportProvider';
import type { Report } from '../../export/report';
import { createViewerStore } from '../../store/store';
import { routedApi } from '../../test/fixtures';
import { createFakeMapFactory } from '../../test/fakeMap';
import { PANELS } from '../index';
import type { PanelDefinition } from '../types';

type Handler = (path: string, options?: { method?: string; body?: unknown; responseType?: string }) => Promise<unknown>;

const regionData = {
  z_min_m: 0,
  z_max_m: 6,
  area_m2: 100,
  air_volume_m3: 1000,
  mean_ug_m3: 0.12494,
  max_ug_m3: 0.49481,
  threshold_ug_m3: 15,
  exceedance_volume_m3: 0,
  layers: [
    { z_center_m: 1, mean_ug_m3: 0.12, max_ug_m3: 0.49 },
    { z_center_m: 3, mean_ug_m3: 0.1, max_ug_m3: 0.4 },
  ],
};

const comparisonData = {
  baseline_run_id: 'real-run',
  comparison_run_id: 'mock-run',
  z_center_m: 1,
  units: 'µg/m³',
  feature_collection: {
    features: [
      {
        geometry: { type: 'Polygon', coordinates: [[[106.7, 10.77], [106.701, 10.77], [106.701, 10.771], [106.7, 10.77]]] },
        properties: { i: 0, j: 0, baseline_ug_m3: 1, comparison_ug_m3: 2, delta_ug_m3: 1 },
      },
    ],
  },
  stats: {
    air_cells: 3,
    baseline: { mean_ug_m3: 1 },
    comparison: { mean_ug_m3: 2 },
    delta: { mean_ug_m3: 1, min_ug_m3: 0, max_ug_m3: 2 },
  },
};

let snapshot: (() => Report) | null = null;
function Probe() {
  snapshot = useReportSnapshot();
  return null;
}

async function frame() {
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

function layerIds(overlay: { setProps: { mock: { calls: unknown[][] } } }) {
  const last = overlay.setProps.mock.calls.at(-1)?.[0] as { layers?: Array<{ id: string }> } | undefined;
  return (last?.layers ?? []).map((layer) => layer.id);
}

async function setup(handler: Handler) {
  const calls: Array<[string, unknown]> = [];
  // Analysis endpoints go to the test handler; bootstrap and runs to fakeApi().
  const api = routedApi(/^\/runs\/[^/]+\/(region|comparison)/, async (path, options) => {
    calls.push([path, typeof options?.body === 'string' ? JSON.parse(options.body) : undefined]);
    return handler(path, options);
  });
  const panels: PanelDefinition[] = [...PANELS, { id: 'probe', icon: 'x', labelKey: 'common.close', Component: Probe }];
  const store = createViewerStore();
  const fake = createFakeMapFactory();
  render(<App store={store} api={api} mapFactory={fake.factory} panels={panels} />);
  await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
  await frame();
  const map = fake.maps[0];
  act(() => store.dispatch({ type: 'panel/open', id: 'analysis' }));
  const click = (lng: number, lat: number) =>
    act(() => map.fire('click', { lngLat: { lng, lat }, point: { x: 1, y: 1 }, originalEvent: undefined }));
  const panel = () => within(document.getElementById('spatial-analysis') as HTMLElement);
  return { store, fake, map, calls, click, panel, zoom: () => map.doubleClickZoom.isEnabled() };
}

const el = (id: string) => document.getElementById(id) as HTMLElement;
/** The core concentration legend (hidden while a comparison view replaces the layer). */
const legendShown = () => ['legend-title', 'legend', 'legend-labels'].map((id) => !el(id).hidden);
const typeInto = (id: string, value: string) => fireEvent.change(el(id), { target: { value } });

async function chooseRegion(ui: Awaited<ReturnType<typeof setup>>) {
  act(() => ui.panel().getByRole('button', { name: /^(Draw region|Redraw region)$/ }).click());
  ui.click(106.7, 10.77);
  ui.click(106.705, 10.77);
  ui.click(106.7, 10.775);
  act(() => ui.panel().getByRole('button', { name: 'Finish' }).click());
}

afterEach(() => {
  snapshot = null;
  vi.restoreAllMocks();
});

describe('analysis panel: region', () => {
  test('mode switch has four modes with Region pressed by default', async () => {
    const ui = await setup(async () => regionData);
    const group = ui.panel().getByRole('group', { name: 'Analysis type' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.id)).toEqual([
      'analysis-region-mode',
      'analysis-transect-mode',
      'analysis-compare-mode',
      'analysis-corridor-mode',
    ]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons.slice(1).every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  test('drawing needs three points, disables gestures, finishes, cancels with Escape and clears', async () => {
    const ui = await setup(async () => regionData);
    expect(el('region-settings')).not.toBeVisible();
    expect(el('region-clear')).not.toBeVisible();
    expect(el('region-finish')).not.toBeVisible();
    act(() => ui.panel().getByRole('button', { name: 'Draw region' }).click());
    await frame();
    expect(ui.zoom()).toBe(false);
    expect(ui.map.dragPan.enabled).toBe(false);
    expect(screen.getByRole('button', { name: /Pick cell/ })).toBeDisabled();
    expect(el('region-draw')).not.toBeVisible();
    expect(el('region-finish')).toBeDisabled();
    ui.click(106.7, 10.77);
    ui.click(106.705, 10.77);
    expect(el('region-note')).toHaveTextContent('2/3 points selected.');
    ui.click(106.7, 10.775);
    expect(el('region-note')).toHaveTextContent('3 points · you can finish.');
    expect(el('region-finish')).not.toBeDisabled();
    await frame();
    expect(layerIds(ui.fake.overlays[0])).toContain('analysis-region-outline');
    act(() => ui.panel().getByRole('button', { name: 'Finish' }).click());
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.map.dragPan.enabled).toBe(true);
    expect(el('region-note')).toHaveTextContent('Region selected · 3 vertices.');
    expect(el('region-settings')).toBeVisible();
    expect(layerIds(ui.fake.overlays[0])).toContain('analysis-region-outline');

    act(() => ui.panel().getByRole('button', { name: 'Redraw region' }).click());
    expect(el('region-settings')).not.toBeVisible();
    expect(el('region-clear')).not.toBeVisible();
    expect(ui.zoom()).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(el('region-note')).toHaveTextContent('The previously selected region is kept.');
    expect(el('region-settings')).toBeVisible();
    expect(document.activeElement).toBe(el('region-draw'));

    act(() => ui.panel().getByRole('button', { name: 'Clear region' }).click());
    await frame();
    expect(el('region-settings')).not.toBeVisible();
    expect(el('region-draw')).toHaveTextContent('Draw region');
    expect(layerIds(ui.fake.overlays[0])).not.toContain('analysis-region-outline');
    expect(ui.calls).toEqual([]);
  });

  test('query shows metrics and table, sends one request, then CSV downloads; input change drops the result', async () => {
    let resolve: (value: unknown) => void = () => {};
    const ui = await setup((path) =>
      path.endsWith('/csv') ? Promise.resolve('run_id\r\nreal-run\r\n') : new Promise((r) => (resolve = r)),
    );
    await chooseRegion(ui);
    typeInto('region-max', '6');
    const query = ui.panel().getByRole('button', { name: 'Analyse region' });
    act(() => query.click());
    act(() => query.click());
    expect(ui.calls).toHaveLength(1);
    expect(ui.calls[0][0]).toBe('/runs/real-run/region');
    expect(ui.calls[0][1]).toMatchObject({ z_min_m: 0, z_max_m: 6, threshold_ug_m3: 15, polygon: { type: 'Polygon' } });
    expect(el('region-query')).toBeDisabled();
    expect(el('region-feedback')).toHaveAttribute('aria-busy', 'true');
    expect(el('region-export')).not.toBeVisible();
    await act(async () => resolve(regionData));
    const box = el('region-result-content');
    for (const text of ['Dry season · Voxel · real', 'Mean concentration', '0.12494', 'µg/m³', 'Maximum concentration', 'Volume above threshold', 'No air inside the selected region exceeds', 'Concentration by height', 'Layer centre (m)'])
      expect(box).toHaveTextContent(text);
    expect(el('region-result')).toBeVisible();
    expect(el('region-feedback')).toHaveAttribute('aria-busy', 'false');
    expect(el('region-query')).toHaveTextContent('Analyse again');

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => ui.panel().getByRole('button', { name: 'Download CSV' }).click());
    expect(ui.calls[1][0]).toBe('/runs/real-run/region/csv');
    expect(click).toHaveBeenCalledTimes(1);
    expect(el('region-feedback')).toHaveTextContent('CSV table downloaded.');

    let report = snapshot!();
    expect(report.metadata.region).toMatchObject({ run: 'real-run', request: { z_max_m: 6 } });
    typeInto('region-max', '5');
    expect(el('region-result')).not.toBeVisible();
    expect(el('region-note')).toHaveTextContent('Click Analyse region to update.');
    report = snapshot!();
    expect(report.metadata.region).toBeNull();
  });

  test('a late result for the previous run is dropped after a run switch', async () => {
    let resolve: (value: unknown) => void = () => {};
    const ui = await setup(() => new Promise((r) => (resolve = r)));
    await chooseRegion(ui);
    typeInto('region-max', '6');
    act(() => ui.panel().getByRole('button', { name: 'Analyse region' }).click());
    act(() => ui.store.dispatch({ type: 'run/select', id: 'mock-run' }));
    await act(async () => resolve({ ...regionData, mean_ug_m3: 999 }));
    expect(el('region-result')).not.toBeVisible();
    expect(el('region-export')).not.toBeVisible();
    expect(el('region-note')).toHaveTextContent('The region is kept; analyse again to see the new result.');
    expect(el('region-settings')).toBeVisible();
  });

  test('an illustration refuses exact analysis without any request', async () => {
    const ui = await setup(async () => regionData);
    await chooseRegion(ui);
    act(() => ui.store.dispatch({ type: 'display/set', display: { multiplier: 10 } }));
    expect(el('region-query')).toBeDisabled();
    expect(el('region-feedback')).toHaveTextContent('An illustration is applied.');
    act(() => ui.store.dispatch({ type: 'display/reset' }));
    expect(el('region-query')).not.toBeDisabled();
    expect(ui.calls).toEqual([]);
  });

  test('validation and API failures keep the region and a retryable action, with keyed messages only', async () => {
    let fail: unknown = new ApiError('network');
    const ui = await setup(async () => {
      throw fail;
    });
    await chooseRegion(ui);
    act(() => ui.panel().getByRole('button', { name: 'Analyse region' }).click());
    expect(el('region-feedback')).toHaveTextContent('Enter a height range: 0 ≤ from < to ≤ 6 m.');
    expect(ui.calls).toHaveLength(0);
    typeInto('region-max', '6');
    await act(async () => ui.panel().getByRole('button', { name: 'Analyse region' }).click());
    expect(el('region-feedback')).toHaveTextContent('Lost connection to the application.');
    expect(el('region-query')).not.toBeDisabled();
    expect(el('region-result')).not.toBeVisible();

    const invalid = new ApiError('validation', 400);
    invalid.detail = 'Polygon must be valid with positive area (no self intersections)';
    fail = invalid;
    await act(async () => ui.panel().getByRole('button', { name: 'Analyse region' }).click());
    expect(el('region-feedback')).toHaveTextContent('Draw it again');
    expect(el('region-feedback').textContent).not.toMatch(/Polygon|positive area|self intersections/);
    expect(el('region-draw')).not.toBeDisabled();
  });

  test('CSV failure keeps the metrics and the export button usable', async () => {
    const ui = await setup(async (path) => {
      if (path.endsWith('/csv')) throw new ApiError('network');
      return regionData;
    });
    await chooseRegion(ui);
    typeInto('region-max', '6');
    await act(async () => ui.panel().getByRole('button', { name: 'Analyse region' }).click());
    const before = el('region-result-content').textContent;
    await act(async () => ui.panel().getByRole('button', { name: 'Download CSV' }).click());
    expect(el('region-result-content').textContent).toBe(before);
    expect(el('region-feedback')).toHaveTextContent(
      'Could not download the data table. Lost connection to the application. Check your connection and try again.',
    );
    expect(el('region-export')).not.toBeDisabled();
  });

  test('switching language keeps the drawn region and the result', async () => {
    const ui = await setup(async () => ({ ...regionData, exceedance_volume_m3: 250 }));
    await chooseRegion(ui);
    typeInto('region-max', '6');
    await act(async () => ui.panel().getByRole('button', { name: 'Analyse region' }).click());
    expect(el('region-result-content')).toHaveTextContent('25% of the air volume exceeds 15 µg/m³ (250 m³).');
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(el('region-result')).toBeVisible();
    expect(el('region-result-content')).toHaveTextContent('25% thể tích khí vượt 15 µg/m³ (250 m³).');
    expect(el('region-result-content')).toHaveTextContent('0,12494');
    expect(el('region-note')).toHaveTextContent('Bấm Phân tích vùng để cập nhật.');
    expect(el('region-draw')).toHaveTextContent('Vẽ lại vùng');
    expect((el('region-max') as HTMLInputElement).value).toBe('6');
    expect(ui.calls).toHaveLength(1);
  });
});

describe('analysis panel: compare and mode switching', () => {
  test('comparison error clears busy state, retry recovers and the export carries the comparison', async () => {
    let fail = true;
    const ui = await setup(async (path) => {
      expect(path).toBe('/runs/real-run/comparison?compare_run_id=mock-run&z_m=1');
      if (fail) throw new ApiError('server', 500);
      return comparisonData;
    });
    act(() => ui.panel().getByRole('button', { name: 'Compare results' }).click());
    expect(el('comparison-note')).toHaveTextContent('Choose a map view to turn on the comparison.');
    fireEvent.change(screen.getByLabelText('Comparison result'), { target: { value: 'mock-run' } });
    expect((screen.getByLabelText('Show on the map') as HTMLSelectElement).value).toBe('delta');
    expect(legendShown()).toEqual([false, false, false]);
    expect(el('comparison-note')).toHaveAttribute('aria-busy', 'true');
    expect(() => snapshot!()).toThrow('compare.waitForComparison');
    await waitFor(() => expect(el('comparison-note')).toHaveTextContent('The system could not process the request.'));
    expect(el('comparison-note')).toHaveAttribute('aria-busy', 'false');
    const retry = ui.panel().getByRole('button', { name: 'Update comparison' });
    expect(retry).toBeVisible();
    expect(retry).not.toBeDisabled();

    fail = false;
    await act(async () => retry.click());
    expect(el('comparison-note')).toHaveTextContent('3 air cells · 1 m');
    expect(el('comparison-retry')).not.toBeVisible();
    const result = el('comparison-result');
    expect(result).toHaveTextContent('The comparison result is 1 µg/m³ higher than the baseline at this layer.');
    expect(result).toHaveTextContent('Mean difference');
    expect(result).toHaveTextContent('ΔC: -2 → 0 → 2 µg/m³');
    await frame();
    const ids = layerIds(ui.fake.overlays[0]);
    expect(ids).toContain('analysis-comparison');
    expect(ids).not.toContain('concentration');

    const report = snapshot!();
    expect(report.comparison).toMatchObject({ comparison_run_id: 'mock-run', z_center_m: 1 });
    expect(report.comparison_view).toBe('delta');
    expect(report.metadata.comparison_run_id).toBe('mock-run');
    expect(report.mode).toBe('Difference: comparison − baseline');
    expect(report.legend.title).toBe('ΔC (µg/m³, symmetric linear scale)');
    expect(report.notice).toMatch(/ Wind and buildings belong to the baseline run\.$/);
    expect(report.notice.startsWith('Model illustration; does not replace the original CSV data or monitoring. Wind ')).toBe(true);
    // Threshold colouring is not shown while comparing: no threshold notice/legend.
    act(() => ui.store.dispatch({ type: 'threshold/toggle', key: 'who_24h', enabled: true }));
    const withThreshold = snapshot!();
    expect(withThreshold.notice).toBe(report.notice);
    expect(withThreshold.legend).toEqual(report.legend);

    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(el('comparison-result')).toHaveTextContent('Kết quả so sánh cao hơn gốc 1 µg/m³ ở tầng này.');
    expect(snapshot!().notice).toMatch(/ Gió và khối nhà thuộc run gốc\.$/);
  });

  test('self comparison shows a zero scale without negative zero', async () => {
    const ui = await setup(async () => ({
      ...comparisonData,
      comparison_run_id: 'real-run',
      stats: { ...comparisonData.stats, comparison: { mean_ug_m3: 1 }, delta: { mean_ug_m3: 0, min_ug_m3: 0, max_ug_m3: 0 } },
    }));
    act(() => ui.panel().getByRole('button', { name: 'Compare results' }).click());
    fireEvent.change(screen.getByLabelText('Comparison result'), { target: { value: 'real-run' } });
    await waitFor(() => expect(el('comparison-result')).toHaveTextContent('ΔC: 0 → 0 → 0'));
    expect(el('comparison-result').textContent).not.toMatch(/-0/);
    expect(el('comparison-result')).toHaveTextContent('Both results have the same mean concentration at this layer.');
  });

  test('switching mode exits drawing, restores map gestures and turns the comparison view off', async () => {
    const ui = await setup(async () => comparisonData);
    act(() => ui.panel().getByRole('button', { name: 'Draw region' }).click());
    await frame();
    expect(ui.zoom()).toBe(false);
    act(() => ui.panel().getByRole('button', { name: 'Compare results' }).click());
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.map.dragPan.enabled).toBe(true);
    expect(screen.getByRole('button', { name: /Pick cell/ })).not.toBeDisabled();
    expect(el('analysis-mode-region')).not.toBeVisible();
    expect(el('analysis-mode-compare')).toBeVisible();
    expect(el('analysis-compare-mode')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByLabelText('Show on the map'), { target: { value: 'delta' } });
    expect(legendShown()).toEqual([false, false, false]);
    act(() => ui.panel().getByRole('button', { name: 'Region' }).click());
    expect(el('analysis-mode-compare')).not.toBeVisible();
    expect((screen.getByLabelText('Show on the map') as HTMLSelectElement).value).toBe('off');
    expect(legendShown()).toEqual([true, true, true]);

    // Closing the tool panel also cancels drawing.
    act(() => ui.panel().getByRole('button', { name: 'Draw region' }).click());
    expect(ui.zoom()).toBe(false);
    act(() => ui.store.dispatch({ type: 'panel/open', id: null }));
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.map.dragPan.enabled).toBe(true);
  });
});
