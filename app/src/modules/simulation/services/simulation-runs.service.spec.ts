import { resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { projectConfigPath } from '../../../common/project-config.js';
import { APP_ROOT } from '../../../config/env.validation.js';
import { SimulationRunsService } from './simulation-runs.service.js';

const RUN = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const accepted = {
  run_id: RUN,
  status: 'queued',
  status_url: `/api/runs/${RUN}`,
};

function setup() {
  const runs = {
    scenarioExists: vi.fn(async () => true),
    create: vi.fn(
      async (..._args: [string, string, string, unknown, number]) =>
        accepted as never,
    ),
    list: vi.fn(async () => [] as never[]),
    findDetail: vi.fn(async () => null as never),
    verificationChecks: vi.fn(async () => [] as never[]),
    retry: vi.fn(async () => ({ kind: 'retried', run: accepted }) as never),
  };
  const config = {
    get: () => projectConfigPath(resolve(APP_ROOT, '..')),
  };
  return {
    service: new SimulationRunsService(runs as never, config as never),
    runs,
  };
}

const detail = {
  id: RUN,
  status: 'succeeded',
  progress: '1',
  attempt: '2',
  model: 'fv',
  emission_multiplier: '0.8',
  scenario_id: 'dry_nov_apr',
  scenario_name: 'Dry season',
  wind_from_deg: '112',
  wind_speed_m_s: '1.62',
  error_kind: null,
  error_message: null,
  model_version: '0.1.0',
  input_hash: 'sha256:x',
  warnings: null,
  created_at: new Date('2026-11-15T01:02:03Z'),
  started_at: '2026-11-15T01:02:04.000Z',
  finished_at: null,
  metrics: null,
};

describe('SimulationRunsService.create', () => {
  it('stores a config snapshot carrying the run block and defaults', async () => {
    const { service, runs } = setup();
    await expect(service.create({ scenario_id: 'dry_nov_apr' })).resolves.toBe(
      accepted,
    );

    const [runId, scenario, model, snapshot, multiplier] = runs.create.mock
      .calls[0] as unknown as [
      string,
      string,
      string,
      Record<string, unknown>,
      number,
    ];
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect([scenario, model, multiplier]).toEqual(['dry_nov_apr', 'fv', 1]);
    expect(snapshot.run).toEqual({
      run_id: runId,
      scenario_id: 'dry_nov_apr',
      model: 'fv',
      emission_multiplier: 1,
    });
    // The whole project config is frozen with the run, not just the run block.
    expect(snapshot).toHaveProperty('meteorology');
  });

  it('reuses a client request_id in canonical lower case', async () => {
    const { service, runs } = setup();
    await service.create({
      scenario_id: 'dry_nov_apr',
      request_id: RUN.toUpperCase(),
      emission_multiplier: 0.6,
    });
    expect(runs.create.mock.calls[0][0]).toBe(RUN);
    expect(runs.create.mock.calls[0][4]).toBe(0.6);
  });

  it('rejects an unknown scenario before reading the project config', async () => {
    const { service, runs } = setup();
    runs.scenarioExists.mockResolvedValueOnce(false);
    await expect(service.create({ scenario_id: 'monsoon' })).rejects.toThrow(
      NotFoundException,
    );
    expect(runs.create).not.toHaveBeenCalled();
  });

  it('allows source reduction for FV only', async () => {
    const { service, runs } = setup();
    await expect(
      service.create({
        scenario_id: 'dry_nov_apr',
        model: 'gaussian',
        emission_multiplier: 0.8,
      }),
    ).rejects.toThrow(BadRequestException);
    await service.create({ scenario_id: 'dry_nov_apr', model: 'gaussian' });
    expect(runs.create.mock.calls[0][2]).toBe('gaussian');
  });

  it('returns 409 when the request_id belongs to a different request', async () => {
    const { service, runs } = setup();
    runs.create.mockResolvedValueOnce(null as never);
    await expect(
      service.create({ scenario_id: 'dry_nov_apr', request_id: RUN }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('SimulationRunsService.list and get', () => {
  it('converts PostgreSQL numerics and timestamps in the run list', async () => {
    const { service, runs } = setup();
    runs.list.mockResolvedValueOnce([
      { ...detail, emission_multiplier: null },
    ] as never);
    const [row] = await service.list({ limit: 5 });
    expect(runs.list).toHaveBeenCalledWith({ limit: 5 });
    expect(row).toMatchObject({
      progress: 1,
      attempt: 2,
      wind_from_deg: 112,
      wind_speed_m_s: 1.62,
      emission_multiplier: 1,
      created_at: '2026-11-15T01:02:03.000Z',
      finished_at: null,
    });
  });

  it('returns a run view without verification before checks exist', async () => {
    const { service, runs } = setup();
    runs.findDetail.mockResolvedValueOnce(detail as never);
    const view = await service.get(RUN);
    expect(view).toMatchObject({
      run_id: RUN,
      emission_multiplier: 0.8,
      scenario: { id: 'dry_nov_apr', wind_from_deg: 112 },
      error: null,
      warnings: [],
      started_at: '2026-11-15T01:02:04.000Z',
      verification: null,
    });
  });

  it('fails the verification summary when any check fails', async () => {
    const { service, runs } = setup();
    runs.findDetail.mockResolvedValueOnce({
      ...detail,
      status: 'failed',
      error_kind: 'verification',
      error_message: 'mass balance',
    } as never);
    runs.verificationChecks.mockResolvedValueOnce([
      { name: 'cfl', status: 'pass', value: '0.4', tolerance: '1' },
      { name: 'mass', status: 'fail', value: '0.02', tolerance: null },
    ] as never);
    const view = await service.get(RUN);
    expect(view.error).toEqual({
      kind: 'verification',
      message: 'mass balance',
    });
    expect(view.verification).toEqual({
      status: 'fail',
      checks: [
        { name: 'cfl', status: 'pass', value: 0.4, tolerance: 1 },
        { name: 'mass', status: 'fail', value: 0.02, tolerance: null },
      ],
    });
  });

  it('returns 404 for an unknown run', async () => {
    await expect(setup().service.get(RUN)).rejects.toThrow(NotFoundException);
  });
});

describe('SimulationRunsService.retry', () => {
  it('returns the re-queued run', async () => {
    await expect(setup().service.retry(RUN)).resolves.toBe(accepted);
  });

  it('maps missing and non-retryable runs to 404 and 409', async () => {
    const { service, runs } = setup();
    runs.retry.mockResolvedValueOnce({ kind: 'not_found' } as never);
    await expect(service.retry(RUN)).rejects.toThrow(NotFoundException);
    runs.retry.mockResolvedValueOnce({
      kind: 'not_retryable',
      status: 'running',
    } as never);
    await expect(service.retry(RUN)).rejects.toThrow(
      /running; only failed or stale/,
    );
  });
});
