import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service.js';

export interface StudyAreaView {
  id: string;
  name: string;
  srid: number;
  grid: Record<string, number>;
  /** [west, south, east, north] in EPSG:4326 (GeoJSON bbox order). */
  bounds: [number, number, number, number];
  /** [minx, miny, maxx, maxy] in the projected SRID, metres. */
  bounds_projected: [number, number, number, number];
  /** GeoJSON geometry in EPSG:4326. */
  geometry: Record<string, unknown>;
  scene_version: string | null;
}

@ApiTags('study-areas')
@Controller('study-areas')
export class StudyAreasController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({
    summary: 'List study areas, their grid and bounds (EPSG:4326)',
  })
  @ApiOkResponse({ description: 'Array of study areas' })
  async list(): Promise<StudyAreaView[]> {
    const { rows } = await this.db.query(
      `SELECT id, name, projected_srid AS srid, grid, scene_version,
              ST_AsGeoJSON(ST_Transform(geom, 4326), 7)::json AS geometry,
              ST_XMin(g4) AS west, ST_YMin(g4) AS south, ST_XMax(g4) AS east, ST_YMax(g4) AS north,
              ST_XMin(geom) AS minx, ST_YMin(geom) AS miny, ST_XMax(geom) AS maxx, ST_YMax(geom) AS maxy
       FROM study_areas
       CROSS JOIN LATERAL (SELECT ST_Transform(geom, 4326)::box2d AS g4) t
       ORDER BY name`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      srid: r.srid,
      grid: r.grid,
      bounds: [r.west, r.south, r.east, r.north],
      bounds_projected: [r.minx, r.miny, r.maxx, r.maxy],
      geometry: r.geometry,
      scene_version: r.scene_version,
    }));
  }
}
