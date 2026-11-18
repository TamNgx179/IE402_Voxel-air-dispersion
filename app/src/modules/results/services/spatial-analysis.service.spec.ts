import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RegionQueryDto } from '../dto/region-query.dto.js';
import type { RoadCorridorDto } from '../dto/road-corridor.dto.js';
import {
  SpatialAnalysisService,
  validatePolygonShape,
} from './spatial-analysis.service.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

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

function runContext(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: 'succeeded',
    model: 'fv',
    model_version: `v-${id.slice(-1)}`,
    input_hash: `sha256:${id.slice(-1)}`,
    warnings: [],
    scenario_id: 'dry_nov_apr',
    grid,
    study_area_id: 'nguyen_hue',
    projected_srid: 32648,
    scene_version: 'scene-v1',
    emission_multiplier: 1,
    ...overrides,
  };
}

const square = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [106.7, 10.77],
      [106.701, 10.77],
      [106.701, 10.771],
      [106.7, 10.771],
      [106.7, 10.77],
    ],
  ],
};

function setup(
  contexts: Record<string, ReturnType<typeof runContext> | null> = {
    [A]: runContext(A),
    [B]: runContext(B),
  },
) {
  const results = {
    runContext: vi.fn(async (id: string) => contexts[id] ?? null),
  };
  const spatial = {
    validatePolygon: vi.fn(async () => ({
      valid: true,
      covered: true,
      area_m2: 12_000,
    })),
    region: vi.fn(async () => [
      {
        k: '0',
        air_voxels: '10',
        air_volume_m3: '400',
        mean_ug_m3: '10',
        max_ug_m3: '30',
        exceedance_volume_m3: '100',
      },
      {
        k: '1',
        air_voxels: '5',
        air_volume_m3: '100',
        mean_ug_m3: '20',
        max_ug_m3: '25',
        exceedance_volume_m3: '50',
      },
    ]),
    matchingMasks: vi.fn(async () => true),
    comparison: vi.fn(async () => [
      { i: 0, j: 0, baseline: 1, comparison: 3, delta: 2, geometry: {} },
      { i: 1, j: 0, baseline: 5, comparison: 4, delta: -1, geometry: {} },
    ]),
    roadCorridor: vi.fn(async () => [
      {
        inner_m: 0,
        outer_m: 10,
        area_m2: 2_000,
        geometry: { type: 'Polygon', coordinates: [] },
        air_volume_m3: 20_000,
        valid_volume_m3: 19_000,
        coverage: 0.95,
        mean_ug_m3: 0.22,
        exceedance_volume_m3: 0,
      },
    ]),
  };
  return {
    service: new SpatialAnalysisService(results as never, spatial as never),
    results,
    spatial,
  };
}

const region = (overrides: Partial<RegionQueryDto> = {}) =>
  ({ polygon: square, z_min_m: 0, z_max_m: 4, ...overrides }) as RegionQueryDto;

describe('SpatialAnalysisService.region', () => {
  it('weights the mean by valid air volume and sums volumes across layers', async () => {
    const { service, spatial } = setup();
    const value = await service.region(A, region({ threshold_ug_m3: 12 }));
    expect(spatial.region).toHaveBeenCalledWith(
      A,
      'nguyen_hue',
      JSON.stringify(square),
      0,
      4,
      2,
      12,
    );
    expect(value).toMatchObject({
      area_m2: 12_000,
      air_volume_m3: 500,
      air_voxels: 15,
      // (10 × 400 + 20 × 100) / 500, not the unweighted 15.
      mean_ug_m3: 12,
      max_ug_m3: 30,
      exceedance_volume_m3: 150,
      threshold_ug_m3: 12,
    });
    expect(value.layers.map((l) => [l.k, l.z_center_m])).toEqual([
      [0, 1],
      [1, 3],
    ]);
  });

  it('defaults the exceedance threshold to 15 µg/m³', async () => {
    const { service, spatial } = setup();
    expect((await service.region(A, region())).threshold_ug_m3).toBe(15);
    expect(spatial.region.mock.calls[0].at(-1)).toBe(15);
  });

  it('reports null statistics, not zero, when the polygon holds no valid air', async () => {
    const { service, spatial } = setup();
    spatial.region.mockResolvedValueOnce([]);
    const value = await service.region(A, region());
    expect(value).toMatchObject({
      air_volume_m3: 0,
      mean_ug_m3: null,
      max_ug_m3: null,
    });
  });

  it('keeps max null when every overlapped layer is solid or missing', async () => {
    const { service, spatial } = setup();
    spatial.region.mockResolvedValueOnce([
      {
        k: '0',
        air_voxels: '0',
        air_volume_m3: '0',
        mean_ug_m3: null,
        max_ug_m3: null,
        exceedance_volume_m3: '0',
      },
    ] as never);
    const value = await service.region(A, region());
    expect(value.mean_ug_m3).toBeNull();
    expect(value.max_ug_m3).toBeNull();
  });

  it.each([
    [{ valid: false, covered: true, area_m2: 10 }, /self intersections/],
    [{ valid: true, covered: true, area_m2: 0 }, /positive area/],
    [{ valid: true, covered: false, area_m2: 10 }, /inside the study area/],
  ])('rejects polygons that PostGIS marks invalid (%o)', async (check, msg) => {
    const { service, spatial } = setup();
    spatial.validatePolygon.mockResolvedValueOnce(check);
    await expect(service.region(A, region())).rejects.toThrow(msg);
    expect(spatial.region).not.toHaveBeenCalled();
  });

  it.each([
    [0, 0],
    [-1, 2],
    [0, 10.1],
    [Number.NaN, 2],
  ])('rejects height interval [%s, %s)', async (min, max) => {
    const { service } = setup();
    await expect(
      service.region(A, region({ z_min_m: min, z_max_m: max })),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns 404 and 409 for missing and unfinished runs', async () => {
    await expect(setup({}).service.region(A, region())).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      setup({ [A]: runContext(A, { status: 'failed' }) }).service.region(
        A,
        region(),
      ),
    ).rejects.toThrow(/failed; analysis requires succeeded/);
  });

  it('exports one CSV row per layer and a placeholder row when empty', async () => {
    const { service, spatial } = setup();
    const full = (await service.csv(A, region())).split('\r\n');
    expect(full).toHaveLength(4); // header, two layers, trailing ''
    expect(full[0]).toContain('"exceedance_volume_m3"');
    spatial.region.mockResolvedValueOnce([]);
    const empty = (await service.csv(A, region())).split('\r\n');
    expect(empty).toHaveLength(3);
    expect(empty[1].endsWith(',"0","0",,,"0"')).toBe(true);
  });
});

describe('validatePolygonShape', () => {
  const ring = square.coordinates[0];
  it('accepts a closed ring and returns the same object', () => {
    expect(validatePolygonShape(square)).toBe(square);
  });

  it.each([
    ['not a polygon', { type: 'MultiPolygon', coordinates: [[ring]] }],
    ['no rings', { type: 'Polygon', coordinates: [] }],
    ['an extra member', { type: 'Polygon', coordinates: [ring], bbox: [] }],
    ['an open ring', { type: 'Polygon', coordinates: [ring.slice(0, 4)] }],
    ['a short ring', { type: 'Polygon', coordinates: [ring.slice(0, 3)] }],
    [
      'a 3D position',
      {
        type: 'Polygon',
        coordinates: [[...ring.slice(0, 4), [106.7, 10.77, 0]]],
      },
    ],
    [
      'longitude out of range',
      {
        type: 'Polygon',
        coordinates: [
          [
            [181, 0],
            [0, 1],
            [1, 1],
            [181, 0],
          ],
        ],
      },
    ],
    [
      'more than 20 rings',
      { type: 'Polygon', coordinates: Array.from({ length: 21 }, () => ring) },
    ],
    [
      'more than 500 vertices',
      {
        type: 'Polygon',
        coordinates: [
          [
            ...Array.from({ length: 500 }, (_, n) => [106.7 + n * 1e-6, 10.77]),
            [106.7, 10.77],
          ],
        ],
      },
    ],
  ])('rejects %s', (_name, raw) => {
    expect(() => validatePolygonShape(raw as never)).toThrow(
      BadRequestException,
    );
  });
});

describe('SpatialAnalysisService.comparison', () => {
  it('compares the same layer of two runs and reports comparison − baseline', async () => {
    const { service, spatial } = setup();
    const value = await service.comparison(A, { compare_run_id: B, z_m: 3 });
    expect(spatial.matchingMasks).toHaveBeenCalledWith(A, B, 4, 4, 5);
    // z = 3 m lies in layer k = 1, i.e. PostgreSQL array index 2.
    expect(spatial.comparison).toHaveBeenCalledWith(A, B, 'nguyen_hue', 2);
    expect(value).toMatchObject({
      k: 1,
      z_center_m: 3,
      delta_definition: 'comparison - baseline',
      baseline_version: 'v-a',
      comparison_version: 'v-b',
      stats: {
        air_cells: 2,
        baseline: { mean_ug_m3: 3, min_ug_m3: 1, max_ug_m3: 5 },
        delta: { mean_ug_m3: 0.5, min_ug_m3: -1, max_ug_m3: 2 },
      },
    });
    expect(value.feature_collection.features[1].properties).toEqual({
      i: 1,
      j: 0,
      baseline_ug_m3: 5,
      comparison_ug_m3: 4,
      delta_ug_m3: -1,
    });
  });

  it('defaults to the 1.5 m breathing layer', async () => {
    const { service } = setup();
    const value = await service.comparison(A, { compare_run_id: B });
    expect(value).toMatchObject({ requested_z_m: 1.5, k: 0 });
  });

  it.each([
    ['study area', { study_area_id: 'other' }],
    ['CRS', { projected_srid: 4326 }],
    ['scene', { scene_version: 'scene-v2' }],
    ['model', { model: 'gaussian' }],
    ['grid', { grid: { ...grid, dz_m: 4 } }],
  ])('refuses runs with a different %s', async (_name, overrides) => {
    const { service, spatial } = setup({
      [A]: runContext(A),
      [B]: runContext(B, overrides),
    });
    await expect(service.comparison(A, { compare_run_id: B })).rejects.toThrow(
      ConflictException,
    );
    expect(spatial.matchingMasks).not.toHaveBeenCalled();
  });

  it('refuses different solid masks and heights outside the grid', async () => {
    const { service, spatial } = setup();
    spatial.matchingMasks.mockResolvedValueOnce(false);
    await expect(service.comparison(A, { compare_run_id: B })).rejects.toThrow(
      /different solid masks/,
    );
    await expect(
      service.comparison(A, { compare_run_id: B, z_m: 10 }),
    ).rejects.toThrow(/outside grid/);
  });

  it('carries the emission multipliers of both runs', async () => {
    const { service } = setup({
      [A]: runContext(A, { emission_multiplier: null }),
      [B]: runContext(B, { emission_multiplier: '0.5' }),
    });
    const value = await service.comparison(A, { compare_run_id: B });
    expect(value.baseline_emission_multiplier).toBe(1);
    expect(value.comparison_emission_multiplier).toBe(0.5);
  });
});

describe('SpatialAnalysisService.roadCorridor', () => {
  const corridor = (overrides: Partial<RoadCorridorDto> = {}) =>
    ({
      road_ids: ['way/1', 'way/2'],
      distances_m: [10, 25, 50],
      z_min_m: 1,
      z_max_m: 9,
      ...overrides,
    }) as RoadCorridorDto;

  it('forwards the run scene and returns provenance with each band', async () => {
    const { service, spatial } = setup();
    const value = await service.roadCorridor(A, corridor());
    expect(spatial.roadCorridor).toHaveBeenCalledWith(
      A,
      'nguyen_hue',
      ['way/1', 'way/2'],
      [10, 25, 50],
      1,
      9,
      2,
      15,
    );
    expect(value).toMatchObject({
      run_id: A,
      scene_version: 'scene-v1',
      input_hash: 'sha256:a',
      bands: [{ inner_m: 0, outer_m: 10, coverage: 0.95 }],
    });
  });

  it.each([
    ['repeated distance', { distances_m: [10, 10] }, /strictly increasing/],
    ['decreasing distance', { distances_m: [25, 10] }, /strictly increasing/],
    ['empty interval', { z_min_m: 4, z_max_m: 4 }, /domain height/],
    ['above the domain', { z_max_m: 12 }, /domain height/],
  ])('rejects a %s', async (_name, overrides, msg) => {
    const { service, spatial } = setup();
    await expect(service.roadCorridor(A, corridor(overrides))).rejects.toThrow(
      msg,
    );
    expect(spatial.roadCorridor).not.toHaveBeenCalled();
  });

  it('rejects road IDs that are absent from the scene', async () => {
    const { service, spatial } = setup();
    spatial.roadCorridor.mockResolvedValueOnce([]);
    await expect(service.roadCorridor(A, corridor())).rejects.toThrow(
      /absent from the run scene/,
    );
  });

  it('flattens bands into CSV without geometry and with JSON road IDs', async () => {
    const { service } = setup();
    const [header, row] = (await service.roadCorridorCsv(A, corridor())).split(
      '\r\n',
    );
    expect(header).not.toContain('geometry');
    expect(header).toContain('"inner_m","outer_m"');
    expect(row).toContain('"[""way/1"",""way/2""]"');
  });
});
