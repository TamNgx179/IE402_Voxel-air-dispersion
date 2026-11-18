import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ComparisonQueryDto } from '../modules/results/dto/comparison-query.dto.js';
import { ExceedanceQueryDto } from '../modules/results/dto/exceedance-query.dto.js';
import { ProfileQueryDto } from '../modules/results/dto/profile-query.dto.js';
import { RegionQueryDto } from '../modules/results/dto/region-query.dto.js';
import { RoadCorridorDto } from '../modules/results/dto/road-corridor.dto.js';
import { SliceQueryDto } from '../modules/results/dto/slice-query.dto.js';
import { TransectQueryDto } from '../modules/results/dto/transect-query.dto.js';
import { CreateRunDto } from '../modules/simulation/dto/create-run.dto.js';
import { ListRunsQueryDto } from '../modules/simulation/dto/list-runs-query.dto.js';

// Same options as configureApp() in setup.ts, so the DTOs are checked as the API sees them.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function validate<T>(
  metatype: new () => T,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<T> {
  return pipe.transform(value, { type, metatype }) as Promise<T>;
}

async function messages(
  metatype: new () => unknown,
  value: unknown,
  type: 'body' | 'query' = 'body',
): Promise<string[]> {
  try {
    await validate(metatype, value, type);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      message: string[];
    };
    return body.message;
  }
  throw new Error('expected validation to fail');
}

const UUID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

describe('CreateRunDto', () => {
  it('accepts the minimal body and the optional fields', async () => {
    await expect(
      validate(CreateRunDto, { scenario_id: 'dry_nov_apr' }),
    ).resolves.toMatchObject({ scenario_id: 'dry_nov_apr' });
    await expect(
      validate(CreateRunDto, {
        scenario_id: 'wet_may_oct',
        model: 'gaussian',
        emission_multiplier: 0.6,
        request_id: UUID,
      }),
    ).resolves.toBeInstanceOf(CreateRunDto);
  });

  it.each([
    [
      'unknown property',
      { scenario_id: 'a', solver: 'rans' },
      /should not exist/,
    ],
    ['empty scenario', { scenario_id: '' }, /scenario_id/],
    ['path traversal', { scenario_id: '../etc' }, /may only contain/],
    ['long scenario', { scenario_id: 'a'.repeat(65) }, /shorter than or equal/],
    ['unknown model', { scenario_id: 'a', model: 'cfd' }, /model/],
    [
      'free multiplier',
      { scenario_id: 'a', emission_multiplier: 0.5 },
      /emission_multiplier/,
    ],
    [
      'string multiplier',
      { scenario_id: 'a', emission_multiplier: '1' },
      /emission_multiplier/,
    ],
    [
      'UUID v1',
      { scenario_id: 'a', request_id: 'a8098c1a-f86e-11da-bd1a-00112444be1e' },
      /request_id/,
    ],
    ['null request id', { scenario_id: 'a', request_id: null }, /request_id/],
  ])('rejects %s', async (_name, body, message) => {
    expect((await messages(CreateRunDto, body)).join('\n')).toMatch(message);
  });
});

describe('ListRunsQueryDto', () => {
  it('converts the query limit to a number', async () => {
    const value = await validate(
      ListRunsQueryDto,
      { status: 'succeeded', limit: '25' },
      'query',
    );
    expect(value.limit).toBe(25);
  });

  it.each([
    [{ limit: '0' }],
    [{ limit: '101' }],
    [{ limit: '2.5' }],
    [{ status: 'cancelled' }],
    [{ scenario_id: 'dry nov' }],
  ])('rejects %o', async (query) => {
    await expect(validate(ListRunsQueryDto, query, 'query')).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('result query DTOs', () => {
  it('converts numeric query strings', async () => {
    await expect(
      validate(ProfileQueryDto, { i: '12', j: '0' }, 'query'),
    ).resolves.toMatchObject({ i: 12, j: 0 });
    await expect(
      validate(
        SliceQueryDto,
        { z_m: '1.5', bbox: '106.70, 10.77,106.71,10.78' },
        'query',
      ),
    ).resolves.toMatchObject({ z_m: 1.5 });
    await expect(
      validate(ComparisonQueryDto, { compare_run_id: UUID, z_m: '3' }, 'query'),
    ).resolves.toMatchObject({ z_m: 3 });
  });

  it.each([
    [ProfileQueryDto, { i: '-1', j: '0' }],
    [ProfileQueryDto, { i: '1.5', j: '0' }],
    [ProfileQueryDto, { i: '1' }],
    [SliceQueryDto, { z_m: '-0.5' }],
    [SliceQueryDto, { bbox: '106.7,10.77,106.71' }],
    [SliceQueryDto, { bbox: '1,2,3,4;DROP' }],
    [ExceedanceQueryDto, { threshold_key: "qcvn'24h" }],
    [ExceedanceQueryDto, { threshold: '-1' }],
    [ComparisonQueryDto, { compare_run_id: 'not-a-uuid' }],
  ])('rejects %o with %o', async (metatype, query) => {
    await expect(
      validate(metatype as new () => unknown, query, 'query'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('analysis body DTOs', () => {
  const polygon = { type: 'Polygon', coordinates: [] };
  const line = { type: 'LineString', coordinates: [] };

  it('accepts region and transect bodies and leaves GeoJSON to the service', async () => {
    await expect(
      validate(RegionQueryDto, { polygon, z_min_m: 0, z_max_m: 15 }),
    ).resolves.toBeInstanceOf(RegionQueryDto);
    await expect(
      validate(TransectQueryDto, { line, z_min_m: 0, z_max_m: 30, step_m: 2 }),
    ).resolves.toMatchObject({ step_m: 2 });
  });

  it.each([
    [RegionQueryDto, { polygon: 'POLYGON((0 0))', z_min_m: 0, z_max_m: 1 }],
    [RegionQueryDto, { polygon, z_min_m: -1, z_max_m: 1 }],
    [RegionQueryDto, { polygon, z_min_m: 0, z_max_m: 1, threshold_ug_m3: -5 }],
    [TransectQueryDto, { line, z_min_m: 0 }],
    [TransectQueryDto, { line, z_min_m: 0, z_max_m: 1, step_m: 'fine' }],
    [TransectQueryDto, { line, z_min_m: 0, z_max_m: 1, extra: true }],
  ])('rejects %o with %o', async (metatype, body) => {
    await expect(validate(metatype as new () => unknown, body)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepts a road corridor body within its limits', async () => {
    await expect(
      validate(RoadCorridorDto, {
        road_ids: ['way/1'],
        distances_m: [10, 25, 50],
        z_min_m: 1,
        z_max_m: 15,
      }),
    ).resolves.toBeInstanceOf(RoadCorridorDto);
  });

  const corridor = {
    road_ids: ['way/1'],
    distances_m: [10],
    z_min_m: 1,
    z_max_m: 15,
  };
  it.each([
    ['no roads', { road_ids: [] }],
    ['duplicate roads', { road_ids: ['way/1', 'way/1'] }],
    [
      '51 roads',
      { road_ids: Array.from({ length: 51 }, (_, n) => `way/${n}`) },
    ],
    ['a long road ID', { road_ids: ['w'.repeat(129)] }],
    ['six distances', { distances_m: [1, 2, 3, 4, 5, 6] }],
    ['a zero distance', { distances_m: [0] }],
    ['a distance above 100 m', { distances_m: [101] }],
    ['a string height', { z_min_m: '1' }],
    ['a null threshold', { threshold_ug_m3: null }],
  ])('rejects a corridor with %s', async (_name, overrides) => {
    await expect(
      validate(RoadCorridorDto, { ...corridor, ...overrides }),
    ).rejects.toThrow(BadRequestException);
  });
});
