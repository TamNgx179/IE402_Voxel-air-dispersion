import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TransectQueryDto } from '../dto/transect-query.dto.js';
import { TransectService } from './transect.service.js';

const RUN = '00000000-0000-4000-8000-000000000001';

// 4 × 4 × 5 grid of 5 × 5 × 2 m voxels whose origin is the projected (0, 0).
const grid = {
  origin_x_m: 0,
  origin_y_m: 0,
  dx_m: 5,
  dy_m: 5,
  dz_m: 2,
  nx: 4,
  ny: 4,
  nz: 5,
};

const context = {
  id: RUN,
  status: 'succeeded',
  model: 'fv',
  model_version: '0.1.0+test',
  input_hash: 'sha256:input',
  warnings: [],
  scenario_id: 'dry_nov_apr',
  grid,
  study_area_id: 'nguyen_hue',
  projected_srid: 32648,
  scene_version: 'scene-v1',
  emission_multiplier: 1,
};

type Sample = { x_m: number; y_m: number; i: number; j: number };
type ColumnOverride = Partial<{
  ordinal: number;
  grid_present: boolean;
  solid_from_k: number | null;
  solid_to_k: number | null;
  concentrations: (number | null)[] | null;
}>;

function setup(
  options: {
    status?: string;
    projected?: { covered: boolean; coordinates: number[][] | null } | null;
    column?: (sample: Sample, n: number) => ColumnOverride;
    context?: null;
  } = {},
) {
  const results = {
    runContext: vi.fn(async () =>
      options.context === null
        ? null
        : { ...context, status: options.status ?? 'succeeded' },
    ),
  };
  const model = {
    projectLine: vi.fn(async () =>
      options.projected === undefined
        ? {
            covered: true,
            coordinates: [
              [1, 1],
              [11, 1],
            ],
          }
        : options.projected,
    ),
    columns: vi.fn(
      async (
        _run: string,
        _area: string,
        _srid: number,
        _grid: unknown,
        samples: Sample[],
        first: number,
        last: number,
      ) =>
        samples.map((sample, n) => ({
          ordinal: n + 1,
          grid_present: true,
          sample_coordinates: [106.7 + sample.x_m * 1e-5, 10.77],
          cell_center_coordinates: [106.7 + sample.i * 1e-5, 10.77],
          solid_from_k: null,
          solid_to_k: null,
          concentrations: Array.from(
            { length: last - first + 1 },
            (_, k) => 10 * (n + 1) + k,
          ),
          ...options.column?.(sample, n),
        })),
    ),
  };
  return {
    service: new TransectService(results as never, model as never),
    results,
    model,
  };
}

const line = {
  type: 'LineString' as const,
  coordinates: [
    [106.7, 10.77],
    [106.7001, 10.77],
  ],
};

function query(overrides: Partial<TransectQueryDto> = {}): TransectQueryDto {
  return { line, z_min_m: 0, z_max_m: 3, ...overrides } as TransectQueryDto;
}

describe('TransectService.query', () => {
  it('samples a projected line at the grid spacing and keeps both endpoints', async () => {
    const { service, model } = setup();
    const value = await service.query(RUN, query());

    expect(value.length_m).toBe(10);
    expect(value.requested_step_m).toBe(5);
    expect(value.actual_step_m).toBe(5);
    expect(value.samples.map((s) => s.distance_m)).toEqual([0, 5, 10]);
    expect(value.samples.map((s) => [s.x_m, s.i, s.j])).toEqual([
      [1, 0, 0],
      [6, 1, 0],
      [11, 2, 0],
    ]);
    // The projection uses the study area of the run, never a client-supplied CRS.
    expect(model.projectLine).toHaveBeenCalledWith(
      JSON.stringify(line),
      'nguyen_hue',
      32648,
    );
    expect(value).toMatchObject({
      run_id: RUN,
      projected_srid: 32648,
      scene_version: 'scene-v1',
      units: 'ug m-3',
      sampling: 'containing voxel; no interpolation',
    });
  });

  it('keeps partially overlapped layers and reports the selected overlap', async () => {
    const { service, model } = setup();
    const value = await service.query(RUN, query({ z_min_m: 1, z_max_m: 3 }));

    expect(value.layers).toEqual([
      { k: 0, z_center_m: 1, overlap_min_m: 1, overlap_max_m: 2 },
      { k: 1, z_center_m: 3, overlap_min_m: 2, overlap_max_m: 3 },
    ]);
    expect(model.columns.mock.calls[0].slice(5)).toEqual([0, 1]);
    expect(value.samples[0].cells).toEqual([
      { k: 0, concentration_ug_m3: 10, status: 'air' },
      { k: 1, concentration_ug_m3: 11, status: 'air' },
    ]);
  });

  it('shortens the actual step so that intervals divide the line evenly', async () => {
    const { service } = setup({
      projected: {
        covered: true,
        coordinates: [
          [1, 1],
          [8, 1],
        ],
      },
    });
    const value = await service.query(RUN, query({ step_m: 3 }));
    // 7 m / 3 m → 3 intervals of 7/3 m.
    expect(value.samples).toHaveLength(4);
    expect(value.actual_step_m).toBeCloseTo(7 / 3, 12);
    expect(value.samples.at(-1)!.distance_m).toBe(7);
  });

  it('walks a bent line segment by segment using metric chainage', async () => {
    const { service } = setup({
      projected: {
        covered: true,
        coordinates: [
          [1, 1],
          [6, 1],
          [6, 6],
        ],
      },
    });
    const value = await service.query(RUN, query());
    expect(value.length_m).toBe(10);
    expect(value.samples.map((s) => [s.x_m, s.y_m])).toEqual([
      [1, 1],
      [6, 1],
      [6, 6],
    ]);
    expect(value.samples.map((s) => [s.i, s.j])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });

  it('assigns an interior voxel boundary to the east/north cell after snapping round-trip error', async () => {
    const { service } = setup({
      projected: {
        covered: true,
        coordinates: [
          [5 - 5e-8, 1],
          [10 - 5e-8, 1],
        ],
      },
    });
    const value = await service.query(RUN, query());
    expect(value.samples[0].i).toBe(1);
    expect(value.samples.at(-1)!.i).toBe(2);
  });

  it('distinguishes solid cells from missing data and never treats zero as missing', async () => {
    const { service } = setup({
      column: (_sample, n) =>
        n === 0
          ? { solid_from_k: 0, solid_to_k: 0, concentrations: [null, 0] }
          : n === 1
            ? { concentrations: [null, Number.NaN] }
            : {},
    });
    const value = await service.query(RUN, query());
    expect(value.samples[0].cells).toEqual([
      { k: 0, concentration_ug_m3: null, status: 'solid' },
      { k: 1, concentration_ug_m3: 0, status: 'air' },
    ]);
    expect(value.samples[1].cells.map((c) => c.status)).toEqual([
      'no_data',
      'no_data',
    ]);
  });

  it('rejects a concentration stored inside a solid voxel as a scene mismatch', async () => {
    const { service } = setup({
      column: () => ({
        solid_from_k: 0,
        solid_to_k: 1,
        concentrations: [1, null],
      }),
    });
    await expect(service.query(RUN, query())).rejects.toThrow(
      ConflictException,
    );
  });

  it.each([
    ['a missing column', () => ({ grid_present: false })],
    [
      'an ordinal out of order',
      (_s: Sample, n: number) => ({ ordinal: n + 2 }),
    ],
  ])('rejects incomplete database rows (%s)', async (_name, column) => {
    const { service } = setup({ column });
    await expect(service.query(RUN, query())).rejects.toThrow(
      ConflictException,
    );
  });

  it('returns 404 for an unknown run and 409 before the run has succeeded', async () => {
    await expect(
      setup({ context: null }).service.query(RUN, query()),
    ).rejects.toThrow(NotFoundException);
    const { service, model } = setup({ status: 'running' });
    await expect(service.query(RUN, query())).rejects.toThrow(
      ConflictException,
    );
    expect(model.projectLine).not.toHaveBeenCalled();
  });

  it.each([
    ['min equals max', { z_min_m: 2, z_max_m: 2 }],
    ['negative min', { z_min_m: -1, z_max_m: 2 }],
    ['max above the domain top', { z_min_m: 0, z_max_m: 10.5 }],
    ['non-finite bound', { z_min_m: 0, z_max_m: Number.NaN }],
    ['zero step', { step_m: 0 }],
    ['step coarser than the grid', { step_m: 5.5 }],
  ])('rejects an invalid height or step (%s)', async (_name, overrides) => {
    const { service, model } = setup();
    await expect(service.query(RUN, query(overrides))).rejects.toThrow(
      BadRequestException,
    );
    expect(model.columns).not.toHaveBeenCalled();
  });

  it.each([
    ['one vertex', { type: 'LineString', coordinates: [[106.7, 10.77]] }],
    [
      'a polygon',
      {
        type: 'Polygon',
        coordinates: [
          [106.7, 10.77],
          [106.71, 10.77],
        ],
      },
    ],
    [
      'an extra member',
      {
        type: 'LineString',
        coordinates: line.coordinates,
        crs: 'EPSG:32648',
      },
    ],
    [
      'latitude out of range',
      {
        type: 'LineString',
        coordinates: [
          [106.7, 91],
          [106.7, 10],
        ],
      },
    ],
    [
      'a string coordinate',
      {
        type: 'LineString',
        coordinates: [
          ['106.7', 10.77],
          [106.7, 10.78],
        ],
      },
    ],
    [
      'too many vertices',
      {
        type: 'LineString',
        coordinates: Array.from({ length: 101 }, (_, n) => [106.7, n / 1000]),
      },
    ],
  ])('rejects malformed GeoJSON before PostGIS (%s)', async (_name, bad) => {
    const { service, results } = setup();
    await expect(
      service.query(RUN, query({ line: bad as never })),
    ).rejects.toThrow(BadRequestException);
    expect(results.runContext).not.toHaveBeenCalled();
  });

  it('rejects a line outside the study area or on the outer grid edge', async () => {
    await expect(
      setup({ projected: { covered: false, coordinates: null } }).service.query(
        RUN,
        query(),
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      setup({
        projected: {
          covered: true,
          coordinates: [
            [1, 1],
            [20, 1],
          ],
        },
      }).service.query(RUN, query()),
    ).rejects.toThrow(/biên ngoài cùng/);
  });

  it('rejects repeated vertices that make a zero-length segment', async () => {
    const { service } = setup({
      projected: {
        covered: true,
        coordinates: [
          [1, 1],
          [1, 1],
          [6, 1],
        ],
      },
    });
    await expect(service.query(RUN, query())).rejects.toThrow(/chiều dài/);
  });

  it('caps the response by positions × layers, not only by positions', async () => {
    // 15 m line at the smallest step → many positions; every layer multiplies the cost.
    const { service, model } = setup({
      projected: {
        covered: true,
        coordinates: [
          [1, 1],
          [16, 1],
        ],
      },
    });
    await expect(
      service.query(RUN, query({ step_m: 0.003, z_min_m: 0, z_max_m: 10 })),
    ).rejects.toThrow(/20\.000/);
    expect(model.columns).not.toHaveBeenCalled();
  });
});

describe('TransectService.csv', () => {
  it('writes one row per sample and layer with provenance and CRLF endings', async () => {
    const { service } = setup();
    const text = await service.csv(RUN, query());
    const rows = text.split('\r\n');
    expect(rows.at(-1)).toBe('');
    // header + 3 samples × 2 layers
    expect(rows.length - 1).toBe(1 + 3 * 2);
    expect(rows[0].split(',')[0]).toBe('"run_id"');
    expect(rows[1]).toContain(`"${RUN}"`);
    expect(rows[1]).toContain('"air","10"');
  });

  it('leaves missing values empty and neutralises spreadsheet formulas in text', async () => {
    const { service, results } = setup({
      column: (_s, n) => (n === 0 ? { concentrations: [null, -1] } : {}),
    });
    results.runContext.mockResolvedValueOnce({
      ...context,
      model_version: '=HYPERLINK("x")',
      status: 'succeeded',
    });
    const text = await service.csv(RUN, query());
    const first = text.split('\r\n')[1];
    expect(first).toContain(`"'=HYPERLINK(""x"")"`);
    expect(first.endsWith('"no_data",')).toBe(true);
    // A genuine negative number is written as a number, not escaped as a formula.
    expect(text.split('\r\n')[2]).toContain('"-1"');
  });
});
