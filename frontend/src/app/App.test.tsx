import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { PathLayer } from '@deck.gl/layers';
import { App } from './App';
import { ApiError, api as realApi } from '../api/client';
import { useMapClick, useMapInstance, useMapLayers, type MapInstance } from '../map/hooks';
import { PANELS } from '../features';
import type { PanelDefinition, PanelProps } from '../features/types';
import { useApi, type ApiFn } from './viewerFacade';
import { createViewerStore } from '../store/store';
import { fakeApi } from '../test/fixtures';
import { createFakeMapFactory } from '../test/fakeMap';
import { useExportContribution, useReportSnapshot } from '../export/ExportProvider';

function layerIds(overlay: { setProps: { mock: { calls: unknown[][] } } }) {
  const last = overlay.setProps.mock.calls.at(-1)?.[0] as { layers?: Array<{ id: string }> } | undefined;
  return (last?.layers ?? []).map((layer) => layer.id);
}

async function renderApp(extraPanels: PanelDefinition[] = []) {
  const store = createViewerStore();
  const fake = createFakeMapFactory();
  const utils = render(<App store={store} api={fakeApi()} mapFactory={fake.factory} panels={[...PANELS, ...extraPanels]} />);
  await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
  // Let the queued render frame run.
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  return { store, fake, ...utils };
}

describe('viewer shell', () => {
  test('loads bootstrap data, renders English by default and draws the core layers', async () => {
    const { fake } = await renderApp();
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('heading', { level: 2, name: 'Simulation result' })).toBeInTheDocument();
    const select = screen.getByLabelText('Choose a simulation result') as HTMLSelectElement;
    expect(select.value).toBe('real-run');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Dry season, Test data, mock',
      'Dry season, Voxel, real',
    ]);
    expect(fake.maps).toHaveLength(1);
    expect(layerIds(fake.overlays[0])).toEqual([
      'water',
      'green',
      'concentration',
      'roads',
      'voxel-grid',
      'buildings',
      'wind-trails',
      'wind-streamlets',
    ]);
    expect(screen.getByRole('slider')).not.toBeDisabled();
    expect(screen.getAllByRole('button', { name: /^Go to height/ }).map((b) => b.textContent)).toEqual(['1 m', '3 m', '5 m']);
  });

  test('switching language keeps run, layer, panel and the same map instance', async () => {
    const { store, fake } = await renderApp();
    act(() => {
      store.dispatch({ type: 'layer/set', layer: 2 });
      store.dispatch({ type: 'panel/open', id: 'illustration' });
      store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } });
    });
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(document.documentElement.lang).toBe('vi');
    expect(screen.queryByRole('heading', { level: 2, name: 'Kết quả mô phỏng' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chuyển ngôn ngữ sang tiếng Anh' })).toHaveAttribute('aria-pressed', 'false');
    expect((screen.getByLabelText('Chọn kết quả mô phỏng') as HTMLSelectElement).selectedOptions[0].textContent).toBe(
      'Mùa khô, Voxel, real',
    );
    expect(screen.getByRole('slider', { hidden: true })).toHaveAttribute('aria-valuetext', 'tầng 3: 4–6 m');
    const state = store.getState();
    expect(state.selectedRunId).toBe('real-run');
    expect(state.layer).toBe(2);
    expect(state.activePanel).toBe('illustration');
    expect(state.selectedCell).toEqual({ i: 1, j: 0 });
    expect(fake.maps).toHaveLength(1);
    expect(fake.maps[0].remove).not.toHaveBeenCalled();
    expect(document.getElementById('cell-info')).toHaveTextContent('5 m');
  });

  test('Pan clears the selected map cell and its reading', async () => {
    const { store } = await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Pick cell' }));
    act(() => store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } }));
    expect(document.querySelector('.map-interaction-dock #cell-info')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }));
    expect(store.getState().selectedCell).toBeNull();
    expect(document.getElementById('cell-info')).not.toBeVisible();
  });

  test('tool buttons open one panel at a time and keep closed panels mounted', async () => {
    await renderApp();
    const nav = screen.getByRole('navigation', { name: 'Map tools' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Simulation', 'Layers', 'Statistics', 'Analysis', 'Illustration']);
    fireEvent.click(within(nav).getByRole('button', { name: 'Illustration' }));
    expect(document.getElementById('illustration-options')).not.toHaveAttribute('hidden');
    fireEvent.click(within(nav).getByRole('button', { name: 'Analysis' }));
    expect(document.getElementById('illustration-options')).toHaveAttribute('hidden');
    expect(document.getElementById('spatial-analysis')).not.toHaveAttribute('hidden');
    expect(screen.queryByRole('heading', { name: 'Simulation result' })).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeVisible();
    fireEvent.click(within(nav).getByRole('button', { name: 'Simulation' }));
    expect(screen.getByRole('slider')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run' })).toBeVisible();
    expect(document.getElementById('spatial-analysis')).toHaveAttribute('hidden');
  });

  test('illustration adjustments change legend and statistics source, and reset restores original data', async () => {
    const { store } = await renderApp();
    act(() => store.dispatch({ type: 'panel/open', id: 'illustration' }));
    const select = screen.getByLabelText('Source factor') as HTMLSelectElement;
    act(() => {
      select.value = '10';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(store.getState().display.multiplier).toBe(10);
    fireEvent.click(screen.getByRole('button', { name: 'Simulation' }));
    expect(screen.getByText(/× 10 \+ background 0/)).toBeInTheDocument();
    expect(screen.getByText('Estimate from the advanced adjustments')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Illustration' }));
    act(() => screen.getByRole('button', { name: 'Back to original data' }).click());
    expect(store.getState().display).toEqual({ multiplier: 1, background: 0 });
  });

  test('background applies on change (spinner/typing) like legacy; blur normalises invalid text', async () => {
    const { store } = await renderApp();
    act(() => store.dispatch({ type: 'panel/open', id: 'illustration' }));
    const input = screen.getByLabelText(/Background/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(store.getState().display.background).toBe(5);
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '7.5' } });
    expect(store.getState().display.background).toBe(7.5);
    // Empty or negative text is not applied while typing…
    fireEvent.change(input, { target: { value: '' } });
    expect(store.getState().display.background).toBe(7.5);
    fireEvent.change(input, { target: { value: '-3' } });
    expect(store.getState().display.background).toBe(7.5);
    // …and is normalised to 0 on blur.
    fireEvent.blur(input);
    expect(store.getState().display.background).toBe(0);
    expect(input.value).toBe('0');
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Illustration' }));
    act(() => screen.getByRole('button', { name: 'Back to original data' }).click());
    expect(input.value).toBe('0');
  });

  test('a drawing claim disables the pan/cell switch and drag-pan; contributed layers render in their slot', async () => {
    function DrawingPanel({ active }: PanelProps) {
      const layers = useMemo(() => [new PathLayer({ id: 'test-draft', data: [] })], []);
      useMapLayers('test', active ? layers : null);
      useMapClick(() => {}, { enabled: active, drawing: true });
      useExportContribution('test_state', () => ({ drawn: active }));
      return null;
    }
    const panel: PanelDefinition = { id: 'test', icon: 'pencil', labelKey: 'common.close', Component: DrawingPanel };
    const { store, fake } = await renderApp([panel]);
    expect(screen.getByRole('button', { name: /Pick cell/ })).not.toBeDisabled();
    act(() => store.dispatch({ type: 'panel/open', id: 'test' }));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(screen.getByRole('button', { name: /Pick cell/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Pan/ })).toBeDisabled();
    expect(fake.maps[0].dragPan.enabled).toBe(false);
    expect(layerIds(fake.overlays[0]).indexOf('test-draft')).toBe(layerIds(fake.overlays[0]).indexOf('concentration') + 1);
    act(() => store.dispatch({ type: 'panel/open', id: null }));
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(screen.getByRole('button', { name: /Pick cell/ })).not.toBeDisabled();
    expect(fake.maps[0].dragPan.enabled).toBe(true);
    expect(layerIds(fake.overlays[0])).not.toContain('test-draft');
  });

  test('export snapshot keeps stable field names and includes contributions', async () => {
    let snapshot: (() => unknown) | null = null;
    function Probe() {
      snapshot = useReportSnapshot();
      useExportContribution('road_corridor', () => ({ bands: [10, 25] }));
      return null;
    }
    const panel: PanelDefinition = { id: 'probe', icon: 'x', labelKey: 'common.close', Component: Probe };
    await renderApp([panel]);
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    const report = (snapshot as unknown as () => { metadata: Record<string, unknown>; mode: string })();
    expect(report.mode).toBe('Kết quả gốc');
    expect(report.metadata.run_id).toBe('real-run');
    expect(report.metadata.units).toBe('µg/m³');
    expect(report.metadata.z_center_m).toBe(1);
    expect(report.metadata.road_corridor).toEqual({ bands: [10, 25] });
    expect(Object.keys(report.metadata.layers as object)).toEqual(['buildings', 'facades', 'roads', 'wind', 'wind_paused', 'grid']);
  });

  test('panels reach the App api through useApi(); without a provider it is the real client', async () => {
    let seen: ApiFn | null = null;
    const probe: PanelDefinition = { id: 'api-probe', icon: 'x', labelKey: 'common.close', Component: () => ((seen = useApi()), null) };
    const api = fakeApi();
    const store = createViewerStore();
    render(<App store={store} api={api} mapFactory={createFakeMapFactory().factory} panels={[probe]} />);
    await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
    expect(seen).toBe(api);
    function Outside() {
      seen = useApi();
      return null;
    }
    render(<Outside />);
    expect(seen).toBe(realApi);
  });

  test('captureFrame forces one deck frame and calls back once with the deck canvas', async () => {
    let instance: MapInstance | null = null;
    const probe: PanelDefinition = { id: 'map-probe', icon: 'x', labelKey: 'common.close', Component: () => ((instance = useMapInstance()), null) };
    const { fake } = await renderApp([probe]);
    const onFrame = vi.fn();
    const cancel = instance!.captureFrame(onFrame);
    expect(fake.overlays[0]._deck.redraw).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0][0]).toBeInstanceOf(HTMLCanvasElement);
    // Later frames do not call it again; a cancelled callback never runs.
    fake.overlays[0]._deck.redraw();
    expect(onFrame).toHaveBeenCalledTimes(1);
    cancel();
    const cancelled = vi.fn();
    fake.overlays[0]._deck.redraw.mockImplementationOnce(() => {});
    instance!.captureFrame(cancelled)();
    fake.overlays[0]._deck.redraw();
    expect(cancelled).not.toHaveBeenCalled();
  });

  test('unmount removes the map and finalizes the overlay', async () => {
    const { fake, unmount } = await renderApp();
    unmount();
    expect(fake.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(fake.overlays[0].finalize).toHaveBeenCalledTimes(1);
  });

  test('bootstrap failure replaces the viewer and retry restores it', async () => {
    const store = createViewerStore();
    const fake = createFakeMapFactory();
    const healthyApi = fakeApi();
    let failed = true;
    const api: ApiFn = (path, options) => path === '/study-areas' && failed
      ? Promise.reject(new ApiError('network')) : healthyApi(path, options);
    render(<App store={store} api={api} mapFactory={fake.factory} />);
    await screen.findByRole('heading', { name: 'Can’t reach the map' });
    expect(fake.maps).toHaveLength(0);
    expect(screen.queryByLabelText('Choose a simulation result')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Map view controls' })).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText('Choose a simulation result');
    expect(screen.queryByRole('heading', { name: 'Can’t reach the map' })).not.toBeInTheDocument();
  });

  test('going offline shows only the bundled artwork and restores the selected layer', async () => {
    const { store } = await renderApp();
    act(() => store.dispatch({ type: 'layer/set', layer: 2 }));
    fireEvent(window, new Event('offline'));
    expect(screen.getByRole('main', { name: 'Waiting to reconnect' })).toBeVisible();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map options' })).not.toBeInTheDocument();
    expect(document.querySelector('.connection-screen__art img')).toHaveAttribute(
      'src', expect.stringMatching(/^data:image\/webp;base64,UklGR/),
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent(window, new Event('online'));
    expect(await screen.findByRole('slider')).toHaveValue('2');
  });

  test('an empty fallback basemap shows the artwork until the provider responds', async () => {
    const { fake } = await renderApp();
    const map = fake.maps[0];
    map.queryRenderedFeatures = () => [];
    let recover!: (response: Response) => void;
    const fetchProbe = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((resolve) => { recover = resolve; }));
    try {
      act(() => {
        map.fire('error', { sourceId: 'vector' });
        map.fire('error', { sourceId: 'vector' });
        map.fire('error', { sourceId: 'context' });
      });
      expect(screen.getByRole('main', { name: 'Waiting to reconnect' })).toBeVisible();
      expect(screen.queryByRole('region', { name: '3D concentration field map' })).not.toBeInTheDocument();
      expect(screen.queryByText('Reload basemap')).not.toBeInTheDocument();
      await act(async () => recover(new Response('{}')));
      expect(screen.getByRole('region', { name: '3D concentration field map' })).toBeVisible();
    } finally {
      fetchProbe.mockRestore();
    }
  });

  test('wind motion stays available inside map options when the wind reading is absent', async () => {
    const { store } = await renderApp();
    expect(screen.queryByRole('switch', { name: 'Wind motion' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Map options' }));
    const control = screen.getByRole('switch', { name: 'Wind motion' });
    expect(control).toBeVisible();
    expect(control).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(control);
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(store.getState().windPaused).toBe(true);
    fireEvent.click(control);
    expect(store.getState().windPaused).toBe(false);
  });
});
