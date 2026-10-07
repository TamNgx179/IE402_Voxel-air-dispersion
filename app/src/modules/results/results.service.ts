import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/env.validation.js';
import { DatabaseService } from '../../database/database.service.js';
import type { ExceedanceQueryDto } from './dto/exceedance-query.dto.js';
import type { ProfileQueryDto } from './dto/profile-query.dto.js';
import type { SliceQueryDto } from './dto/slice-query.dto.js';

export interface Grid {
  origin_x_m: number;
  origin_y_m: number;
  dx_m: number;
  dy_m: number;
  dz_m: number;
  nx: number;
  ny: number;
  nz: number;
}

interface RunContext {
  id: string;
  status: string;
  model: string;
  scenario_id: string;
  model_version: string | null;
  input_hash: string | null;
  warnings: string[];
  grid: Grid;
}

interface ColumnRow {
  i: number;
  j: number;
  c_ug_m3: Array<number | null>;
}

export const ARTIFACT_KINDS = [
  'wind',
  'concentration',
  'columns',
  'metrics',
  'log',
  'config',
  'manifest',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

@Injectable()
export class ResultsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async slice(runId: string, query: SliceQueryDto) {
    const context = await this.context(runId);
    const layer = layerFor(context.grid, query.z_m ?? 1.5);
    const bbox = parseBbox(query.bbox);
    const { rows } = await this.db.query<{
      i: number;
      j: number;
      concentration: number;
      geometry: Record<string, unknown>;
    }>(
      `SELECT c.i, c.j, c.c_ug_m3[$2] AS concentration,
              ST_AsGeoJSON(ST_Transform(g.geom, 4326), 7)::json AS geometry
       FROM concentration_columns c
       JOIN scenarios s ON s.id = $7
       JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
       WHERE c.run_id = $1
         AND c.c_ug_m3[$2] IS NOT NULL
         AND ($3::double precision IS NULL OR ST_Intersects(
           g.geom,
           ST_Transform(ST_MakeEnvelope($3, $4, $5, $6, 4326), 32648)
         ))
       ORDER BY c.j, c.i`,
      [
        runId,
        layer.k + 1,
        ...(bbox ?? [null, null, null, null]),
        context.scenario_id,
      ],
    );
    const values = rows.map((row) => Number(row.concentration));
    return {
      run_id: runId,
      model: context.model,
      model_version: context.model_version,
      z_m: layer.z_m,
      k: layer.k,
      units: 'ug m-3',
      feature_collection: {
        type: 'FeatureCollection',
        features: rows.map((row) => ({
          type: 'Feature',
          properties: {
            i: Number(row.i),
            j: Number(row.j),
            concentration_ug_m3: Number(row.concentration),
          },
          geometry: row.geometry,
        })),
      },
      stats: summarize(values),
    };
  }

  async exceedance(runId: string, query: ExceedanceQueryDto) {
    if (query.threshold !== undefined && query.threshold_key !== undefined) {
      throw new BadRequestException('use threshold or threshold_key, not both');
    }
    const context = await this.context(runId);
    const layer = layerFor(context.grid, query.z_m ?? 1.5);
    const threshold = await this.threshold(
      query.threshold,
      query.threshold_key ?? 'qcvn_24h',
    );
    const { rows } = await this.db.query<{
      i: number;
      j: number;
      concentration: number;
      geometry: Record<string, unknown>;
    }>(
      `SELECT c.i, c.j, c.c_ug_m3[$2] AS concentration,
              ST_AsGeoJSON(ST_Transform(g.geom, 4326), 7)::json AS geometry
       FROM concentration_columns c
       JOIN scenarios s ON s.id = $4
       JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
       WHERE c.run_id = $1 AND c.c_ug_m3[$2] > $3
       ORDER BY c.j, c.i`,
      [runId, layer.k + 1, threshold.value_ug_m3, context.scenario_id],
    );
    const cellArea = context.grid.dx_m * context.grid.dy_m;
    return {
      run_id: runId,
      z_m: layer.z_m,
      k: layer.k,
      units: 'ug m-3',
      threshold,
      cell_count: rows.length,
      area_m2: rows.length * cellArea,
      volume_m3: rows.length * cellArea * context.grid.dz_m,
      feature_collection: {
        type: 'FeatureCollection',
        features: rows.map((row) => ({
          type: 'Feature',
          properties: {
            i: Number(row.i),
            j: Number(row.j),
            concentration_ug_m3: Number(row.concentration),
          },
          geometry: row.geometry,
        })),
      },
    };
  }

  async profile(runId: string, query: ProfileQueryDto) {
    const context = await this.context(runId);
    if (query.i >= context.grid.nx || query.j >= context.grid.ny) {
      throw new BadRequestException(
        `grid index outside [0,${context.grid.nx - 1}] × [0,${context.grid.ny - 1}]`,
      );
    }
    const { rows } = await this.db.query<{
      c_ug_m3: Array<number | null>;
      centre: Record<string, unknown>;
    }>(
      `SELECT c.c_ug_m3,
              ST_AsGeoJSON(ST_Transform(ST_Centroid(g.geom), 4326), 7)::json AS centre
       FROM concentration_columns c
       JOIN scenarios s ON s.id = $4
       JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
       WHERE c.run_id = $1 AND c.i = $2 AND c.j = $3`,
      [runId, query.i, query.j, context.scenario_id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(
        `run ${runId} has no column (${query.i}, ${query.j})`,
      );
    }
    return {
      run_id: runId,
      i: query.i,
      j: query.j,
      centre: rows[0].centre,
      units: 'ug m-3',
      levels: rows[0].c_ug_m3.map((value, k) => ({
        k,
        z_m: (k + 0.5) * context.grid.dz_m,
        concentration_ug_m3: value === null ? null : Number(value),
      })),
    };
  }

  async summary(runId: string) {
    const context = await this.context(runId);
    const [layers, thresholds, metrics, checks] = await Promise.all([
      this.db.query<{
        k: number;
        air_cells: number;
        mean_ug_m3: number | null;
        max_ug_m3: number | null;
      }>(
        `SELECT u.ordinality - 1 AS k,
                count(u.value)::int AS air_cells,
                avg(u.value)::double precision AS mean_ug_m3,
                max(u.value)::double precision AS max_ug_m3
         FROM concentration_columns c
         CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY AS u(value, ordinality)
         WHERE c.run_id = $1
         GROUP BY u.ordinality ORDER BY u.ordinality`,
        [runId],
      ),
      this.db.query<{ key: string; value_ug_m3: number; label: string }>(
        'SELECT key, value_ug_m3, label FROM thresholds ORDER BY value_ug_m3 DESC',
      ),
      this.db.query(
        "SELECT to_jsonb(m) - 'run_id' AS value FROM run_metrics m WHERE run_id = $1",
        [runId],
      ),
      this.db.query(
        'SELECT check_name AS name, status, value, tolerance FROM verification_checks WHERE run_id = $1 ORDER BY check_name',
        [runId],
      ),
    ]);
    const cellVolume =
      context.grid.dx_m * context.grid.dy_m * context.grid.dz_m;
    const thresholdRows = await Promise.all(
      thresholds.rows.map(async (threshold) => {
        const count = await this.db.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM concentration_columns c
           CROSS JOIN LATERAL unnest(c.c_ug_m3) AS u(value)
           WHERE c.run_id = $1 AND u.value > $2`,
          [runId, threshold.value_ug_m3],
        );
        return {
          key: threshold.key,
          label: threshold.label,
          value_ug_m3: Number(threshold.value_ug_m3),
          exceedance_volume_m3: Number(count.rows[0].n) * cellVolume,
        };
      }),
    );
    return {
      run_id: runId,
      model: context.model,
      model_version: context.model_version,
      input_hash: context.input_hash,
      warnings: context.warnings,
      units: 'ug m-3',
      grid: context.grid,
      layers: layers.rows.map((row) => ({
        k: Number(row.k),
        z_m: (Number(row.k) + 0.5) * context.grid.dz_m,
        air_cells: Number(row.air_cells),
        mean_ug_m3: nullableNumber(row.mean_ug_m3),
        max_ug_m3: nullableNumber(row.max_ug_m3),
      })),
      thresholds: thresholdRows,
      metrics: metrics.rows[0]?.value ?? null,
      verification: {
        status: checks.rows.every((row) => row.status === 'pass')
          ? 'pass'
          : 'fail',
        checks: checks.rows,
      },
    };
  }

  async volume(runId: string) {
    const context = await this.context(runId);
    const { rows } = await this.db.query<ColumnRow>(
      'SELECT i, j, c_ug_m3 FROM concentration_columns WHERE run_id = $1 ORDER BY j, i',
      [runId],
    );
    if (rows.length === 0)
      throw new NotFoundException(`run ${runId} has no concentration columns`);
    const { nx, ny, nz } = context.grid;
    const values = new Float32Array(nx * ny * nz);
    const valid = new Uint8Array(values.length);
    let max = 0;
    for (const row of rows) {
      row.c_ug_m3.forEach((raw, k) => {
        const n = (k * ny + Number(row.j)) * nx + Number(row.i);
        if (raw === null) return;
        const value = Number(raw);
        valid[n] = 1;
        values[n] = value;
        if (value > max) max = value;
      });
    }
    const decades = 4;
    const firstCode = 2;
    const levels = 253;
    const logMin = max > 0 ? Math.log10(max) - decades : 0;
    const codes = new Uint8Array(values.length);
    for (let n = 0; n < values.length; n += 1) {
      if (!valid[n]) continue;
      const value = values[n];
      if (value <= 0 || max <= 0) codes[n] = 1;
      else {
        const t = Math.max(
          0,
          Math.min(1, (Math.log10(value) - logMin) / decades),
        );
        codes[n] = firstCode + Math.round(t * levels);
      }
    }
    return {
      run_id: runId,
      shape: [nz, ny, nx],
      axis_order: 'z,y,x',
      units: 'ug m-3',
      codes_base64: Buffer.from(codes).toString('base64'),
      scale: { c_max: max, decades, levels, first_code: firstCode },
    };
  }

  async artifacts(runId: string) {
    await this.context(runId);
    const { rows } = await this.db.query(
      `SELECT kind, sha256, size_bytes,
              '/api/runs/' || run_id || '/artifacts/' || kind || '/download' AS download_url
       FROM artifacts WHERE run_id = $1 ORDER BY kind`,
      [runId],
    );
    return { run_id: runId, artifacts: rows };
  }

  async download(runId: string, kind: string) {
    if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
      throw new BadRequestException(`unknown artifact kind ${kind}`);
    }
    await this.context(runId);
    const { rows } = await this.db.query<{ path: string; size_bytes: number }>(
      'SELECT path, size_bytes FROM artifacts WHERE run_id = $1 AND kind = $2',
      [runId, kind],
    );
    if (rows.length === 0)
      throw new NotFoundException(`run ${runId} has no ${kind} artifact`);
    const root = resolve(this.config.get('ARTIFACT_DIR', { infer: true }));
    const path = resolve(root, rows[0].path);
    if (path !== root && !path.startsWith(root + sep)) {
      throw new BadRequestException('artifact path escaped ARTIFACT_DIR');
    }
    return {
      stream: createReadStream(path),
      filename: `${runId}-${kind}${extension(kind)}`,
      size: Number(rows[0].size_bytes),
    };
  }

  private async context(runId: string): Promise<RunContext> {
    const { rows } = await this.db.query<RunContext>(
      `SELECT r.id, r.status, r.model, r.model_version, r.input_hash, r.warnings,
              r.scenario_id, sa.grid
       FROM simulation_runs r
       JOIN scenarios s ON s.id = r.scenario_id
       JOIN study_areas sa ON sa.id = s.study_area_id
       WHERE r.id = $1`,
      [runId],
    );
    if (rows.length === 0)
      throw new NotFoundException(`run ${runId} does not exist`);
    if (rows[0].status !== 'succeeded') {
      throw new ConflictException(
        `run ${runId} is ${rows[0].status}; results require succeeded`,
      );
    }
    return rows[0];
  }

  private async threshold(custom: number | undefined, key: string) {
    if (custom !== undefined)
      return { key: 'custom', label: 'Custom', value_ug_m3: custom };
    const { rows } = await this.db.query<{
      key: string;
      label: string;
      value_ug_m3: number;
    }>('SELECT key, label, value_ug_m3 FROM thresholds WHERE key = $1', [key]);
    if (rows.length === 0)
      throw new BadRequestException(`unknown threshold_key ${key}`);
    return { ...rows[0], value_ug_m3: Number(rows[0].value_ug_m3) };
  }
}

function layerFor(grid: Grid, requested: number) {
  const k = Math.round(requested / grid.dz_m - 0.5);
  if (k < 0 || k >= grid.nz) {
    throw new BadRequestException(
      `z_m must select a layer between ${grid.dz_m / 2} and ${(grid.nz - 0.5) * grid.dz_m}`,
    );
  }
  return { k, z_m: (k + 0.5) * grid.dz_m };
}

function parseBbox(raw?: string): [number, number, number, number] | undefined {
  if (!raw) return undefined;
  const values = raw.split(',').map(Number) as [number, number, number, number];
  if (
    values.some((value) => !Number.isFinite(value)) ||
    values[0] >= values[2] ||
    values[1] >= values[3]
  ) {
    throw new BadRequestException(
      'bbox must be west,south,east,north with west < east and south < north',
    );
  }
  return values;
}

function summarize(values: number[]) {
  if (values.length === 0)
    return { air_cells: 0, mean_ug_m3: null, max_ug_m3: null };
  return {
    air_cells: values.length,
    mean_ug_m3: values.reduce((sum, value) => sum + value, 0) / values.length,
    max_ug_m3: Math.max(...values),
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function extension(kind: string): string {
  return (
    {
      wind: '.nc',
      concentration: '.nc',
      columns: '.csv.gz',
      metrics: '.json',
      log: '.log',
      config: '.yaml',
      manifest: '.json',
    }[kind] ?? ''
  );
}
