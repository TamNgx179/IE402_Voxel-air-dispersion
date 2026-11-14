import { act, render, screen, waitFor, within } from '@testing-library/react';
import { useMemo } from 'react';
import { describe, expect, test } from 'vitest';
import { PathLayer } from '@deck.gl/layers';
import { App } from './App';
import { ApiError, api as realApi } from './api/client';
import { useMapClick, useMapLayers } from './map/hooks';
import { PANELS } from './panels';
import type { PanelDefinition, PanelProps } from './panels/types';
import { useApi, type ApiFn } from './store/controller';
import { createViewerStore } from './store/store';
import { fakeApi } from './test/fixtures';
import { createFakeMapFactory } from './test/fakeMap';
import { useExportContribution, useReportSnapshot } from './export/ExportProvider';

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
      'Dry season · Test data · mock',
      'Dry season · Voxel · real',
    ]);
    expect(fake.maps).toHaveLength(1);
    expect(layerIds(fake.overlays[0])).toEqual([
      'water',
      'green',
      'roads',
      'concentration',
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
    expect(screen.getByRole('heading', { level: 2, name: 'Kết quả mô phỏng' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chuyển ngôn ngữ sang tiếng Anh' })).toHaveAttribute('aria-pressed', 'false');
    expect((screen.getByLabelText('Chọn kết quả mô phỏng') as HTMLSelectElement).selectedOptions[0].textContent).toBe(
      'Mùa khô · Voxel · real',
    );
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'tầng 3: 4–6 m');
    const state = store.getState();
    expect(state.selectedRunId).toBe('real-run');
    expect(state.layer).toBe(2);
    expect(state.activePanel).toBe('illustration');
    expect(state.selectedCell).toEqual({ i: 1, j: 0 });
    expect(fake.maps).toHaveLength(1);
    expect(fake.maps[0].remove).not.toHaveBeenCalled();
    expect(screen.getByText('Ô i=1, j=0 · tầng k=2', { exact: false })).toBeInTheDocument();
  });

  test('tool buttons open one panel at a time and keep closed panels mounted', async () => {
    await renderApp();
    const nav = screen.getByRole('navigation', { name: 'Map tools' });
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Simulation', 'Map', 'Statistics', 'Analysis', 'Illustration']);
    act(() => buttons[4].click());
    expect(buttons[4]).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('illustration-options')).not.toHaveAttribute('hidden');
    act(() => buttons[3].click());
    expect(document.getElementById('illustration-options')).toHaveAttribute('hidden');
    expect(document.getElementById('spatial-analysis')).not.toHaveAttribute('hidden');
    act(() => buttons[3].click());
    expect(buttons.every((b) => b.getAttribute('aria-expanded') === 'false')).toBe(true);
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
    expect(screen.getByText(/× 10 \+ background 0/)).toBeInTheDocument();
    expect(screen.getByText('Estimate from the advanced adjustments')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Back to original data' }).click());
    expect(store.getState().display).toEqual({ multiplier: 1, background: 0 });
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

  test('unmount removes the map and finalizes the overlay', async () => {
    const { fake, unmount } = await renderApp();
    unmount();
    expect(fake.maps[0].remove).toHaveBeenCalledTimes(1);
    expect(fake.overlays[0].finalize).toHaveBeenCalledTimes(1);
  });

  test('bootstrap failure shows a translated error with retry and no map', async () => {
    const store = createViewerStore();
    const fake = createFakeMapFactory();
    render(<App store={store} api={fakeApi({ '/thresholds': new ApiError('network') })} mapFactory={fake.factory} />);
    await waitFor(() => expect(screen.getByText('The application data could not be loaded.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(fake.maps).toHaveLength(0);
    expect(screen.getByLabelText('Choose a simulation result')).toBeDisabled();
  });

  test('wind HUD pause button toggles and is labelled for its action', async () => {
    const { store } = await renderApp();
    // The fixture run has no wind artifact, so the HUD stays hidden.
    expect(document.getElementById('wind-hud')).toHaveAttribute('hidden');
    act(() => store.dispatch({ type: 'wind/paused', paused: true }));
    expect(document.getElementById('wind-motion')).toHaveAttribute('aria-label', 'Resume wind motion');
  });
});
