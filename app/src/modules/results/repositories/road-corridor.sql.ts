/** Geometry stays in the metric CRS until the final GeoJSON projection. */
export const ROAD_CORRIDOR_SQL = `
WITH selected AS (
  SELECT ST_Collect(geom) AS geom, count(DISTINCT source_feature_id)::int AS matched
  FROM road_segments
  WHERE study_area_id = $2 AND source_feature_id = ANY($3::text[])
), cumulative AS (
  SELECT d.n, d.radius, ST_Intersection(a.geom, ST_Buffer(s.geom, d.radius)) AS geom
  FROM selected s JOIN study_areas a ON a.id = $2
  CROSS JOIN unnest($4::double precision[]) WITH ORDINALITY d(radius, n)
  WHERE s.matched = cardinality($3::text[])
), bands AS MATERIALIZED (
  SELECT b.n, coalesce(p.radius, 0) AS inner_m, b.radius AS outer_m,
    CASE WHEN p.geom IS NULL THEN b.geom ELSE ST_Difference(b.geom, p.geom) END AS geom
  FROM cumulative b LEFT JOIN cumulative p ON p.n = b.n - 1
), cells AS MATERIALIZED (
  SELECT b.n, g.i, g.j, g.solid_from_k, g.solid_to_k,
    ST_Area(ST_Intersection(b.geom, g.geom)) AS area
  FROM bands b JOIN grid_cells g ON g.study_area_id = $2 AND ST_Intersects(g.geom, b.geom)
), weighted AS (
  SELECT cells.n, c.c_ug_m3[k + 1]::double precision AS value,
    cells.area * (least($6::float8, (k + 1) * $7::float8)
                 - greatest($5::float8, k * $7::float8)) AS volume
  FROM cells
  LEFT JOIN concentration_columns c ON c.run_id = $1 AND c.i = cells.i AND c.j = cells.j
  CROSS JOIN generate_series(floor($5::float8 / $7::float8)::int,
                             ceil($6::float8 / $7::float8)::int - 1) AS z(k)
  WHERE cells.area > 0
    AND (cells.solid_from_k IS NULL OR k NOT BETWEEN cells.solid_from_k AND cells.solid_to_k)
), totals AS (
  SELECT n, sum(volume) AS air_volume_m3,
    sum(volume) FILTER (WHERE value IS NOT NULL) AS valid_volume_m3,
    sum(volume * value) / nullif(sum(volume) FILTER (WHERE value IS NOT NULL), 0) AS mean_ug_m3,
    sum(volume) FILTER (WHERE value > $8::float8) AS exceedance_volume_m3
  FROM weighted WHERE volume > 0 GROUP BY n
)
SELECT inner_m, outer_m, ST_Area(geom) AS area_m2,
  ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(geom, 3), 4326))::json AS geometry,
  coalesce(air_volume_m3, 0) AS air_volume_m3,
  coalesce(valid_volume_m3, 0) AS valid_volume_m3,
  coalesce(valid_volume_m3, 0) / nullif(air_volume_m3, 0) AS coverage,
  mean_ug_m3, coalesce(exceedance_volume_m3, 0) AS exceedance_volume_m3
FROM bands LEFT JOIN totals USING (n) ORDER BY n`;
