import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ComparisonQueryDto } from '../dto/comparison-query.dto.js';
import type { RegionQueryDto } from '../dto/region-query.dto.js';
import { SimulationResultsRepository } from '../repositories/simulation-results.repository.js';
import { SpatialAnalysisRepository } from '../repositories/spatial-analysis.repository.js';
import type { PolygonSchema } from '../schemas/spatial-analysis.schema.js';

@Injectable()
export class SpatialAnalysisService {
  constructor(
    private readonly results: SimulationResultsRepository,
    private readonly spatial: SpatialAnalysisRepository,
  ) {}

  private async context(id: string) {
    const context = await this.results.runContext(id);
    if (!context) throw new NotFoundException(`run ${id} does not exist`);
    if (context.status !== 'succeeded')
      throw new ConflictException(
        `run ${id} is ${context.status}; analysis requires succeeded`,
      );
    return context;
  }

  async comparison(id: string, query: ComparisonQueryDto) {
    const [a, b] = await Promise.all([
      this.context(id),
      this.context(query.compare_run_id),
    ]);
    const keys = [
      'origin_x_m',
      'origin_y_m',
      'dx_m',
      'dy_m',
      'dz_m',
      'nx',
      'ny',
      'nz',
    ] as const;
    if (
      a.study_area_id !== b.study_area_id ||
      a.projected_srid !== b.projected_srid ||
      a.scene_version !== b.scene_version ||
      a.model !== b.model ||
      keys.some((key) => a.grid[key] !== b.grid[key])
    ) {
      throw new ConflictException(
        'Runs must share study area, CRS, grid, scene and model',
      );
    }
    const z = query.z_m ?? 1.5;
    const k = Math.floor(z / a.grid.dz_m);
    if (k < 0 || k >= a.grid.nz)
      throw new BadRequestException('z_m outside grid');
    if (
      !(await this.spatial.matchingMasks(
        id,
        b.id,
        a.grid.nx,
        a.grid.ny,
        a.grid.nz,
      ))
    ) {
      throw new ConflictException(
        'Incomplete grids or different solid masks; comparison refused',
      );
    }
    const rows = await this.spatial.comparison(
      id,
      b.id,
      a.study_area_id,
      k + 1,
    );
    return {
      baseline_run_id: id,
      comparison_run_id: b.id,
      baseline_version: a.model_version,
      comparison_version: b.model_version,
      baseline_input_hash: a.input_hash,
      comparison_input_hash: b.input_hash,
      units: 'ug m-3',
      delta_definition: 'comparison - baseline',
      requested_z_m: z,
      z_center_m: (k + 0.5) * a.grid.dz_m,
      k,
      stats: {
        air_cells: rows.length,
        baseline: stats(rows.map((r) => Number(r.baseline))),
        comparison: stats(rows.map((r) => Number(r.comparison))),
        delta: stats(rows.map((r) => Number(r.delta))),
      },
      feature_collection: {
        type: 'FeatureCollection',
        features: rows.map((row) => ({
          type: 'Feature',
          geometry: row.geometry,
          properties: {
            i: row.i,
            j: row.j,
            baseline_ug_m3: Number(row.baseline),
            comparison_ug_m3: Number(row.comparison),
            delta_ug_m3: Number(row.delta),
          },
        })),
      },
    };
  }

  async region(id: string, query: RegionQueryDto) {
    const context = await this.context(id);
    const { z_min_m: min, z_max_m: max } = query;
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < 0 ||
      min >= max ||
      max > context.grid.nz * context.grid.dz_m
    ) {
      throw new BadRequestException(
        'Require 0 <= z_min_m < z_max_m <= domain height',
      );
    }
    const polygon = validatePolygonShape(query.polygon);
    const geometry = JSON.stringify(polygon);
    const check = await this.spatial.validatePolygon(
      geometry,
      context.study_area_id,
    );
    if (!check?.valid || check.area_m2 <= 0)
      throw new BadRequestException(
        'Polygon must be valid with positive area (no self intersections)',
      );
    if (!check.covered)
      throw new BadRequestException(
        'Polygon must be fully inside the study area',
      );
    const threshold = query.threshold_ug_m3 ?? 15;
    const rows = (
      await this.spatial.region(
        id,
        context.study_area_id,
        geometry,
        min,
        max,
        context.grid.dz_m,
        threshold,
      )
    ).map((row) => ({
      k: Number(row.k),
      z_center_m: (Number(row.k) + 0.5) * context.grid.dz_m,
      air_voxels: Number(row.air_voxels),
      air_volume_m3: Number(row.air_volume_m3),
      mean_ug_m3: row.mean_ug_m3 === null ? null : Number(row.mean_ug_m3),
      max_ug_m3: row.max_ug_m3 === null ? null : Number(row.max_ug_m3),
      exceedance_volume_m3: Number(row.exceedance_volume_m3),
    }));
    const volume = rows.reduce((sum, r) => sum + r.air_volume_m3, 0);
    return {
      run_id: id,
      model_version: context.model_version,
      input_hash: context.input_hash,
      units: 'ug m-3',
      projected_srid: context.projected_srid,
      polygon,
      z_min_m: min,
      z_max_m: max,
      threshold_ug_m3: threshold,
      weighting:
        'XY intersection area x overlapping layer thickness; solid/null omitted',
      area_m2: Number(check.area_m2),
      air_volume_m3: volume,
      air_voxels: rows.reduce((sum, r) => sum + r.air_voxels, 0),
      mean_ug_m3:
        volume > 0
          ? rows.reduce(
              (sum, r) => sum + (r.mean_ug_m3 ?? 0) * r.air_volume_m3,
              0,
            ) / volume
          : null,
      max_ug_m3: rows.length
        ? Math.max(...rows.map((r) => r.max_ug_m3 ?? 0))
        : null,
      exceedance_volume_m3: rows.reduce(
        (sum, r) => sum + r.exceedance_volume_m3,
        0,
      ),
      layers: rows,
    };
  }

  async csv(id: string, query: RegionQueryDto) {
    const result = await this.region(id, query);
    const headers = [
      'run_id',
      'model_version',
      'input_hash',
      'units',
      'z_min_m',
      'z_max_m',
      'threshold_ug_m3',
      'polygon_geojson',
      'k',
      'z_center_m',
      'air_voxels',
      'air_volume_m3',
      'mean_ug_m3',
      'max_ug_m3',
      'exceedance_volume_m3',
    ];
    const common = [
      id,
      result.model_version,
      result.input_hash,
      result.units,
      result.z_min_m,
      result.z_max_m,
      result.threshold_ug_m3,
      JSON.stringify(result.polygon),
    ];
    const rows = result.layers.length
      ? result.layers.map((row) => [
          ...common,
          row.k,
          row.z_center_m,
          row.air_voxels,
          row.air_volume_m3,
          row.mean_ug_m3,
          row.max_ug_m3,
          row.exceedance_volume_m3,
        ])
      : [[...common, null, null, 0, 0, null, null, 0]];
    return (
      [headers, ...rows]
        .map((row) => row.map(csvValue).join(','))
        .join('\r\n') + '\r\n'
    );
  }
}

function stats(values: number[]) {
  return {
    mean_ug_m3: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null,
    min_ug_m3: values.length ? Math.min(...values) : null,
    max_ug_m3: values.length ? Math.max(...values) : null,
  };
}

export function validatePolygonShape(raw: {
  type: string;
  coordinates: unknown;
}): PolygonSchema {
  if (
    !raw ||
    raw.type !== 'Polygon' ||
    Object.keys(raw).some((key) => !['type', 'coordinates'].includes(key)) ||
    !Array.isArray(raw.coordinates) ||
    !raw.coordinates.length ||
    raw.coordinates.length > 20
  ) {
    throw new BadRequestException(
      'Expected a 2D GeoJSON Polygon with 1..20 rings',
    );
  }
  let count = 0;
  for (const ring of raw.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4)
      throw new BadRequestException(
        'Rings need at least 4 positions and must be closed',
      );
    count += ring.length;
    if (count > 500)
      throw new BadRequestException('Polygon exceeds 500 vertices');
    for (const point of ring) {
      if (
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
        Math.abs(point[0]) > 180 ||
        Math.abs(point[1]) > 90
      ) {
        throw new BadRequestException(
          'Coordinates must be finite WGS84 longitude/latitude pairs',
        );
      }
    }
    if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
      throw new BadRequestException('Polygon rings must be closed');
  }
  return raw as PolygonSchema;
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== 'number') text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
