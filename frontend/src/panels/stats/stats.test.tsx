import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { App } from '../../App';
import type { ProfileResult } from '../../api/types';
import type { ApiFn } from '../../store/controller';
import { createViewerStore } from '../../store/store';
import { createFakeMapFactory } from '../../test/fakeMap';
import { fakeApi } from '../../test/fixtures';
import { statsPanel } from '.';
import { profileChart, profileValues } from './profile';

const profile = (i: number, j: number, values: Array<number | null>): ProfileResult => ({
  run_id: 'real-run',
  i,
  j,
  units: 'ug m-3',
  centre: {},
  levels: values.map((v, k) => ({ k, z_m: 1 + 2 * k, concentration_ug_m3: v })),
});

/** fakeApi whose profile route is answered by `onProfile` (so tests can delay it). */
function apiWithProfiles(onProfile: (i: number, j: number) => Promise<ProfileResult>) {
  const base = fakeApi();
  const fn = (async (path: string, options?: unknown) => {
    const match = path.match(/^\/runs\/real-run\/profile\?i=(\d+)&j=(\d+)$/);
    if (match) {
      base.calls.push(path);
      return onProfile(Number(match[1]), Number(match[2]));
    }
    return base(path, options as never);
  }) as ApiFn & { calls: string[] };
  fn.calls = base.calls;
  return fn;
}

async function renderStats(api: ApiFn = apiWithProfiles(async (i, j) => profile(i, j, [12.5, null, 3]))) {
  const store = createViewerStore();
  const fake = createFakeMapFactory();
  const utils = render(<App store={store} api={api} mapFactory={fake.factory} panels={[statsPanel]} />);
  await waitFor(() => expect(store.getState().selectedRunId).toBe('real-run'));
  act(() => store.dispatch({ type: 'panel/open', id: 'stats' }));
  return { store, fake, ...utils };
}

const panel = () => document.getElementById('analysis-details') as HTMLElement;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('stats panel', () => {
  test('renders current-layer statistics and the exact exceedance area', async () => {
    await renderStats();
    const p = within(panel());
    // Legacy section label (differs from the tool button "Statistics").
    expect(panel()).toHaveAttribute('aria-label', 'Statistics and selected cell');
    expect(p.getByRole('heading', { name: 'Concentration at the current level' })).toBeInTheDocument();
    expect(document.getElementById('stats-context')).toHaveTextContent('Level 0–2 m');
    expect(document.getElementById('stat-mean')).toHaveTextContent('30');
    expect(document.getElementById('stat-max')).toHaveTextContent('90');
    const box = p.getByRole('checkbox', { name: 'Highlight cells above WHO 24h: 15 µg/m³' });
    expect(box).not.toBeChecked();
    expect(p.getByText('WHO')).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('threshold-outcome-who_24h')).toHaveTextContent('25 m² above the threshold at this level.'));
    // No cell selected: the profile section stays hidden (legacy).
    expect(document.getElementById('selected-cell-detail')).not.toBeVisible();
  });

  test('selecting a threshold enables the map highlight', async () => {
    const { store } = await renderStats();
    const box = within(panel()).getByRole('checkbox', { name: /Highlight cells above WHO 24h/ });
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(store.getState().thresholdsEnabled).toEqual({ who_24h: true });
    fireEvent.click(box);
    expect(store.getState().thresholdsEnabled).toEqual({ who_24h: false });
  });

  test('fetches the exact profile of the selected cell and shows it as chart and table', async () => {
    const api = apiWithProfiles(async (i, j) => profile(i, j, [12.5, null, 3]));
    const { store } = await renderStats(api);
    act(() => store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } }));
    expect(within(panel()).getByText('Loading data by height…')).toBeInTheDocument();
    await waitFor(() => expect(within(panel()).getByText('Cell 1, 0 · maximum 12.5 µg/m³')).toBeInTheDocument());
    expect(api.calls).toContain('/runs/real-run/profile?i=1&j=0');
    const p = within(panel());
    expect(p.getByRole('img', { name: 'Concentration profile by height at cell 1, 0' })).toBeInTheDocument();
    expect(p.getByText('Queried data')).toBeInTheDocument();
    const rows = within(p.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows.map((row) => Array.from(row.children).map((c) => c.textContent))).toEqual([
      ['1 (current level)', '1', '12.5'],
      ['2', '3', 'Building'],
      ['3', '5', '3'],
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
  });

  test('a late profile response for a previously selected cell is ignored', async () => {
    const pending: Record<string, ReturnType<typeof deferred<ProfileResult>>> = {};
    const api = apiWithProfiles((i, j) => {
      pending[`${i}:${j}`] = deferred<ProfileResult>();
      return pending[`${i}:${j}`].promise;
    });
    const { store } = await renderStats(api);
    act(() => store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } }));
    await waitFor(() => expect(pending['1:0']).toBeDefined());
    act(() => store.dispatch({ type: 'cell/select', cell: { i: 0, j: 1 } }));
    await waitFor(() => expect(pending['0:1']).toBeDefined());
    await act(async () => pending['0:1'].resolve(profile(0, 1, [7, 8, 9])));
    await waitFor(() => expect(within(panel()).getByText('Cell 0, 1 · maximum 9 µg/m³')).toBeInTheDocument());
    await act(async () => pending['1:0'].resolve(profile(1, 0, [500, 500, 500])));
    const p = within(panel());
    expect(p.getByText('Cell 0, 1 · maximum 9 µg/m³')).toBeInTheDocument();
    expect(p.queryByText(/500/)).not.toBeInTheDocument();
    expect(store.getState().queries.status).toBe('idle');
  });

  test('illustration mode labels the figures as adjusted and uses the adjusted values', async () => {
    const api = apiWithProfiles(async (i, j) => profile(i, j, [12.5, null, 3]));
    const { store } = await renderStats(api);
    act(() => {
      store.dispatch({ type: 'display/set', display: { multiplier: 10 } });
      store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } });
    });
    expect(document.getElementById('stats-context')).toHaveTextContent('Level 0–2 m · Illustration');
    expect(document.getElementById('stat-mean')).toHaveTextContent('300');
    const p = within(panel());
    expect(p.getByText('Adjusted estimate (illustration)')).toBeInTheDocument();
    // Cell (1, 0) has code 1 (= 0 µg/m³) in the fixture volume at every level.
    expect(p.getByText('Cell 1, 0 · maximum 0 µg/m³')).toBeInTheDocument();
    expect(api.calls.some((call) => call.includes('/profile'))).toBe(false);
    // Adjusted areas are recomputed locally: one cell of 5 × 5 m above 15 µg/m³.
    expect(document.getElementById('threshold-outcome-who_24h')).toHaveTextContent('25 m² above the threshold at this level.');

    act(() => store.dispatch({ type: 'display/reset' }));
    expect(document.getElementById('stats-context')).toHaveTextContent(/^Level 0–2 m$/);
    await waitFor(() => expect(p.getByText('Queried data')).toBeInTheDocument());
  });

  test('switching language keeps the threshold and cell selection and formats numbers', async () => {
    const { store } = await renderStats();
    fireEvent.click(within(panel()).getByRole('checkbox', { name: /Highlight cells above WHO 24h/ }));
    act(() => store.dispatch({ type: 'cell/select', cell: { i: 1, j: 0 } }));
    await waitFor(() => expect(within(panel()).getByText('Cell 1, 0 · maximum 12.5 µg/m³')).toBeInTheDocument());

    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    const p = within(panel());
    expect(panel()).toHaveAttribute('aria-label', 'Thống kê và ô được chọn');
    expect(p.getByRole('heading', { name: 'Nồng độ tầng đang xem' })).toBeInTheDocument();
    expect(document.getElementById('stats-context')).toHaveTextContent('Tầng 0–2 m');
    expect(p.getByRole('checkbox', { name: 'Tô vùng vượt WHO 24h: 15 µg/m³' })).toBeChecked();
    expect(p.getByText('Ô 1, 0 · cao nhất 12,5 µg/m³')).toBeInTheDocument();
    expect(p.getByText('Dữ liệu truy vấn')).toBeInTheDocument();
    const table = p.getByRole('table');
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent('Tầng');
    expect(within(table).getAllByRole('row')[1].children[0]).toHaveTextContent('1 (tầng đang xem)');
    expect(store.getState().selectedCell).toEqual({ i: 1, j: 0 });
    expect(store.getState().thresholdsEnabled).toEqual({ who_24h: true });
  });
});

describe('profile helpers', () => {
  const grid = { nx: 2, ny: 2, nz: 3 };
  const volume = { codes: new Uint8Array(12).fill(1), lut: new Float64Array([NaN, 0]), scale: { c_max: 100, decades: 4, levels: 254, first_code: 2 } };

  test('exact values come from the profile; null is a building; null profile means loading', () => {
    const display = { multiplier: 1, background: 0 };
    expect(profileValues({ exact: true, profile: undefined, volume, grid, display, i: 0, j: 0 })).toBeNull();
    const values = profileValues({ exact: true, profile: profile(0, 0, [1, null, 2]), volume, grid, display, i: 0, j: 0 });
    expect(values).toEqual([1, NaN, 2]);
  });

  test('adjusted values apply multiplier and background to the render codes', () => {
    const values = profileValues({ exact: false, profile: undefined, volume, grid, display: { multiplier: 3, background: 4 }, i: 1, j: 1 });
    expect(values).toEqual([4, 4, 4]);
  });

  test('chart draws a line, building bands and threshold markers', () => {
    const chart = profileChart({
      values: [10, NaN, 20],
      zCentres: [1, 3, 5],
      dz: 2,
      nz: 3,
      scale: { lo: 0.01, hi: 100 },
      thresholds: [{ key: 'who_24h', value: 15 }],
      layer: 2,
    });
    expect(chart.path.startsWith('M')).toBe(true);
    expect(chart.path.split('M')).toHaveLength(3); // the building level breaks the line
    expect(chart.solids).toHaveLength(1);
    expect(chart.thresholds.map((th) => th.key)).toEqual(['who_24h']);
    expect(chart.max).toBe(20);
    expect(chart.yTicks.map((tick) => tick.value)).toEqual([0, 3, 6]);
  });
});
