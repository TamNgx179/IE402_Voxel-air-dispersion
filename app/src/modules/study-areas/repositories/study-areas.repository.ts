import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import type { SceneFeatureRow } from '../schemas/study-area.schema.js';

@Injectable()
export class StudyAreasRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll() {
    const { rows } = await this.db.query(
      `SELECT id, name, projected_srid AS srid, grid, scene_version, provenance,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry,
              ST_XMin(g4) AS west, ST_YMin(g4) AS south, ST_XMax(g4) AS east, ST_YMax(g4) AS north,
              ST_XMin(geom) AS minx, ST_YMin(geom) AS miny, ST_XMax(geom) AS maxx, ST_YMax(geom) AS maxy
       FROM study_areas
       CROSS JOIN LATERAL (SELECT ST_Transform(geom, 4326)::box2d AS g4) t
       ORDER BY name`,
    );
    return rows;
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM study_areas WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  buildings(id: string): Promise<SceneFeatureRow[]> {
    return this.features(
      `SELECT source_feature_id, height_m, height_source,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
       FROM building_footprints WHERE study_area_id = $1 ORDER BY id`,
      id,
    );
  }

  roads(id: string): Promise<SceneFeatureRow[]> {
    return this.features(
      `SELECT source_feature_id, road_class, emission_weight,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
       FROM road_segments WHERE study_area_id = $1 ORDER BY id`,
      id,
    );
  }

  water(id: string): Promise<SceneFeatureRow[]> {
    return this.features(
      `SELECT source_feature_id, kind,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
       FROM water_features WHERE study_area_id = $1 ORDER BY id`,
      id,
    );
  }

  green(id: string): Promise<SceneFeatureRow[]> {
    return this.features(
      `SELECT source_feature_id, kind,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry
       FROM green_features WHERE study_area_id = $1 ORDER BY id`,
      id,
    );
  }

  private async features(sql: string, id: string): Promise<SceneFeatureRow[]> {
    const { rows } = await this.db.query<SceneFeatureRow>(sql, [id]);
    return rows;
  }
}
