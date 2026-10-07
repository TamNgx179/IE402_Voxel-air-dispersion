import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

export interface StudyAreaView {
  id: string;
  name: string;
  srid: number;
  grid: Record<string, number>;
  bounds: [number, number, number, number];
  bounds_projected: [number, number, number, number];
  geometry: Record<string, unknown>;
  scene_version: string | null;
  provenance: Record<string, unknown>;
}

@Injectable()
export class StudyAreasService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<StudyAreaView[]> {
    const { rows } = await this.db.query(
      `SELECT id, name, projected_srid AS srid, grid, scene_version, provenance,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry,
              ST_XMin(g4) AS west, ST_YMin(g4) AS south, ST_XMax(g4) AS east, ST_YMax(g4) AS north,
              ST_XMin(geom) AS minx, ST_YMin(geom) AS miny, ST_XMax(geom) AS maxx, ST_YMax(geom) AS maxy
       FROM study_areas
       CROSS JOIN LATERAL (SELECT ST_Transform(geom, 4326)::box2d AS g4) t
       ORDER BY name`,
    );
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
    const exists = await this.db.query(
      'SELECT 1 FROM study_areas WHERE id = $1',
      [id],
    );
    if (exists.rowCount === 0)
      throw new NotFoundException(`study area ${id} does not exist`);
    const [buildings, roads, water, green] = await Promise.all([
      this.features(
        `SELECT source_feature_id, height_m, height_source,
                ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
         FROM building_footprints WHERE study_area_id = $1 ORDER BY id`,
        id,
        (row) => ({
          source_feature_id: row.source_feature_id,
          height_m: Number(row.height_m),
          height_source: row.height_source,
        }),
      ),
      this.features(
        `SELECT source_feature_id, road_class, emission_weight,
                ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
         FROM road_segments WHERE study_area_id = $1 ORDER BY id`,
        id,
        (row) => ({
          source_feature_id: row.source_feature_id,
          road_class: row.road_class,
          emission_weight: nullableNumber(row.emission_weight),
        }),
      ),
      this.features(
        `SELECT source_feature_id, kind,
                ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
         FROM water_features WHERE study_area_id = $1 ORDER BY id`,
        id,
        (row) => ({ source_feature_id: row.source_feature_id, kind: row.kind }),
      ),
      this.features(
        `SELECT source_feature_id, kind,
                ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
         FROM green_features WHERE study_area_id = $1 ORDER BY id`,
        id,
        (row) => ({ source_feature_id: row.source_feature_id, kind: row.kind }),
      ),
    ]);
    return { study_area_id: id, buildings, roads, water, green };
  }

  private async features(
    sql: string,
    id: string,
    properties: (row: any) => Record<string, unknown>,
  ) {
    const { rows } = await this.db.query(sql, [id]);
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
