import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../App';
import { useExportContribution } from '../../export/ExportProvider';
import { useMapClick } from '../../map/hooks';
import { createViewerStore } from '../../store/store';
import { fakeApi } from '../../test/fixtures';
import { createFakeMapFactory } from '../../test/fakeMap';
import type { PanelDefinition, PanelProps } from '../types';
import { mapOptionsPanel } from '.';

/** Header written by web/viewer-export.js layerCsv (copied byte for byte). */
const LEGACY_LAYER_HEADER =
  '"run_id","model_version","input_hash","emission_multiplier","z_min_m","z_max_m","z_center_m","mean_ug_m3","max_ug_m3","air_cells","units"\r\n';

const building = {
  type: 'Feature',
  properties: { source_feature_id: 'way/42', height_m: 18.5 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [106.7031, 10.7741],
        [106.7033, 10.7741],
        [106.7033, 10.7743],
        [106.7031, 10.7743],
        [106.7031, 10.7741],
      ],
    ],
  },
};

const scene = {
  study_area_id: 'area-1',
  buildings: { type: 'FeatureCollection', features: [building] },
  roads: { type: 'FeatureCollection', features: [] },
  water: { type: 'FeatureCollection', features: [] },
  green: { type: 'FeatureCollection', features: [] },
};

let downloads: Array<{ name: string; blob: Blob }> = [];
let pendingBlobs: Blob[] = [];

beforeEach(() => {
  downloads = [];
  pendingBlobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    pendingBlobs.push(blob as Blob);
    return `blob:test-${pendingBlobs.length}`;
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: pendingBlobs[pendingBlobs.length - 1] });
  });
});
afterEach(() => vi.restoreAllMocks());

async function renderApp(extraPanels: PanelDefinition[] = [], overrides: Record<string, unknown> = {}, waitForRun = true) {
  const store = createViewerStore();
  const fake = createFakeMapFactory();
  const utils = render(
    <App
      store={store}
      api={fakeApi({ '/study-areas/area-1/scene': scene, ...overrides })}
      mapFactory={fake.factory}
      panels={[mapOptionsPanel, ...extraPanels]}
    />,
  );
  if (waitForRun) await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
  else await waitFor(() => expect(store.getState().bootstrap.status).toBe('ready'));
  await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  act(() => store.dispatch({ type: 'panel/open', id: 'map-options' }));
  return { store, fake, ...utils };
}

function panel() {
  return within(document.getElementById('map-options') as HTMLElement);
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  // jsdom Blobs only expose their bytes through FileReader.
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

describe('map-options panel', () => {
  test('shows the grid size and dispatches layer and basemap toggles', async () => {
    const { store } = await renderApp();
    expect(panel().getByText('Cell 5 × 5 m · grid 2 × 2')).toBeInTheDocument();

    const buildings = panel().getByLabelText('Buildings');
    const facades = panel().getByLabelText('Facade detail');
    expect(buildings).toBeChecked();
    act(() => buildings.click());
    expect(store.getState().layers.buildings).toBe(false);
    expect(facades).toBeDisabled();
    act(() => buildings.click());
    expect(facades).not.toBeDisabled();
    act(() => facades.click());
    expect(store.getState().layers.facades).toBe(false);

    const roads = panel().getByLabelText('Roads');
    expect(roads).not.toBeChecked();
    act(() => roads.click());
    expect(store.getState().layers.roads).toBe(true);

    act(() => panel().getByLabelText(/Moving wind/).click());
    expect(store.getState().layers.wind).toBe(false);
    expect(document.getElementById('wind-source-note')).toHaveTextContent('No wind data for this result.');

    fireEvent.change(panel().getByLabelText('Basemap'), { target: { value: 'raster' } });
    expect(store.getState().basemap).toBe('raster');
    // A basemap change made elsewhere (automatic fallback) is reflected.
    act(() => store.dispatch({ type: 'basemap/set', basemap: 'vector' }));
    expect(panel().getByLabelText('Basemap')).toHaveValue('vector');
  });

  test('shows the selected building height and the result information disclosure', async () => {
    const { store } = await renderApp();
    act(() => store.dispatch({ type: 'building/select', id: 'way/42' }));
    expect(document.getElementById('building-appearance-note')).toHaveTextContent('Selected building · 18.5 m');

    const toggle = panel().getByRole('button', { name: 'Result information' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('result-info-content')).toHaveAttribute('hidden');
    act(() => toggle.click());
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('result-info-content')).not.toHaveAttribute('hidden');
    expect(document.getElementById('run-evidence')).toBeInTheDocument();
    expect(document.getElementById('model-note')).toHaveTextContent('Height-resolved dispersion that accounts for building shapes.');
  });

  test('help buttons carry accessible labels and explanation text', async () => {
    await renderApp();
    const help = panel().getByRole('button', { name: 'Explain moving wind' });
    act(() => help.focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent(/shown 6× faster/);
    expect(help).toHaveAttribute('aria-describedby', 'viewer-help-tooltip');
  });

  test('exports are disabled without a loaded result', async () => {
    await renderApp([], { '/runs?status=succeeded&limit=20': [] }, false);
    for (const name of ['Download the map image (PNG)', 'Download the data (CSV)', 'Download the result information (JSON)'])
      expect(panel().getByRole('button', { name })).toBeDisabled();
  });

  test('exports are disabled while another panel is drawing', async () => {
    function Drawing({ active }: PanelProps) {
      useMapClick(() => {}, { enabled: active, drawing: true });
      return null;
    }
    const drawingPanel: PanelDefinition = { id: 'draw', icon: 'pencil', labelKey: 'common.close', Component: Drawing };
    const { store } = await renderApp([drawingPanel]);
    const csvButton = panel().getByRole('button', { name: 'Download the data (CSV)' });
    expect(csvButton).not.toBeDisabled();
    act(() => store.dispatch({ type: 'panel/open', id: 'draw' }));
    expect(csvButton).toBeDisabled();
    act(() => store.dispatch({ type: 'panel/open', id: 'map-options' }));
    expect(csvButton).not.toBeDisabled();
  });

  test('CSV export: legacy file name, BOM and byte-identical header in both languages', async () => {
    await renderApp();
    const legacy = new TextEncoder().encode(LEGACY_LAYER_HEADER);
    for (const language of ['en', 'vi']) {
      if (language === 'vi') act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
      const name = language === 'en' ? 'Download the data (CSV)' : 'Tải số liệu CSV';
      await act(async () => panel().getByRole('button', { name }).click());
      const file = downloads.at(-1)!;
      expect(file.name).toBe('pm25-real-run-layers.csv');
      expect(file.blob.type).toBe('text/csv;charset=utf-8');
      const data = await bytes(file.blob);
      expect(Array.from(data.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(Array.from(data.slice(3, 3 + legacy.length))).toEqual(Array.from(legacy));
      const text = new TextDecoder().decode(data.slice(3));
      expect(text.split('\r\n')[1]).toBe('"real-run","1","h","1","0","2","1","30","90","3","ug m-3"');
    }
    expect(document.getElementById('export-note')).toHaveTextContent('Đã tải tệp.');
  });

  test('JSON export keeps legacy field names/order and includes contributed panel state', async () => {
    function Region() {
      useExportContribution('region', () => ({ run: 'real-run', request: { polygon: [[1, 2]] } }));
      return null;
    }
    const regionPanel: PanelDefinition = { id: 'region-probe', icon: 'x', labelKey: 'common.close', Component: Region };
    const { store } = await renderApp([regionPanel]);
    act(() => store.dispatch({ type: 'layer/set', layer: 1 }));
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    await act(async () => panel().getByRole('button', { name: 'Tải thông tin kết quả JSON' }).click());
    const file = downloads.at(-1)!;
    expect(file.name).toBe('pm25-real-run-3m.json');
    const report = JSON.parse(new TextDecoder().decode(await bytes(file.blob)));
    expect(Object.keys(report)).toEqual(['title', 'summary', 'comparison', 'mode', 'metadata', 'attribution', 'notice', 'legend']);
    expect(report.comparison).toBeNull();
    expect(report.mode).toBe('Kết quả gốc');
    const meta = report.metadata;
    expect(Object.keys(meta).slice(0, 3)).toEqual(['run_id', 'model_version', 'input_hash']);
    expect(meta).toMatchObject({
      run_id: 'real-run',
      z_requested_m: 3,
      z_center_m: 3,
      z_min_m: 2,
      z_max_m: 4,
      units: 'µg/m³',
      locale: 'vi',
      basemap: 'vector',
      region: { run: 'real-run', request: { polygon: [[1, 2]] } },
      transect: null,
      road_corridor: null,
      layers: { buildings: true, facades: true, roads: false, wind: true, wind_paused: false, grid: true },
    });
    expect(Object.keys(meta).indexOf('region')).toBeLessThan(Object.keys(meta).indexOf('render_lod'));
  });

  test('language switch keeps toggles, disclosure and the export note', async () => {
    const { store } = await renderApp();
    act(() => panel().getByLabelText('Roads').click());
    act(() => panel().getByRole('button', { name: 'Result information' }).click());
    await act(async () => panel().getByRole('button', { name: 'Download the data (CSV)' }).click());
    expect(document.getElementById('export-note')).toHaveTextContent('File downloaded.');
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(panel().getByRole('heading', { name: 'Lớp bản đồ' })).toBeInTheDocument();
    expect(panel().getByLabelText('Đường')).toBeChecked();
    expect(panel().getByRole('button', { name: 'Thông tin kết quả' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('export-note')).toHaveTextContent('Đã tải tệp.');
    expect(panel().getByText('Ô 5 × 5 m · lưới 2 × 2')).toBeInTheDocument();
    expect(store.getState().layers.roads).toBe(true);
  });

  test('a blocked export shows a keyed, translated error', async () => {
    function Blocking() {
      useExportContribution('comparison', () => {
        throw new (class extends Error {})('raw');
      });
      return null;
    }
    const blocking: PanelDefinition = { id: 'block', icon: 'x', labelKey: 'common.close', Component: Blocking };
    await renderApp([blocking]);
    await act(async () => panel().getByRole('button', { name: 'Download the result information (JSON)' }).click());
    expect(document.getElementById('export-note')).toHaveTextContent(/^Export failed: /);
    expect(document.getElementById('export-note')).not.toHaveTextContent('raw');
    expect(downloads).toHaveLength(0);
  });
});
