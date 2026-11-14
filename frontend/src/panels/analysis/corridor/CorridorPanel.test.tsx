/** UI flows of the road corridor analysis (mirrors web/tests/viewer-corridor.test.cjs). */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { App } from '../../../App';
import { ApiError } from '../../../api/client';
import { useReportSnapshot } from '../../../export/ExportProvider';
import type { Report } from '../../../export/report';
import type { MapFactory } from '../../../map/MapView';
import { createViewerStore } from '../../../store/store';
import { fakeApi, routedApi } from '../../../test/fixtures';
import { createFakeMapFactory } from '../../../test/fakeMap';
import type { PanelDefinition, PanelProps } from '../../types';
import { CorridorPanel, type CorridorBand } from './CorridorPanel';


const roads = [
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[106.7, 10.77], [106.701, 10.77]] }, properties: { source_feature_id: 'a', road_class: 'primary', emission_share: 0.1 } },
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[106.7, 10.771], [106.701, 10.771]] }, properties: { source_feature_id: 'b', road_class: 'residential', emission_share: 0.1 } },
];
const scene = {
  study_area_id: 'area-1',
  buildings: { type: 'FeatureCollection', features: [] },
  roads: { type: 'FeatureCollection', features: roads },
  water: { type: 'FeatureCollection', features: [] },
  green: { type: 'FeatureCollection', features: [] },
};

const band = (inner: number, outer: number, mean: number | null): CorridorBand => ({
  inner_m: inner,
  outer_m: outer,
  area_m2: 100,
  geometry: { type: 'Polygon', coordinates: [[[106.7, 10.77], [106.701, 10.77], [106.701, 10.771], [106.7, 10.77]]] },
  air_volume_m3: 1000,
  valid_volume_m3: mean === null ? 0 : 1000,
  coverage: mean === null ? 0 : 1,
  mean_ug_m3: mean,
  exceedance_volume_m3: mean !== null && mean > 15 ? 250 : 0,
});
type Body = { road_ids: string[]; distances_m: number[]; z_min_m: number; z_max_m: number; threshold_ug_m3: number };
const response = (request: Body) => ({
  run_id: 'real-run',
  units: 'ug m-3',
  road_ids: request.road_ids,
  z_min_m: request.z_min_m,
  z_max_m: request.z_max_m,
  threshold_ug_m3: request.threshold_ug_m3,
  bands: [band(0, 10, 20), band(10, 25, 8), band(25, 50, null)],
});

const snapshot: { current: (() => Report) | null } = { current: null };
function Exporter() {
  snapshot.current = useReportSnapshot();
  return null;
}
const panels: PanelDefinition[] = [
  { id: 'corridor-test', icon: 'signpost', labelKey: 'corridor.modeLabel', Component: ({ active }: PanelProps) => <CorridorPanel active={active} /> },
  { id: 'exporter', icon: 'x', labelKey: 'corridor.title', Component: () => null, Persistent: Exporter },
];

function layerIds(overlay: { setProps: { mock: { calls: unknown[][] } } }) {
  const last = overlay.setProps.mock.calls.at(-1)?.[0] as { layers?: Array<{ id: string }> } | undefined;
  return (last?.layers ?? []).map((layer) => layer.id);
}
const frame = () => act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const tick = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function setup(handler: (path: string, body: Body) => Promise<unknown> = async (_p, body) => response(body)) {
  const calls: Array<[string, Body]> = [];
  const api = routedApi(
    /^\/runs\/[^/]+\/road-corridor/,
    (path, options) => {
      const body = JSON.parse((options as { body: string }).body) as Body;
      calls.push([path, body]);
      return handler(path, body);
    },
    fakeApi({ '/study-areas/area-1/scene': scene }),
  );
  const store = createViewerStore();
  const fake = createFakeMapFactory();
  const factory: MapFactory = (options) => {
    const made = fake.factory(options);
    Object.assign(made.map as object, { getZoom: () => 18 });
    return made;
  };
  render(<App store={store} api={api} mapFactory={factory} panels={panels} />);
  await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
  act(() => store.dispatch({ type: 'panel/open', id: 'corridor-test' }));
  await frame();
  const list = () => document.getElementById('corridor-road-list') as HTMLSelectElement;
  const choose = (...indices: number[]) => {
    for (const option of list().options) option.selected = indices.includes(option.index);
    fireEvent.change(list());
  };
  const click = (lng: number, lat: number) =>
    act(() => fake.maps[0].fire('click', { lngLat: { lng, lat }, point: { x: 0, y: 0 } }));
  const button = (name: string | RegExp) => screen.getByRole('button', { name });
  return { store, fake, calls, list, choose, click, button, zoom: () => fake.maps[0].doubleClickZoom.isEnabled(), overlay: () => fake.overlays[0] };
}

const text = (id: string) => document.getElementById(id)!.textContent ?? '';

describe('CorridorPanel', () => {
  test('picks roads on the map, queries exact server statistics and renders the band table', async () => {
    const ui = await setup();
    expect(screen.getByLabelText('Road segments (hold Ctrl to select several)')).toBe(ui.list());
    expect(ui.list().options).toHaveLength(2);
    expect(ui.list().options[0].textContent).toMatch(/^Segment 1 · primary road · 10\d m$/);
    act(() => ui.button('Pick on map').click());
    await frame();
    expect(ui.zoom()).toBe(false);
    expect(ui.fake.maps[0].dragPan.enabled).toBe(false);
    ui.click(106.7005, 10.77);
    expect(ui.list().options[0].selected).toBe(true);
    expect(text('corridor-note')).toBe('1 road segments selected · press Done when finished.');
    ui.click(106.705, 10.775);
    expect(text('corridor-note')).toMatch(/No road near/);
    act(() => ui.button('Done picking roads').click());
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.fake.maps[0].dragPan.enabled).toBe(true);
    expect(document.getElementById('corridor-settings')).toBeVisible();
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    act(() => ui.button('Analyse corridor').click());
    await tick();
    expect(ui.calls).toEqual([
      ['/runs/real-run/road-corridor', { road_ids: ['a'], distances_m: [10, 25, 50], z_min_m: 0, z_max_m: 6, threshold_ug_m3: 15 }],
    ]);
    const region = screen.getByRole('region', { name: 'Road corridor result' });
    expect(region).toBeVisible();
    const table = within(region).getByRole('table');
    const rows = within(table).getAllByRole('row').map((row) => row.textContent);
    expect(rows[1]).toBe('0–1020100%25%');
    expect(rows[3]).toBe('25–50No data0%No data');
    expect(region.textContent).toMatch(/higher than the band 10–25 m by about 12 µg\/m³/);
    expect(region.textContent).toMatch(/Dry season · Voxel · real · 1 road segments · 0–6 m/);
    expect(ui.button('Download CSV')).not.toBeDisabled();
    await frame();
    expect(layerIds(ui.overlay())).toEqual(expect.arrayContaining(['corridor-bands', 'corridor-roads']));
    expect(snapshot.current!().metadata.road_corridor).toEqual({ run: 'real-run', request: ui.calls[0][1] });
  });

  test('keyboard list selection works and stale or illustrated results never reach the panel', async () => {
    let resolve: () => void = () => {};
    const ui = await setup((_p, body) => new Promise((r) => (resolve = () => r(response(body)))));
    ui.choose(1);
    expect(text('corridor-note')).toBe('1 road segments selected.');
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    act(() => ui.button('Analyse corridor').click());
    expect(ui.button('Analysing…')).toBeDisabled();
    act(() => ui.store.dispatch({ type: 'run/select', id: 'mock-run' }));
    resolve();
    await tick();
    expect(screen.queryByRole('region', { name: 'Road corridor result' })).toBeNull();
    expect(text('corridor-feedback')).toBe('The roads are kept; analyse again to see the new result.');
    expect(ui.list().options[1].selected).toBe(true);
    act(() => ui.store.dispatch({ type: 'display/set', display: { multiplier: 10 } }));
    expect(ui.button('Analyse corridor')).toBeDisabled();
    expect(text('corridor-feedback')).toMatch(/Illustration is applied/);
  });

  test('invalid distances are reported without calling the API, and becoming inactive stops picking and drops layers', async () => {
    const ui = await setup();
    ui.choose(0);
    fireEvent.change(screen.getByLabelText('Distance marks (m)'), { target: { value: '25, 10' } });
    act(() => ui.button('Analyse corridor').click());
    await tick();
    expect(ui.calls).toHaveLength(0);
    expect(text('corridor-feedback')).toBe('Distance marks must increase, without duplicates.');
    act(() => ui.button('Pick on map').click());
    await frame();
    expect(layerIds(ui.overlay())).toContain('corridor-roads');
    act(() => ui.store.dispatch({ type: 'panel/open', id: null }));
    await frame();
    expect(ui.zoom()).toBe(true);
    expect(ui.fake.maps[0].dragPan.enabled).toBe(true);
    expect(layerIds(ui.overlay()).filter((id) => id.startsWith('corridor'))).toEqual([]);
    // Clicks while inactive never toggle roads.
    ui.click(106.7005, 10.771);
    expect(ui.list().options[1].selected).toBe(false);
  });

  test('a server-side road mismatch maps to a recoverable message', async () => {
    const ui = await setup(async () => {
      throw Object.assign(new ApiError('validation', 400), { detail: 'One or more road IDs are absent from the run scene' });
    });
    ui.choose(0);
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    act(() => ui.button('Analyse corridor').click());
    await tick();
    expect(text('corridor-feedback')).toBe('Some road segments do not belong to the scene of this result. Select the roads again.');
    expect(ui.button('Analyse corridor')).not.toBeDisabled();
  });

  test('CSV uses the successful request; a failure shows the keyed reason', async () => {
    let fail = false;
    const ui = await setup(async (path, body) => {
      if (path.endsWith('/csv')) {
        if (fail) throw new ApiError('server', 500);
        return 'a,b\n';
      }
      return response(body);
    });
    let name = '';
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download;
    });
    ui.choose(0, 1);
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    act(() => ui.button('Analyse corridor').click());
    await tick();
    act(() => ui.button('Download CSV').click());
    await tick();
    expect(ui.calls[1]).toEqual(['/runs/real-run/road-corridor/csv', ui.calls[0][1]]);
    expect(name).toBe('road-corridor-real-run.csv');
    expect(text('corridor-feedback')).toBe('CSV table downloaded.');
    fail = true;
    act(() => ui.button('Download CSV').click());
    await tick();
    expect(text('corridor-feedback')).toBe(
      'Could not download the data table. The system could not process the request. Please try again later.',
    );
    anchor.mockRestore();
  });

  test('editing settings after a result clears it and asks to re-analyse', async () => {
    const ui = await setup();
    ui.choose(0);
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    act(() => ui.button('Analyse corridor').click());
    await tick();
    expect(ui.button('Analyse again')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reference threshold (µg/m³)'), { target: { value: '20' } });
    expect(screen.queryByRole('region', { name: 'Road corridor result' })).toBeNull();
    expect(text('corridor-note')).toBe('Press Analyse corridor to update.');
    expect(snapshot.current!().metadata.road_corridor).toBeNull();
  });

  test('editing settings while a request is in flight drops the stale response', async () => {
    let resolve: () => void = () => {};
    const ui = await setup((_p, body) => new Promise((r) => (resolve = () => r(response(body)))));
    ui.choose(0);
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    expect(text('corridor-note')).toBe('1 road segments selected.');
    act(() => ui.button('Analyse corridor').click());
    expect(ui.button('Analysing…')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reference threshold (µg/m³)'), { target: { value: '30' } });
    expect(ui.button('Analyse corridor')).not.toBeDisabled();
    expect(text('corridor-note')).toBe('Press Analyse corridor to update.');
    resolve();
    await tick();
    expect(screen.queryByRole('region', { name: 'Road corridor result' })).toBeNull();
    expect(snapshot.current!().metadata.road_corridor).toBeNull();
    expect(ui.calls).toHaveLength(1);
  });

  test('switching language keeps the selected roads and the result', async () => {
    const ui = await setup();
    ui.choose(0);
    fireEvent.change(screen.getByLabelText('To height (m)'), { target: { value: '6' } });
    act(() => ui.button('Analyse corridor').click());
    await tick();
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(ui.list().options[0].selected).toBe(true);
    expect(ui.list().options[0].textContent).toMatch(/^Đoạn 1 · đường chính · 10\d m$/);
    const region = screen.getByRole('region', { name: 'Kết quả hành lang đường' });
    expect(region.textContent).toMatch(/Dải gần 0–10 m cao hơn dải 10–25 m khoảng 12 µg\/m³/);
    expect(region.textContent).toMatch(/Không có dữ liệu/);
    expect(screen.getByRole('button', { name: 'Tải CSV' })).toBeInTheDocument();
    expect(ui.calls).toHaveLength(1);
  });
});
