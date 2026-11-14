/** UI flows of the vertical section (mirrors web/tests/viewer-transect.test.cjs). */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../App';
import { ApiError } from '../../../api/client';
import type { MapFactory } from '../../../map/MapView';
import type { PanelDefinition, PanelProps } from '../../types';
import { createViewerStore } from '../../../store/store';
import { routedApi } from '../../../test/fixtures';
import { createFakeMapFactory } from '../../../test/fakeMap';
import type { TransectResult } from '../../../lib/transect';
import { TransectPanel } from './TransectPanel';
import { useReportSnapshot } from '../../../export/ExportProvider';
import type { Report } from '../../../export/report';

const snapshot: { current: (() => Report) | null } = { current: null };
function Exporter() {
  snapshot.current = useReportSnapshot();
  return null;
}
const exporterPanel: PanelDefinition = { id: 'exporter', icon: 'x', labelKey: 'transect.title', Component: () => null, Persistent: Exporter };

type Handler = (path: string, options?: { body?: unknown; method?: string }) => Promise<unknown>;

const result: TransectResult = {
  run_id: 'real-run',
  length_m: 10,
  z_min_m: 0,
  z_max_m: 3,
  units: 'ug m-3',
  layers: [
    { k: 0, z_center_m: 1, overlap_min_m: 0, overlap_max_m: 2 },
    { k: 1, z_center_m: 3, overlap_min_m: 2, overlap_max_m: 3 },
  ],
  samples: [
    { distance_m: 0, i: 0, j: 1, cells: [{ k: 0, status: 'air', concentration_ug_m3: 0 }, { k: 1, status: 'no_data', concentration_ug_m3: null }] },
    { distance_m: 10, i: 1, j: 1, cells: [{ k: 0, status: 'solid', concentration_ug_m3: null }, { k: 1, status: 'air', concentration_ug_m3: 11 }] },
  ],
};

const transectTestPanel: PanelDefinition = {
  id: 'transect-test',
  icon: 'graph-up',
  labelKey: 'transect.modeLabel',
  Component: ({ active }: PanelProps) => <TransectPanel active={active} />,
};

let paints: string[] = [];
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeEach(() => {
  paints = [];
  const painter = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    setTransform() {},
    clearRect() {},
    fillRect() {
      paints.push(this.fillStyle);
    },
    strokeRect() {},
    fillText() {},
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => painter) as never;
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

function layerIds(overlay: { setProps: { mock: { calls: unknown[][] } } }) {
  const last = overlay.setProps.mock.calls.at(-1)?.[0] as { layers?: Array<{ id: string }> } | undefined;
  return (last?.layers ?? []).map((layer) => layer.id);
}
const frame = () => act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const tick = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function setup(handler: Handler = async () => structuredClone(result)) {
  const calls: Array<[string, unknown]> = [];
  const api = routedApi(/^\/runs\/[^/]+\/transect/, (path, options) => {
    const o = options as { body?: string } | undefined;
    calls.push([path, o?.body ? JSON.parse(o.body) : undefined]);
    return handler(path, options as never);
  });
  const store = createViewerStore();
  const fake = createFakeMapFactory();
  let zoom = true;
  const factory: MapFactory = (options) => {
    const made = fake.factory(options);
    Object.assign(made.map as object, {
      doubleClickZoom: { isEnabled: () => zoom, enable: () => (zoom = true), disable: () => (zoom = false) },
    });
    return made;
  };
  render(<App store={store} api={api} mapFactory={factory} panels={[transectTestPanel, exporterPanel]} />);
  await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
  act(() => store.dispatch({ type: 'panel/open', id: 'transect-test' }));
  await frame();
  const point = (lng: number, lat: number) =>
    act(() => fake.maps[0].fire('click', { lngLat: { lng, lat }, point: { x: 0, y: 0 } }));
  const button = (name: string | RegExp) => screen.getByRole('button', { name });
  const choose = () => {
    act(() => button('Draw line').click());
    point(106.7, 10.77);
    point(106.71, 10.78);
    act(() => button('Finish line').click());
    fireEvent.change(screen.getByLabelText('End height (m)'), { target: { value: '3' } });
  };
  return { store, fake, calls, point, button, choose, zoom: () => zoom, overlay: () => fake.overlays[0] };
}

const reading = () => document.getElementById('transect-reading')!.textContent;
const resultPanel = () => document.getElementById('transect-result');

describe('TransectPanel', () => {
  test('drawing claims the map, enables finish only at two distinct points and Escape restores zoom', async () => {
    const ui = await setup();
    act(() => ui.button('Draw line').click());
    await frame();
    expect(ui.zoom()).toBe(false);
    expect(ui.fake.maps[0].dragPan.enabled).toBe(false);
    expect(ui.button('Finish line')).toBeDisabled();
    ui.point(106.7, 10.77);
    ui.point(106.7, 10.77);
    expect(ui.button('Finish line')).toBeDisabled();
    expect(screen.getByText('1 of 2 points chosen.')).toBeInTheDocument();
    ui.point(106.71, 10.78);
    expect(ui.button('Finish line')).not.toBeDisabled();
    await frame();
    expect(layerIds(ui.overlay())).toContain('transect-line');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.fake.maps[0].dragPan.enabled).toBe(true);
    expect(document.getElementById('transect-settings')).not.toBeVisible();
    expect(ui.button('Draw line')).toHaveFocus();
    await frame();
    expect(layerIds(ui.overlay())).not.toContain('transect-line');
  });

  test('query renders a readable result with distinct zero, solid and missing states', async () => {
    const ui = await setup();
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    expect(ui.calls[0][0]).toBe('/runs/real-run/transect');
    const body = ui.calls[0][1] as { line: { type: string }; z_max_m: number; z_min_m: number };
    expect(body.line.type).toBe('LineString');
    expect(body.z_max_m).toBe(3);
    expect(resultPanel()).toBeVisible();
    expect(document.getElementById('transect-context')!.textContent).toMatch(/Dry season.*10 m.*0–3 m/);
    expect(reading()).toMatch(/0 µg\/m³/);
    expect(paints).toContain('#929fa9');
    expect(paints).toContain('#ffffff');
    expect(paints.some((v) => /^rgb/.test(v))).toBe(true);
    expect(document.getElementById('transect-empty')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Download CSV' })).not.toBeDisabled();
    expect(document.getElementById('transect-chart')).toHaveFocus();
    expect(ui.button('View section again')).toBeInTheDocument();
  });

  test('keyboard and plot clicks read exact cells without treating no-data as zero', async () => {
    const ui = await setup();
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    const chart = document.getElementById('transect-chart')!;
    fireEvent.keyDown(chart, { key: 'ArrowUp' });
    expect(reading()).toMatch(/No data/);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(reading()).toMatch(/11 µg\/m³/);
    fireEvent.keyDown(chart, { key: 'ArrowDown' });
    expect(reading()).toMatch(/Building/);
    fireEvent.click(chart, { clientX: 60, clientY: 200 });
    expect(reading()).toMatch(/0 µg\/m³/);
    expect(document.getElementById('transect-reading')).toHaveAttribute('aria-live', 'polite');
  });

  test('a late response cannot replace a changed run, height, line or illustration state', async () => {
    const changes: Array<(ui: Awaited<ReturnType<typeof setup>>) => void> = [
      (ui) => act(() => ui.store.dispatch({ type: 'run/select', id: 'mock-run' })),
      () => fireEvent.change(screen.getByLabelText('End height (m)'), { target: { value: '5' } }),
      (ui) => act(() => ui.button('Clear line').click()),
      (ui) => act(() => ui.store.dispatch({ type: 'display/set', display: { multiplier: 10 } })),
    ];
    for (const change of changes) {
      let resolve: (value: unknown) => void = () => {};
      const ui = await setup(() => new Promise((r) => (resolve = r)));
      ui.choose();
      act(() => ui.button('View section').click());
      change(ui);
      resolve(structuredClone(result));
      await tick();
      expect(resultPanel()).toBeNull();
      document.body.innerHTML = '';
    }
  });

  test('becoming inactive cancels drawing, hides the floating result and contributes no layers', async () => {
    const ui = await setup();
    act(() => ui.button('Draw line').click());
    ui.point(106.7, 10.77);
    act(() => ui.store.dispatch({ type: 'panel/open', id: null }));
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.fake.maps[0].dragPan.enabled).toBe(true);
    act(() => ui.store.dispatch({ type: 'panel/open', id: 'transect-test' }));
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    await frame();
    expect(layerIds(ui.overlay())).toContain('transect-line');
    act(() => ui.store.dispatch({ type: 'panel/open', id: null }));
    await frame();
    expect(resultPanel()).not.toBeVisible();
    expect(layerIds(ui.overlay())).not.toContain('transect-line');
    // Clicks while inactive never add points.
    ui.point(106.705, 10.775);
    act(() => ui.store.dispatch({ type: 'panel/open', id: 'transect-test' }));
    act(() => ui.button('View section again').click());
    expect(resultPanel()).toBeVisible();
    expect(ui.calls).toHaveLength(1);
  });

  test('an empty result is explained and zero is not mistaken for no air', async () => {
    const empty: TransectResult = {
      ...result,
      samples: result.samples.map((s) => ({ ...s, cells: s.cells.map((c) => ({ ...c, status: 'no_data' as const, concentration_ug_m3: null })) })),
    };
    const ui = await setup(async () => empty);
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    expect(document.getElementById('transect-empty')).toBeVisible();
    expect(document.getElementById('transect-empty')!.textContent).toMatch(/does not mean zero/);
  });

  test('server errors map to keys, retry works, invalid heights and illustration never query', async () => {
    let count = 0;
    const ui = await setup(async () => {
      count++;
      throw Object.assign(new ApiError('validation', 400), { detail: 'Tuyến phải nằm hoàn toàn trong khu vực mô phỏng.' });
    });
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    const feedback = document.getElementById('transect-feedback')!;
    expect(feedback.textContent).toBe('The line must lie entirely inside the simulation area.');
    expect(ui.button('View section')).not.toBeDisabled();
    act(() => ui.button('View section').click());
    await tick();
    expect(count).toBe(2);
    fireEvent.change(screen.getByLabelText('End height (m)'), { target: { value: '-1' } });
    act(() => ui.button('View section').click());
    await tick();
    expect(count).toBe(2);
    expect(feedback.textContent).toBe('Choose a height range: 0 ≤ from < to ≤ 6 m.');
    act(() => ui.store.dispatch({ type: 'display/set', display: { multiplier: 10 } }));
    expect(ui.button('View section')).toBeDisabled();
    expect(feedback.textContent).toMatch(/Illustration is applied/);
  });

  test('CSV reuses the successful request and a stale download never produces a link', async () => {
    let resolve: (value: unknown) => void = () => {};
    const ui = await setup(async (path) => (path.endsWith('/csv') ? new Promise((r) => (resolve = r)) : structuredClone(result)));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    act(() => screen.getByRole('button', { name: 'Download CSV' }).click());
    expect(screen.getByRole('button', { name: 'Downloading…' })).toBeDisabled();
    expect(ui.calls[1][0]).toBe('/runs/real-run/transect/csv');
    expect(ui.calls[1][1]).toEqual(ui.calls[0][1]);
    act(() => ui.store.dispatch({ type: 'run/select', id: 'mock-run' }));
    resolve('run_id,value\nreal-run,0\n');
    await tick();
    expect(click).not.toHaveBeenCalled();
    expect(resultPanel()).toBeNull();
    click.mockRestore();
  });

  test('CSV download names the file after the run', async () => {
    const ui = await setup(async (path) => (path.endsWith('/csv') ? 'a,b\n' : structuredClone(result)));
    let name = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    act(() => screen.getByRole('button', { name: 'Download CSV' }).click());
    await tick();
    expect(name).toBe('transect-real-run.csv');
    expect(document.getElementById('transect-feedback')!.textContent).toBe('Section table downloaded.');
    click.mockRestore();
  });

  test('the internal face selects the upper layer while the top border reads the last layer', async () => {
    const boundary: TransectResult = { ...result, z_max_m: 4, layers: [result.layers[0], { ...result.layers[1], overlap_max_m: 4 }] };
    const ui = await setup(async () => boundary);
    ui.choose();
    fireEvent.change(screen.getByLabelText('End height (m)'), { target: { value: '4' } });
    act(() => ui.button('View section').click());
    await tick();
    const chart = document.getElementById('transect-chart')!;
    // Plot y=[18,212], z=[4,0]: y=115 is exactly the z=2 internal face.
    for (const clientY of [115, 18]) {
      fireEvent.click(chart, { clientX: 60, clientY });
      expect(reading()).toMatch(/No data/);
    }
  });

  test('close hides the result and returns focus; export contributes the transect state', async () => {
    const ui = await setup();
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    act(() => screen.getByRole('button', { name: 'Close section' }).click());
    expect(resultPanel()).not.toBeVisible();
    expect(ui.button('View section again')).toHaveFocus();
    const report = snapshot.current!();
    expect(report.metadata.transect).toEqual({ run: 'real-run', request: ui.calls[0][1] });
    act(() => ui.store.dispatch({ type: 'panel/open', id: null }));
    expect(snapshot.current!().metadata.transect).toBeNull();
  });

  test('switching language keeps the line, the result and the selected cell', async () => {
    const ui = await setup();
    ui.choose();
    act(() => ui.button('View section').click());
    await tick();
    fireEvent.keyDown(document.getElementById('transect-chart')!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.getElementById('transect-chart')!, { key: 'ArrowUp' });
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(reading()).toMatch(/^10 m từ đầu tuyến · tâm tầng 3 m · ô \(1, 1, 1\): 11 µg\/m³$/);
    expect(document.getElementById('transect-context')!.textContent).toMatch(/Mùa khô.*tuyến 10 m · cao độ 0–3 m/);
    expect(screen.getByRole('button', { name: 'Xem lại mặt cắt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải CSV' })).toBeInTheDocument();
    expect(document.getElementById('transect-note')!.textContent).toBe('Tuyến đã chọn · 2 điểm.');
    expect(ui.calls).toHaveLength(1);
  });
});
