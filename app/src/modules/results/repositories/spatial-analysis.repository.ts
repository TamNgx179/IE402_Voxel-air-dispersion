import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import type {
  ComparisonCellRow,
  RegionLayerRow,
} from '../schemas/spatial-analysis.schema.js';

/** Read-only exact queries. No client-side uint8 codes enter these calculations. */
@Injectable()
export class SpatialAnalysisRepository {
  constructor(private readonly db: DatabaseService) {}

  async matchingMasks(
    baseline: string,
    comparison: string,
    nx: number,
    ny: number,
    nz: number,
  ) {
    const { rows } = await this.db.query<{ matches: boolean }>(
      `WITH a AS (SELECT i,j,c_ug_m3 FROM concentration_columns WHERE run_id=$1),
            b AS (SELECT i,j,c_ug_m3 FROM concentration_columns WHERE run_id=$2)
       SELECT (SELECT count(*)=$3 FROM a) AND (SELECT count(*)=$3 FROM b)
         AND NOT EXISTS (
           SELECT 1 FROM a FULL JOIN b USING(i,j)
           WHERE a.i IS NULL OR b.i IS NULL OR a.i<0 OR a.i>=$5 OR a.j<0 OR a.j>=$6
             OR cardinality(a.c_ug_m3)<>$4 OR cardinality(b.c_ug_m3)<>$4
             OR ARRAY(SELECT v IS NULL FROM unnest(a.c_ug_m3) v)
                IS DISTINCT FROM ARRAY(SELECT v IS NULL FROM unnest(b.c_ug_m3) v)
         ) AS matches`,
      [baseline, comparison, nx * ny, nz, nx, ny],
    );
    return rows[0].matches;
  }

  async comparison(
    baseline: string,
    comparison: string,
    area: string,
    layer: number,
  ) {
    const { rows } = await this.db.query<ComparisonCellRow>(COMPARISON_SQL, [
      baseline,
      comparison,
      area,
      layer,
    ]);
    return rows;
  }

  async validatePolygon(polygon: string, area: string) {
    const { rows } = await this.db.query<{
      valid: boolean;
      covered: boolean;
      area_m2: number;
    }>(
      `WITH p AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS geom)
       SELECT ST_IsValid(p.geom,0) AS valid,
         CASE WHEN ST_IsValid(p.geom,0) THEN ST_CoveredBy(p.geom,ST_Transform(a.geom,4326)) ELSE false END AS covered,
         CASE WHEN ST_IsValid(p.geom,0) AND ST_CoveredBy(p.geom,ST_Transform(a.geom,4326))
           THEN ST_Area(ST_Transform(p.geom,32648)) ELSE 0 END AS area_m2
       FROM p JOIN study_areas a ON a.id=$2`,
      [polygon, area],
    );
    return rows[0];
  }

  async region(
    run: string,
    area: string,
    polygon: string,
    min: number,
    max: number,
    dz: number,
    threshold: number,
  ) {
    const { rows } = await this.db.query<RegionLayerRow>(REGION_SQL, [
      run,
      area,
      polygon,
      min,
      max,
      dz,
      threshold,
    ]);
    return rows;
  }
}

// Exported for benchmark/EXPLAIN: execution and measurement use the same query.
export const COMPARISON_SQL = `SELECT a.i,a.j, a.c_ug_m3[$4]::double precision AS baseline,
  b.c_ug_m3[$4]::double precision AS comparison,
  b.c_ug_m3[$4]::double precision-a.c_ug_m3[$4]::double precision AS delta,
  ST_AsGeoJSON(ST_Transform(g.geom,4326),9)::json AS geometry
FROM concentration_columns a
JOIN concentration_columns b ON b.run_id=$2 AND b.i=a.i AND b.j=a.j
JOIN grid_cells g ON g.study_area_id=$3 AND g.i=a.i AND g.j=a.j
WHERE a.run_id=$1 AND a.c_ug_m3[$4] IS NOT NULL AND b.c_ug_m3[$4] IS NOT NULL
ORDER BY a.j,a.i`;

export const REGION_SQL = `WITH p AS (
  SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($3),4326),32648) AS geom
), cells AS MATERIALIZED (
  SELECT g.i,g.j,ST_Area(ST_Intersection(g.geom,p.geom)) AS area_m2
  FROM grid_cells g CROSS JOIN p
  WHERE g.study_area_id=$2 AND ST_Intersects(g.geom,p.geom)
), weighted AS (
  SELECT u.ordinality-1 AS k, u.value::double precision AS concentration,
    cells.area_m2 * greatest(0.0,least($5::double precision,u.ordinality*$6::double precision)
      -greatest($4::double precision,(u.ordinality-1)*$6::double precision)) AS volume
  FROM cells JOIN concentration_columns c ON c.run_id=$1 AND c.i=cells.i AND c.j=cells.j
  CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY u(value,ordinality)
  WHERE cells.area_m2>0 AND u.value IS NOT NULL
)
SELECT k::int, count(*)::int AS air_voxels, sum(volume)::double precision AS air_volume_m3,
  (sum(concentration*volume)/sum(volume))::double precision AS mean_ug_m3,
  max(concentration)::double precision AS max_ug_m3,
  coalesce(sum(volume) FILTER(WHERE concentration>$7),0)::double precision AS exceedance_volume_m3
FROM weighted WHERE volume>0 GROUP BY k ORDER BY k`;
