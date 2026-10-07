import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/env.validation.js';
import type { ExceedanceQueryDto } from '../dto/exceedance-query.dto.js';
import type { ProfileQueryDto } from '../dto/profile-query.dto.js';
import type { SliceQueryDto } from '../dto/slice-query.dto.js';
import { SimulationResultsRepository } from '../repositories/simulation-results.repository.js';
import type {
  GridSchema,
  ResultRunContext,
} from '../schemas/simulation-result.schema.js';

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
export class SimulationResultsService {
  constructor(
    private readonly results: SimulationResultsRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async slice(runId: string, query: SliceQueryDto) {
    const context = await this.context(runId);
    const layer = layerFor(context.grid, query.z_m ?? 1.5);
    const bbox = parseBbox(query.bbox);
    const rows = await this.results.concentrationSlice(
      runId,
      layer.k + 1,
      bbox,
      context.scenario_id,
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
    const rows = await this.results.exceedanceCells(
      runId,
      layer.k + 1,
      threshold.value_ug_m3,
      context.scenario_id,
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
    const row = await this.results.verticalProfile(
      runId,
      query.i,
      query.j,
      context.scenario_id,
    );
    if (!row) {
      throw new NotFoundException(
        `run ${runId} has no column (${query.i}, ${query.j})`,
      );
    }
    return {
      run_id: runId,
      i: query.i,
      j: query.j,
      centre: row.centre,
      units: 'ug m-3',
      levels: row.c_ug_m3.map((value, k) => ({
        k,
        z_m: (k + 0.5) * context.grid.dz_m,
        concentration_ug_m3: value === null ? null : Number(value),
      })),
    };
  }

  async summary(runId: string) {
    const context = await this.context(runId);
    const [layers, thresholds, metrics, checks] = await Promise.all([
      this.results.layerSummaries(runId),
      this.results.thresholds(),
      this.results.metrics(runId),
      this.results.verificationChecks(runId),
    ]);
    const cellVolume =
      context.grid.dx_m * context.grid.dy_m * context.grid.dz_m;
    const thresholdRows = await Promise.all(
      thresholds.map(async (threshold) => {
        const count = await this.results.exceedanceCount(
          runId,
          threshold.value_ug_m3,
        );
        return {
          key: threshold.key,
          label: threshold.label,
          value_ug_m3: Number(threshold.value_ug_m3),
          exceedance_volume_m3: count * cellVolume,
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
      layers: layers.map((row) => ({
        k: Number(row.k),
        z_m: (Number(row.k) + 0.5) * context.grid.dz_m,
        air_cells: Number(row.air_cells),
        mean_ug_m3: nullableNumber(row.mean_ug_m3),
        max_ug_m3: nullableNumber(row.max_ug_m3),
      })),
      thresholds: thresholdRows,
      metrics,
      verification: {
        status: checks.every((row) => row.status === 'pass')
          ? 'pass'
          : 'fail',
        checks,
      },
    };
  }

  async volume(runId: string) {
    const context = await this.context(runId);
    const rows = await this.results.columns(runId);
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
    const rows = await this.results.artifacts(runId);
    return { run_id: runId, artifacts: rows };
  }

  async download(runId: string, kind: string) {
    if (!ARTIFACT_KINDS.includes(kind as ArtifactKind)) {
      throw new BadRequestException(`unknown artifact kind ${kind}`);
    }
    await this.context(runId);
    const artifact = await this.results.artifact(runId, kind);
    if (!artifact)
      throw new NotFoundException(`run ${runId} has no ${kind} artifact`);
    const root = resolve(this.config.get('ARTIFACT_DIR', { infer: true }));
    const path = resolve(root, artifact.path);
    if (path !== root && !path.startsWith(root + sep)) {
      throw new BadRequestException('artifact path escaped ARTIFACT_DIR');
    }
    return {
      stream: createReadStream(path),
      filename: `${runId}-${kind}${extension(kind)}`,
      size: Number(artifact.size_bytes),
    };
  }

  private async context(runId: string): Promise<ResultRunContext> {
    const context = await this.results.runContext(runId);
    if (!context)
      throw new NotFoundException(`run ${runId} does not exist`);
    if (context.status !== 'succeeded') {
      throw new ConflictException(
        `run ${runId} is ${context.status}; results require succeeded`,
      );
    }
    return context;
  }

  private async threshold(custom: number | undefined, key: string) {
    if (custom !== undefined)
      return { key: 'custom', label: 'Custom', value_ug_m3: custom };
    const threshold = await this.results.threshold(key);
    if (!threshold)
      throw new BadRequestException(`unknown threshold_key ${key}`);
    return { ...threshold, value_ug_m3: Number(threshold.value_ug_m3) };
  }
}

function layerFor(grid: GridSchema, requested: number) {
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
