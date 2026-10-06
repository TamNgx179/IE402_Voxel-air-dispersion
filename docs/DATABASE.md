# Cơ sở dữ liệu — PostgreSQL/PostGIS

> **Trạng thái: v1, cách lưu nồng độ (spec D1) đã chốt ngày 06/10/2026.** Dẫn xuất từ
> [`spec.md`](spec.md) (BR-22..BR-27, *Hợp đồng v1 · D1*). Migration ở `db/migrations/` là
> nguồn sự thật khi đã có; tài liệu này phải được sửa trong cùng PR với migration.

## 1 · ERD

```mermaid
erDiagram
    study_areas ||--o{ building_footprints : contains
    study_areas ||--o{ road_segments : contains
    study_areas ||--o{ water_features : contains
    study_areas ||--o{ green_features : contains
    study_areas ||--o{ grid_cells : "is divided into"
    study_areas ||--o{ scenarios : "has"
    scenarios ||--o{ simulation_runs : "is run as"
    simulation_runs ||--o| run_metrics : "reports"
    simulation_runs ||--o{ verification_checks : "is gated by"
    simulation_runs ||--o{ artifacts : "produces"
    simulation_runs ||--o{ concentration_columns : "stores"
    grid_cells ||--o{ concentration_columns : "locates"

    study_areas {
        uuid id PK
        text name
        geometry geom "Polygon, SRID = projected_srid"
        int projected_srid "32648 cho Quận 1"
        jsonb grid "origin, dx, dy, dz, nx, ny, nz"
        text scene_version
        jsonb provenance
    }
    building_footprints {
        bigint id PK
        uuid study_area_id FK
        text source_feature_id "OSM way/relation id"
        geometry geom "MultiPolygon"
        real height_m
        text height_source "gob:building_height | osm:height | osm:building:levels | fallback:fixed"
    }
    road_segments {
        bigint id PK
        uuid study_area_id FK
        text source_feature_id
        geometry geom "LineString"
        text road_class
        real emission_weight
    }
    water_features {
        bigint id PK
        uuid study_area_id FK
        text source_feature_id
        text kind "water | river | canal | ..."
        geometry geom "Geometry: area hoặc đường tâm kênh"
    }
    green_features {
        bigint id PK
        uuid study_area_id FK
        text source_feature_id
        text kind "park | garden | grass | scrub | ..."
        geometry geom "Polygon/MultiPolygon"
    }
    grid_cells {
        uuid study_area_id PK,FK
        smallint i PK
        smallint j PK
        geometry geom "Polygon 5 x 5 m"
        smallint solid_from_k "NULL nếu không có nhà"
        smallint solid_to_k
    }
    scenarios {
        text id PK "dry_nov_apr, wet_may_oct"
        uuid study_area_id FK
        text name
        real wind_from_deg
        real wind_speed_m_s
        jsonb parameters
    }
    simulation_runs {
        uuid id PK
        text scenario_id FK
        text model "fv | gaussian"
        text status "queued | running | succeeded | failed | stale"
        smallint attempt
        jsonb config_snapshot
        text model_version
        text input_hash "không gồm run_id: cùng đầu vào → cùng hash"
        text_array warnings "từ manifest; run mock luôn có cảnh báo"
        real progress
        text error_kind "input | model | system | timeout"
        text error_message
        timestamptz created_at
        timestamptz started_at
        timestamptz finished_at
    }
    run_metrics {
        uuid run_id PK,FK
        real dt_s
        real courant
        int steps
        real simulated_s
        real wall_clock_s
        double emitted_kg
        double remaining_kg
        double escaped_kg
        double correction_kg
        text stopping_criterion
    }
    verification_checks {
        uuid run_id PK,FK
        text check_name PK "cfl | face_divergence | positivity | wall_flux | mass_balance | sor_convergence"
        text status "pass | fail"
        double value
        double tolerance
    }
    artifacts {
        uuid run_id PK,FK
        text kind PK
        text path
        text sha256
        bigint size_bytes
    }
    concentration_columns {
        uuid run_id PK,FK
        smallint i PK
        smallint j PK
        real_array c_ug_m3 "real[nz], NULL = voxel rắn"
    }
    thresholds {
        text key PK
        real value_ug_m3
        text label
        text config_hash
    }
```

`concentration_columns` tham chiếu `grid_cells` qua `(study_area_id, i, j)`; `study_area_id`
suy ra từ `simulation_runs → scenarios`, nên không lặp lại trong bảng lớn.

## 2 · Index

| Bảng | Index | Phục vụ |
|---|---|---|
| mọi bảng có `geom` | GiST (`geom`) | lọc bbox, `ST_Intersects` (BR-23) |
| `simulation_runs` | B-tree (`status`, `created_at`) | executor lấy run `queued` cũ nhất; quét `running` khi restart |
| `simulation_runs` | B-tree (`input_hash`) | tìm các run cùng đầu vào — bằng chứng tái lập. Retry dùng lại chính dòng của run nên không nhân đôi (BR-19) |
| `concentration_columns` | PK (`run_id`, `i`, `j`) | profile tại một cột; JOIN với `grid_cells` |
| `grid_cells` | PK (`study_area_id`, `i`, `j`) | JOIN theo chỉ số ô |

Ràng buộc: SRID của mọi `geom` bằng `study_areas.projected_srid` (CHECK qua trigger hoặc kiểu
`geometry(…, 32648)` cố định cho study area duy nhất của MVP); `array_length(c_ug_m3, 1) = nz`;
`status` và `error_kind` là CHECK trên tập giá trị cố định.

## 3 · Bốn query bắt buộc (BR-26) — phác thảo

`k` được tính ở API: `k = floor(z_m / dz)` (spec D1). Mảng PostgreSQL đánh số từ 1 nên phần tử
của tầng `k` là `c_ug_m3[k + 1]`. Geometry trả về web được `ST_Transform(…, 4326)`.

```sql
-- 1. Slice tại một cao độ, có lọc bbox (GiST trên grid_cells.geom)
SELECT g.i, g.j, ST_AsGeoJSON(ST_Transform(g.geom, 4326)) AS geom, c.c_ug_m3[$k + 1] AS c
FROM concentration_columns c
JOIN grid_cells g ON g.study_area_id = $study_area AND g.i = c.i AND g.j = c.j
WHERE c.run_id = $run
  AND g.geom && ST_Transform(ST_MakeEnvelope($w, $s, $e, $n, 4326), 32648)
  AND c.c_ug_m3[$k + 1] IS NOT NULL;

-- 2. Exceedance: ô vượt ngưỡng tại tầng k, và thể tích vượt ngưỡng toàn miền
SELECT count(*) FILTER (WHERE v > t.value_ug_m3) * $dx * $dy * $dz AS exceed_volume_m3
FROM concentration_columns c
CROSS JOIN LATERAL unnest(c.c_ug_m3) AS v
JOIN thresholds t ON t.key = $threshold_key
WHERE c.run_id = $run;

-- 3. Profile đứng tại điểm (x, y) → ô chứa nó
SELECT u.k - 1 AS k, (u.k - 1 + 0.5) * $dz AS z_center_m, u.v AS c
FROM grid_cells g
JOIN concentration_columns c ON c.run_id = $run AND c.i = g.i AND c.j = g.j
CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY AS u(v, k)
WHERE g.study_area_id = $study_area
  AND ST_Contains(g.geom, ST_Transform(ST_SetSRID(ST_Point($lon, $lat), 4326), 32648))
ORDER BY u.k;

-- 4. Summary theo tầng
SELECT u.k - 1 AS k, avg(u.v) AS mean_c, max(u.v) AS max_c,
       count(*) FILTER (WHERE u.v > $qcvn) AS cells_over_qcvn
FROM concentration_columns c
CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY AS u(v, k)
WHERE c.run_id = $run AND u.v IS NOT NULL
GROUP BY u.k ORDER BY u.k;
```

Bằng chứng `EXPLAIN (ANALYZE, BUFFERS)` cho bốn query này là A5.5; kích thước bảng và p50/p95
là A5.6.

## 4 · Ước lượng kích thước (cần đo lại ở A5.6)

| Bảng | Dòng | Ghi chú |
|---|---:|---|
| `grid_cells` | 10.000 / study area | seed một lần |
| `concentration_columns` | 10.000 / run | mỗi mảng 50 × 4 B ≈ 200 B → ≈ 3 MB/run trước index |
| `building_footprints` | ≈ vài trăm | lấy từ scene package |

Tensor đầy đủ (gió 3 thành phần, mặt ô, nồng độ) **không** vào DB (BR-24); nằm ở
`artifacts/<run_id>/*.nc`, DB chỉ giữ đường dẫn và checksum.

## 5 · Nguồn seed

| Bảng | Sinh bởi | Người |
|---|---|---|
| `study_areas`, `building_footprints`, `road_segments`, `grid_cells` | scene package do Python xuất (B2.4) | B xuất, A nạp |
| `scenarios` | `config/project.yaml` → `meteorology.scenarios` | A nạp |
| `thresholds` | `config/project.yaml` → `analysis.thresholds_ug_m3`, kèm hash của config | A nạp; AC-32 kiểm khớp |

### Scene package — định dạng giao giữa B và A

Python (`src/07_export_scene.py`) ghi vào `db/seeds/scene/`. Thư mục này **được commit** (vài
MB) để máy sạch seed được mà không cần Internet hay `data/` (M1, A8.1). Mọi geometry là **WKT
trong EPSG của study area** (32648), CSV UTF-8 có header, dấu phẩy, trường WKT đặt trong ngoặc
kép.

| File | Cột |
|---|---|
| `scene_manifest.json` | `schema_version`, `study_area {name, srid, wkt}`, `grid {origin_x_m, origin_y_m, dx_m, dy_m, dz_m, nx, ny, nz}`, `counts {buildings, roads, water, green, grid_cells}`, `files {tên: sha256}`, `provenance {nguồn, giấy phép, ngày tải}`, `generated_at` |
| `buildings.csv` | `source_feature_id, height_m, height_source, wkt` |
| `roads.csv` | `source_feature_id, road_class, emission_weight, wkt` |
| `water.csv` | `source_feature_id, kind, wkt` (có thể 0 dòng, chỉ header) |
| `green.csv` | `source_feature_id, kind, wkt` (có thể 0 dòng, chỉ header) |
| `grid_cells.csv` | `i, j, solid_from_k, solid_to_k, wkt` — `solid_*` để trống nếu cột không có nhà |

Seed của A từ chối nạp nếu checksum trong `scene_manifest.json` không khớp file.

### Chạy

```bash
docker compose up -d db      # postgis/postgis:16-3.4, cổng host 5433, user/pass ie402/ie402 (chỉ dev)
cd app
cp .env.example .env         # DATABASE_URL=postgres://ie402:ie402@localhost:5433/ie402
npm run db:reset             # dựng lại sạch: DROP SCHEMA public + mọi migration (db:migrate = chỉ phần còn thiếu)
npm run db:seed              # db/seeds/scene/ + config/project.yaml; chạy lại không nhân đôi
```

## 6 · Kiểm kê dữ liệu dựng cảnh 3D (B1.4)

Đo ngày 06/10/2026 trên `data/` của pipeline chạy lại ngày 30/09. Study area **Nguyễn Huệ**,
tâm 10,7746° N 106,7035° E, 500 × 500 m, model CRS **EPSG:32648**.

| Lớp | Nguồn | Giấy phép | Hiện có | Khoảng trống |
|---|---|---|---|---|
| Footprint nhà | OSM qua osmnx | ODbL 1.0 | **62 toà**, phủ 23,3 % diện tích miền | OSM **thiếu nhà thấp**, rõ nhất ở khối phía nam (đối chiếu ảnh vệ tinh 29/09). Chưa đếm được số nhà thiếu |
| Chiều cao nhà | Google Open Buildings 2.5D Temporal | CC BY 4.0 / ODbL 1.0 | 62/62 toà lấy từ GOB; trung vị 23,2 m, max 91,0 m | Đối chứng OSM chỉ có ở 14 toà (`height`) và 13 toà (`building:levels`). Sai số GOB cho Việt Nam không được công bố (RESEARCH §12.3) |
| Đường | OSM `drive` | ODbL 1.0 | 67 cạnh / 6.395,5 m, có cấp đường | — |
| Mặt nước | OSM `natural=water`, `waterway`, `landuse=reservoir/basin` | ODbL 1.0 | **1 vùng**, 241 m² (`way/801710836`) — tải 06/10/2026 | Sông Sài Gòn nằm ngoài miền 500 m |
| Công viên / cây xanh | OSM `leisure=park/garden/…`, `landuse=grass/…`, `natural=wood/scrub/…` | ODbL 1.0 | **17 vùng**: 4 park, 4 garden, 4 grass, 5 scrub — tải 06/10/2026 | Phố đi bộ Nguyễn Huệ là `highway=pedestrian`, không phải lớp xanh |
| Địa hình | — | — | không dùng, giả định đất phẳng `z = 0` | Hạn chế đã ghi (spec Phụ lục B) |
| Basemap / ảnh nền | Esri World Imagery (chỉ hình kiểm tra) | điều khoản Esri, chỉ dùng hiển thị | 20 tile mức 18 trong `data/raw/imagery/` | Không phải lớp dữ liệu; không seed vào DB |

Hai lớp trên do `src/00_prepare_landcover.py` tải (tag ở `src/scene/landcover.py`), cắt theo
study area và giữ OSM id. Scene package (`src/07_export_scene.py`) ghi 62 nhà, 67 đường, 1 mặt
nước, 17 vùng xanh và 10.000 ô lưới. Kiểm tra chéo BR-35: diện tích các cột voxel rắn
(2.317 ô × 25 m² = 57.925 m²) bằng **99,5 %** diện tích footprint (58.235 m²).
