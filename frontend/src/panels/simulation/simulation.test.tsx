import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { App } from '../../App';
import { ApiError, type RequestOptions } from '../../api/client';
import type { RunView } from '../../api/types';
import type { ApiFn } from '../../store/controller';
import { createViewerStore } from '../../store/store';
import { fakeApi } from '../../test/fixtures';
import { createFakeMapFactory } from '../../test/fakeMap';
import { simulationPanel } from '.';
import { ACTIVE_RUN_KEY, MAX_FAILURES, configureSimulationTracker, pollDelay } from './tracker';

function runView(status: RunView['status'], extra: Partial<RunView> = {}): RunView {
  return {
    run_id: 'new-run',
    emission_multiplier: 0.8,
    status,
    progress: 0,
    attempt: 1,
    model: 'fv',
    scenario: { id: 'dry_nov_apr', name: 'Dry', wind_from_deg: 90, wind_speed_m_s: 1.5 },
    error: null,
    model_version: '1',
    input_hash: 'h',
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
    started_at: null,
    finished_at: null,
    ...extra,
  };
}

/** Simulation API mock: POST /runs result and a queue of GET /runs/new-run responses. */
function simulationApi(post: unknown, polls: unknown[]) {
  const posts: Array<Record<string, unknown>> = [];
  const gets: string[] = [];
  const fn = (async (path: string, options?: RequestOptions) => {
    if (path === '/runs' && options?.method === 'POST') {
      posts.push(JSON.parse(String(options.body)) as Record<string, unknown>);
      if (post instanceof Error) throw post;
      return post;
    }
    gets.push(path);
    const next = polls.length > 1 ? polls.shift() : polls[0];
    if (next instanceof Error) throw next;
    return structuredClone(next);
  }) as ApiFn;
  return { fn, posts, gets };
}

/** A sleep the test releases step by step. */
function manualSleep() {
  const waiting: Array<() => void> = [];
  const sleeps: number[] = [];
  return {
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        sleeps.push(ms);
        waiting.push(resolve);
      }),
    sleeps,
    async step() {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      await act(async () => waiting.shift()?.());
    },
  };
}

async function renderPanel(sim: { fn: ApiFn }, sleep: (ms: number) => Promise<void> = () => Promise.resolve()) {
  const store = createViewerStore();
  configureSimulationTracker(store, { api: sim.fn, sleep });
  const utils = render(<App store={store} api={fakeApi()} mapFactory={createFakeMapFactory().factory} panels={[simulationPanel]} />);
  await waitFor(() => expect(store.getState().selectedRunId).not.toBeNull());
  act(() => store.dispatch({ type: 'panel/open', id: 'simulation' }));
  return { store, ...utils };
}

const runButton = () => screen.getByRole('button', { name: 'Run' });
const note = () => document.getElementById('run-note') as HTMLElement;

describe('simulation panel', () => {
  test('renders the legacy form in English with scenario and emission presets', async () => {
    await renderPanel(simulationApi({}, [runView('queued')]));
    expect(screen.getByRole('heading', { name: 'Run a simulation' })).toBeInTheDocument();
    const emission = screen.getByLabelText('Emission source') as HTMLSelectElement;
    expect([...emission.options].map((o) => [o.value, o.textContent])).toEqual([
      ['1', 'Original source'],
      ['0.8', 'Reduced 20%'],
      ['0.6', 'Reduced 40%'],
    ]);
    const scenario = screen.getByLabelText('Simulation scenario') as HTMLSelectElement;
    expect(scenario.selectedOptions[0].textContent).toBe('Dry season · 1.5 m/s');
    expect(runButton()).toBeEnabled();
    expect(screen.getByRole('progressbar', { hidden: true })).not.toBeVisible();
  });

  test('sends exactly one POST with a stable request id and never retries it', async () => {
    const sim = simulationApi(new ApiError('network'), [runView('queued')]);
    await renderPanel(sim);
    fireEvent.change(screen.getByLabelText('Emission source'), { target: { value: '0.8' } });
    act(() => {
      runButton().click();
      runButton().click();
    });
    await waitFor(() => expect(note()).toHaveTextContent('No confirmation received yet.'));
    expect(sim.posts).toHaveLength(1);
    expect(sim.posts[0]).toMatchObject({ scenario_id: 'dry_nov_apr', emission_multiplier: 0.8, model: 'fv' });
    const requestId = sim.posts[0].request_id;
    expect(typeof requestId).toBe('string');
    // Still one POST after a while: nothing retries automatically.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(sim.posts).toHaveLength(1);
    expect(sim.gets).toHaveLength(0);

    // Error details disclosure shows the i18n text, collapsed by default.
    const toggle = screen.getByRole('button', { name: 'Error details' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('run-error-content')).not.toBeVisible();
    act(() => toggle.click());
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('run-error-detail')).toHaveTextContent('Cannot reach the API.');

    // A manual re-click reuses the same request id (server-side de-duplication).
    await waitFor(() => expect(runButton()).toBeEnabled());
    act(() => runButton().click());
    await waitFor(() => expect(sim.posts).toHaveLength(2));
    expect(sim.posts[1].request_id).toBe(requestId);
  });

  test('shows progress, then adds the new run to the result list and selects it', async () => {
    const sim = simulationApi({ run_id: 'new-run', status: 'queued', attempt: 1 }, [
      runView('queued'),
      runView('running', { progress: 0.42 }),
      runView('succeeded', { progress: 1 }),
    ]);
    const timer = manualSleep();
    const { store } = await renderPanel(sim, timer.sleep);
    act(() => runButton().click());
    await waitFor(() => expect(note()).toHaveTextContent('Queued'));
    const bar = screen.getByRole('progressbar', { name: 'Simulation progress' }) as HTMLProgressElement;
    expect(bar).toBeVisible();
    expect(runButton()).toBeDisabled();
    expect(window.sessionStorage.getItem(ACTIVE_RUN_KEY)).toBe('new-run');

    await timer.step();
    await waitFor(() => expect(note()).toHaveTextContent('Computing · 42%'));
    expect(bar.value).toBe(42);

    await timer.step();
    await waitFor(() => expect(store.getState().selectedRunId).toBe('new-run'));
    expect(store.getState().runs[0].id).toBe('new-run');
    expect(note()).toHaveTextContent('Finished · the new result is shown on the map.');
    expect(bar).not.toBeVisible();
    expect(runButton()).toBeEnabled();
    expect(sim.posts).toHaveLength(1);
    expect(window.sessionStorage.getItem(ACTIVE_RUN_KEY)).toBeNull();
    const select = screen.getByLabelText('Choose a simulation result') as HTMLSelectElement;
    expect(select.value).toBe('new-run');
    expect(select.selectedOptions[0].textContent).toBe('Dry season · Voxel · Reduced 20% · new-');
    expect(document.getElementById('status')).toHaveTextContent('Simulation finished');
  });

  test('a failed run (timeout) shows the reason from i18n, never the server text', async () => {
    const sim = simulationApi({ run_id: 'new-run', status: 'queued', attempt: 1 }, [
      runView('failed', { error: { kind: 'timeout', message: 'solver exceeded 600 s RAW' } }),
    ]);
    await renderPanel(sim);
    act(() => runButton().click());
    await waitFor(() => expect(note()).toHaveTextContent('Did not finish. You can run it again.'));
    act(() => screen.getByRole('button', { name: 'Error details' }).click());
    expect(document.getElementById('run-error-detail')).toHaveTextContent('The simulation exceeded the allowed time.');
    expect(document.body.textContent).not.toContain('RAW');
    expect(runButton()).toBeEnabled();
    expect(document.getElementById('run-retry')).not.toBeVisible();
  });

  test('a stale run reports the interruption', async () => {
    await renderPanel(simulationApi({ run_id: 'new-run', status: 'queued', attempt: 1 }, [runView('stale')]));
    act(() => runButton().click());
    await waitFor(() => expect(note()).toHaveTextContent('Interrupted. You can run it again.'));
  });

  test('polling backs off, stops after repeated failures and "keep tracking" resumes without a new POST', async () => {
    const failures = Array.from({ length: MAX_FAILURES }, () => new ApiError('server', 503));
    const sim = simulationApi({ run_id: 'new-run', status: 'queued', attempt: 1 }, [...failures, runView('succeeded', { progress: 1 })]);
    const sleeps: number[] = [];
    const { store } = await renderPanel(sim, async (ms) => {
      sleeps.push(ms);
    });
    act(() => runButton().click());
    const retry = await screen.findByRole('button', { name: 'Keep tracking' });
    expect(note()).toHaveTextContent('Connection temporarily lost.');
    expect(sleeps).toEqual([1, 2, 3, 4].map(pollDelay));
    expect(sleeps[3]).toBeGreaterThan(sleeps[0]);
    expect(runButton()).toBeDisabled();
    act(() => retry.click());
    await waitFor(() => expect(store.getState().selectedRunId).toBe('new-run'));
    expect(sim.posts).toHaveLength(1);
    expect(sim.gets).toHaveLength(MAX_FAILURES + 1);
  });

  test('a missing run stops tracking and re-enables Run', async () => {
    window.sessionStorage.setItem(ACTIVE_RUN_KEY, 'gone');
    const sim = simulationApi({}, [new ApiError('not-found', 404)]);
    await renderPanel(sim);
    await waitFor(() => expect(note()).toHaveTextContent('The saved run was not found.'));
    expect(window.sessionStorage.getItem(ACTIVE_RUN_KEY)).toBeNull();
    expect(runButton()).toBeEnabled();
  });

  test('resumes tracking the active run after a reload', async () => {
    window.sessionStorage.setItem(ACTIVE_RUN_KEY, 'new-run');
    const sim = simulationApi({}, [runView('succeeded', { progress: 1 })]);
    const { store } = await renderPanel(sim);
    await waitFor(() => expect(store.getState().selectedRunId).toBe('new-run'));
    expect(sim.gets[0]).toBe('/runs/new-run');
    expect(sim.posts).toHaveLength(0);
  });

  test('switching language keeps the tracking state and re-renders the copy', async () => {
    const sim = simulationApi({ run_id: 'new-run', status: 'queued', attempt: 1 }, [
      runView('running', { progress: 0.5 }),
      runView('succeeded', { progress: 1 }),
    ]);
    const timer = manualSleep();
    const { store } = await renderPanel(sim, timer.sleep);
    fireEvent.change(screen.getByLabelText('Emission source'), { target: { value: '0.6' } });
    act(() => runButton().click());
    await waitFor(() => expect(note()).toHaveTextContent('Computing · 50%'));
    act(() => screen.getByRole('button', { name: 'Switch language to Vietnamese' }).click());
    expect(note()).toHaveTextContent('Đang tính toán · 50%');
    expect((screen.getByLabelText('Nguồn phát thải') as HTMLSelectElement).value).toBe('0.6');
    expect(screen.getByRole('button', { name: 'Chạy' })).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Tiến độ mô phỏng' })).toBeVisible();
    await timer.step();
    await waitFor(() => expect(store.getState().selectedRunId).toBe('new-run'));
    expect(note()).toHaveTextContent('Hoàn tất · kết quả mới đã hiển thị trên bản đồ.');
    expect(sim.posts).toHaveLength(1);
    expect(sim.posts[0].emission_multiplier).toBe(0.6);
  });
});
