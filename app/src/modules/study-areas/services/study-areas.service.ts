import { Injectable, NotFoundException } from '@nestjs/common';
import { StudyAreasRepository } from '../repositories/study-areas.repository.js';
import type {
  SceneFeatureRow,
  StudyAreaSchema,
} from '../schemas/study-area.schema.js';

@Injectable()
export class StudyAreasService {
  constructor(private readonly studyAreas: StudyAreasRepository) {}

  async list(): Promise<StudyAreaSchema[]> {
    const rows = await this.studyAreas.findAll();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      srid: Number(row.srid),
      grid: row.grid,
      bounds: [row.west, row.south, row.east, row.north].map(Number) as [
        number,
        number,
        number,
        number,
      ],
      bounds_projected: [row.minx, row.miny, row.maxx, row.maxy].map(
        Number,
      ) as [number, number, number, number],
      geometry: row.geometry,
      scene_version: row.scene_version,
      provenance: row.provenance ?? {},
    }));
  }

  async scene(id: string) {
    if (!(await this.studyAreas.exists(id)))
      throw new NotFoundException(`study area ${id} does not exist`);
    const [buildings, roads, water, green] = await Promise.all([
      this.features(
        this.studyAreas.buildings(id),
        (row) => ({
          source_feature_id: row.source_feature_id,
          height_m: Number(row.height_m),
          height_source: row.height_source,
        }),
      ),
      this.features(
        this.studyAreas.roads(id),
        (row) => ({
          source_feature_id: row.source_feature_id,
          road_class: row.road_class,
          emission_weight: nullableNumber(row.emission_weight),
        }),
      ),
      this.features(
        this.studyAreas.water(id),
        (row) => ({ source_feature_id: row.source_feature_id, kind: row.kind }),
      ),
      this.features(
        this.studyAreas.green(id),
        (row) => ({ source_feature_id: row.source_feature_id, kind: row.kind }),
      ),
    ]);
    return { study_area_id: id, buildings, roads, water, green };
  }

  private async features(
    source: Promise<SceneFeatureRow[]>,
    properties: (row: SceneFeatureRow) => Record<string, unknown>,
  ) {
    const rows = await source;
    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        properties: properties(row),
        geometry: row.geometry,
      })),
    };
  }
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
