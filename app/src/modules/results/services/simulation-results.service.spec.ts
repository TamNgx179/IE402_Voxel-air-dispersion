import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SimulationResultsService } from './simulation-results.service.js';

const context = {
  id: '00000000-0000-4000-8000-000000000001',
  status: 'succeeded',
  model: 'fv',
  model_version: 'test',
  input_hash: 'sha256:test',
  warnings: [],
  scenario_id: 'dry_nov_apr',
  grid: {
    origin_x_m: 0,
    origin_y_m: 0,
    dx_m: 5,
    dy_m: 5,
    dz_m: 2,
    nx: 2,
    ny: 2,
    nz: 4,
  },
};

function service(status = 'succeeded') {
  const cells = [
    {
      i: 0,
      j: 0,
      concentration: 10,
      geometry: { type: 'Polygon', coordinates: [] },
    },
    {
      i: 1,
      j: 0,
      concentration: 20,
      geometry: { type: 'Polygon', coordinates: [] },
    },
  ];
  const repository = {
    runContext: vi.fn(async () => ({ ...context, status })),
    concentrationSlice: vi.fn(async () => cells),
    verticalProfile: vi.fn(async () => ({
      c_ug_m3: [20, 10, 5, 2],
      centre: { type: 'Point', coordinates: [1, 2] },
    })),
    columns: vi.fn(async () => [
      { i: 0, j: 0, c_ug_m3: [null, 10, 5, 1] },
      { i: 1, j: 0, c_ug_m3: [20, 10, 5, 2] },
    ]),
  };
  const config = { get: () => 'C:/tmp/artifacts' };
  return {
    results: new SimulationResultsService(repository as never, config as never),
    repository,
  };
}

describe('SimulationResultsService', () => {
  it('maps a z request to the nearest layer and returns GeoJSON statistics', async () => {
    const { results } = service();
    const value = await results.slice(context.id, { z_m: 1.5 });
    expect(value).toMatchObject({
      k: 0,
      z_m: 1,
      stats: { air_cells: 2, mean_ug_m3: 15, max_ug_m3: 20 },
    });
    expect(value.feature_collection.features).toHaveLength(2);
  });

  it('returns an exact vertical profile by grid index', async () => {
    const { results } = service();
    const value = await results.profile(context.id, { i: 1, j: 0 });
    expect(value.levels.map((level) => level.z_m)).toEqual([1, 3, 5, 7]);
    expect(value.levels.map((level) => level.concentration_ug_m3)).toEqual([
      20, 10, 5, 2,
    ]);
  });

  it('encodes one byte per voxel for the web volume payload', async () => {
    const { results } = service();
    const value = await results.volume(context.id);
    expect(value.shape).toEqual([4, 2, 2]);
    expect(Buffer.from(value.codes_base64, 'base64')).toHaveLength(16);
  });

  it('rejects result queries until the run succeeds', async () => {
    const { results } = service('running');
    await expect(results.slice(context.id, {})).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
