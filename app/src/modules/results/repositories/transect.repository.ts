import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import type {
  Position,
  TransectColumnRow,
} from '../schemas/transect.schema.js';
import type { GridSchema } from '../schemas/simulation-result.schema.js';

/** Chỉ đọc PostGIS; không tạo run, ghi grid hoặc sửa kết quả mô phỏng. */
@Injectable()
export class TransectRepository {
  constructor(private readonly db: DatabaseService) {}

  async projectLine(line: string, area: string, srid: number) {
    // Kiểm phạm vi ở WGS84 trước: tọa độ xa ngoài study area có thể làm phép chiếu UTM lỗi.
    // Kiểm lại toàn tuyến sau phép chiếu để cả đoạn nối, không chỉ các đỉnh, nằm trong miền.
    const { rows } = await this.db.query<{
      covered: boolean;
      coordinates: Position[] | null;
    }>(
      `WITH l AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS geom),
       checked AS (
         SELECT l.geom,a.geom AS area,ST_CoveredBy(l.geom,ST_Transform(a.geom,4326)) AS in_area
         FROM l JOIN study_areas a ON a.id=$2
       ), projected AS (
         SELECT CASE WHEN in_area THEN ST_Transform(geom,$3::int) END AS geom,area FROM checked
       ) SELECT geom IS NOT NULL AND ST_CoveredBy(geom,ST_Transform(area,$3::int)) AS covered,
         CASE WHEN geom IS NOT NULL THEN ST_AsGeoJSON(geom,15)::json->'coordinates' END AS coordinates
       FROM projected`,
      [line, area, srid],
    );
    return rows[0];
  }

  async columns(
    run: string,
    area: string,
    srid: number,
    grid: GridSchema,
    samples: { x_m: number; y_m: number; i: number; j: number }[],
    first: number,
    last: number,
  ) {
    // WITH ORDINALITY giữ thứ tự dọc tuyến, kể cả khi một voxel được ghé nhiều lần.
    // PostgreSQL array bắt đầu từ 1; cast float4 → float8 trước JSON để giữ giá trị đã lưu.
    // LEFT JOIN giữ mẫu thiếu dữ liệu, không loại chúng khỏi vị trí trên mặt cắt.
    const { rows } = await this.db.query<TransectColumnRow>(
      `WITH s AS (
         SELECT * FROM unnest($3::float8[],$4::float8[],$5::int[],$6::int[])
         WITH ORDINALITY AS t(x,y,i,j,ordinal)
       ) SELECT s.ordinal::int, g.i IS NOT NULL AS grid_present,
         ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_MakePoint(s.x,s.y),$7),4326),15)::json->'coordinates' AS sample_coordinates,
         ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_MakePoint(
           $8::float8+(s.i+0.5)*$10::float8,$9::float8+(s.j+0.5)*$11::float8),$7),4326),15)::json->'coordinates' AS cell_center_coordinates,
         c.c_ug_m3[$12::int:$13::int]::float8[] AS concentrations,g.solid_from_k,g.solid_to_k
       FROM s LEFT JOIN grid_cells g ON g.study_area_id=$2 AND g.i=s.i AND g.j=s.j
       LEFT JOIN concentration_columns c ON c.run_id=$1 AND c.i=s.i AND c.j=s.j
       ORDER BY s.ordinal`,
      [
        run,
        area,
        samples.map((p) => p.x_m),
        samples.map((p) => p.y_m),
        samples.map((p) => p.i),
        samples.map((p) => p.j),
        srid,
        grid.origin_x_m,
        grid.origin_y_m,
        grid.dx_m,
        grid.dy_m,
        first + 1,
        last + 1,
      ],
    );
    return rows;
  }
}
