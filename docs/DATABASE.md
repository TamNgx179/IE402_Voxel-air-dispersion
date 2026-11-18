# Cơ sở dữ liệu — PostgreSQL/PostGIS

> **Trạng thái: v1, cách lưu nồng độ (spec BR-24/49) đã chốt ngày 06/10/2026.** Dẫn xuất từ
> [`spec.md`](spec.md) (BR-22..BR-27, *Hợp đồng v1 · D1*). Migration ở `db/migrations/` là
> nguồn sự thật khi đã có; tài liệu này phải được sửa trong cùng PR với migration.

## 1 · ERD

### Phạm vi hiện hành và nâng cấp đề xuất — 27/10/2026

Schema/migration hiện có vẫn là chuẩn triển khai; tài liệu không tạo migration mới.
Baseline dùng EPSG:32648 khi tính mét/diện tích; endpoint hiện chưa tổng quát hóa mọi CRS.
`concentration_columns` giữ một cột z cho từng ô XY. Phân tích vùng lấy diện tích giao
polygon–ô XY nhân chiều dày giao khoảng z, loại solid/null, sau đó mới tính trọng số thể
tích. Đây là phân tích khối voxel dù lưu geometry XY + array; không cần giả vờ mọi
phép toán đều gọi ST_3DIntersects. Xem [PostGIS 2D/3D](https://postgis.net/docs/ST_3DIntersects.html).

Giá trị chính xác nghĩa là số float đã nhập từ NetCDF, không phải mọi chữ số của nghiệm
liên tục. Không dùng uint8 visualization để aggregate. Mean vùng không phải trung bình
các mean tầng nếu thể tích khác nhau. Không khí có C=0 vẫn tính vào mẫu/thể tích; toàn
solid/no-data trả mean/max null, không phải 0. Công thức/fixture A8 tại spec BR-44–45.

Transect spec BR-46–48 **đã có route/repository A9.3**: tái dùng grid/cột nồng độ, tra ô
bằng origin/spacing theo miền nửa kín, trả mẫu theo khoảng cách dọc tuyến và tâm tầng.
Không cần thêm bảng cho từng lần vẽ; chỉ đọc không tạo run. Giới hạn số mẫu trước SQL,
parameterize dữ liệu và kiểm query plan/runtime trên dataset baseline. Không gọi tập
mẫu theo đường là thể tích; không nội suy mặc định hoặc nhân đôi thống kê do ô bị lấy lặp.

`TransectModel.projectLine` dùng PostGIS để chiếu tuyến và kiểm toàn tuyến nằm trong
study area; service tính khoảng cách dọc tuyến trong CRS mét, lấy mẫu đều gồm hai đầu.
`columns` dùng arrays tham số/ordinality và join khóa run/i/j để lấy slice mảng z và
solid range. Tối đa 20.000 mẫu vị trí × tầng; thiếu cột nồng độ trả no-data, thiếu grid
metadata hoặc có giá trị nồng độ trong solid trả 409. Giá trị float4 được cast float8
trước khi truyền JSON/CSV để tránh làm tròn qua dạng text của real.

Nghiên cứu khác lưới/khác mask không dùng guard comparison A8 hiện tại để lách hợp đồng;
phải thiết kế phép đối chiếu offline trên miền vật lý chung. LoD render không ghi DB,
không sửa height/mask. Nếu LoD2 đổi physics thì cần thiết kế version scene tương ứng
trước khi mở rộng schema, không mặc định đã hỗ trợ bằng dữ liệu height hiện tại.

Các SQL minh họa bên dưới giải thích thiết kế; repository và E2E mới xác nhận câu SQL
đang chạy. Benchmark SQL+fetch không là độ trễ HTTP đầu-cuối hoặc FPS của viewer.

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

`concentration_columns` nối với `grid_cells` khi truy vấn qua `(study_area_id, i, j)`.
`study_area_id` được suy ra từ `simulation_runs → scenarios` và không lưu lặp trong
bảng kết quả. Trigger kiểm giới hạn lưới, còn liên kết với từng hàng `grid_cells`
được thực hiện bằng phép JOIN.

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

`k` được tính ở API bằng lớp có tâm gần `z_m` nhất, với tâm lớp `k` là
`(k + 0.5) * dz`; chỉ số được chặn trong `[0, nz - 1]`. Mảng PostgreSQL đánh số từ 1 nên phần tử
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

Một DB demo dùng một revision dữ liệu. Khi đã có run, seed kiểm scene manifest,
grid và hash `config/project.yaml` trước khi quyết định. Nếu khớp, seed giữ nguyên
scene, kịch bản và ngưỡng. Nếu lệch, lệnh dừng và cần một DB hoặc Compose volume
mới. Quy tắc này giữ lưới và ngưỡng dùng cho truy vấn lịch sử qua đường seed.

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

### Quản trị và xem dữ liệu

CSDL là PostgreSQL 16 + PostGIS 3.4 trong container `db`. Từ máy host dùng cổng 5433
(đổi bằng `DB_HOST_PORT`); trong mạng Compose dùng host `db`, cổng 5432.

| Công cụ | Cách kết nối |
|---|---|
| `psql` trong container | `docker compose exec db psql -U ie402 -d ie402` |
| Adminer (web, tùy chọn) | `docker compose --profile tools up -d adminer` → http://127.0.0.1:8081, System *PostgreSQL*, Server `db`, user/pass `ie402` |
| pgAdmin / DBeaver / QGIS | Host `localhost`, port `5433`, database `ie402`, user/pass `ie402` |

Adminer chỉ chạy khi gọi profile `tools` và chỉ nghe trên 127.0.0.1. Thông tin đăng nhập trên
là mặc định dev; không dùng lại ở môi trường khác. Một số truy vấn kiểm tra nhanh:

```sql
SELECT version, applied_at FROM schema_migrations ORDER BY version;  -- migration đã chạy
SELECT status, count(*) FROM simulation_runs GROUP BY status;        -- trạng thái các run
SELECT postgis_full_version();                                        -- phiên bản PostGIS
```

Không sửa trực tiếp bảng kết quả (`concentration_columns`, `simulation_runs`) bằng công cụ
quản trị: run chỉ được ghi qua executor và import đã kiểm manifest. Thay đổi schema phải là
một file migration mới trong `db/migrations/`; migration đã áp dụng bị từ chối nếu file đổi.
Bộ test E2E dùng database riêng `ie402_test` và xóa schema của nó mỗi lần chạy.

## 6 · Kiểm kê dữ liệu dựng cảnh 3D (B1.4)

Đo ngày 06/10/2026 trên `data/` của pipeline chạy lại ngày 30/09. Study area **Nguyễn Huệ**,
tâm 10,7746° N 106,7035° E, 500 × 500 m, model CRS **EPSG:32648**.

| Lớp | Nguồn | Giấy phép | Hiện có | Khoảng trống |
|---|---|---|---|---|
| Footprint nhà | OSM qua osmnx | ODbL 1.0 | **62 toà**, phủ 23,3 % diện tích miền | OSM **thiếu nhà thấp**, rõ nhất ở khối phía nam (đối chiếu ảnh vệ tinh 29/09). Chưa đếm được số nhà thiếu |
| Chiều cao nhà | Google Open Buildings 2.5D Temporal | CC BY 4.0 / ODbL 1.0 | 62/62 toà lấy từ GOB; trung vị 23,2 m, max 91,0 m | Đối chứng OSM chỉ có ở 14 toà (`height`) và 13 toà (`building:levels`). Sai số GOB cho Việt Nam không được công bố (RESEARCH §4) |
| Đường | OSM `drive` | ODbL 1.0 | 67 cạnh / 6.395,5 m, có cấp đường | — |
| Mặt nước | OSM `natural=water`, `waterway`, `landuse=reservoir/basin` | ODbL 1.0 | **1 vùng**, 241 m² (`way/801710836`) — tải 06/10/2026 | Sông Sài Gòn nằm ngoài miền 500 m |
| Công viên / cây xanh | OSM `leisure=park/garden/…`, `landuse=grass/…`, `natural=wood/scrub/…` | ODbL 1.0 | **17 vùng**: 4 park, 4 garden, 4 grass, 5 scrub — tải 06/10/2026 | Phố đi bộ Nguyễn Huệ là `highway=pedestrian`, không phải lớp xanh |
| Địa hình | — | — | không dùng, giả định đất phẳng `z = 0` | Hạn chế đã ghi (spec Phụ lục B) |
| Basemap / ảnh nền | Esri World Imagery (chỉ hình kiểm tra) | điều khoản Esri, chỉ dùng hiển thị | 20 tile mức 18 trong `data/raw/imagery/` | Không phải lớp dữ liệu; không seed vào DB |

Hai lớp trên do `src/00_prepare_landcover.py` tải (tag ở `src/scene/landcover.py`), cắt theo
study area và giữ OSM id. Scene package (`src/07_export_scene.py`) ghi 62 nhà, 67 đường, 1 mặt
nước, 17 vùng xanh và 10.000 ô lưới. Kiểm tra chéo BR-35: diện tích các cột voxel rắn
(2.317 ô × 25 m² = 57.925 m²) bằng **99,5 %** diện tích footprint (58.235 m²).

## 7 · Benchmark truy vấn production FV

Đo ngày 09/10/2026 trên DB development, run mùa khô
`6c58daaf-7698-4cb9-8816-fd52568d56e7`, grid 100 × 100 × 50, verification pass.
Mỗi query có 3 warm-up và 20 mẫu; report local
`artifacts/query-benchmark-production.json` giữ provenance và `EXPLAIN (ANALYZE, BUFFERS)`.

| Query | p50 (ms) | p95 (ms) |
|---|---:|---:|
| Slice | 31,60 | 34,68 |
| Exceedance | 42,11 | 53,20 |
| Profile | 0,96 | 1,66 |
| Summary | 59,07 | 65,19 |

Profile dùng PK `(run_id,i,j)`; slice join theo run và grid. Exceedance/summary
chủ ý aggregate toàn volume **đã lọc run**, không yêu cầu mọi truy vấn phải dùng index.
Toàn relation concentration là 21.954.560 bytes, grid 5.136.384 bytes: DB chứa nhiều
run, không phải dung lượng một run. Đây là số đo máy demo, không phải SLA.

Tái lập: bật DB, migrate và seed nếu cần (không reset development DB), tạo/import
một baseline FV thành công. Trong `app/`, dùng run_id hiện có:

```powershell
$env:BENCHMARK_RUN_ID = '<run_id-FV-thanh-cong-tren-may>'
$env:BENCHMARK_OUTPUT = '../artifacts/query-benchmark-production.json'
npm run db:benchmark
```

Đọc provenance để phân biệt FV thật với mock; không lấy benchmark mock làm
kết quả khoa học. Lệnh solver và kiểm định xem [README – chạy và kiểm thử](../README.md).

## 8 · Truy vấn comparison/polygon A8

Không thêm bảng: dùng `concentration_columns(run_id,i,j)` và GiST của grid.
Pair yêu cầu cùng area/grid/scene/model, đủ columns/nz và null mask giống nhau.
Region dùng ST_Intersects chọn candidates, ST_Intersection/Area trong CRS mét
và độ dày giao khoảng z để tính trọng số; null solid không vào mẫu số.
Query luôn lọc run_id; CSV là truy vấn chỉ đọc và không tạo simulation_runs.

Đo ngày 19/10 trên development DB production grid 100×100×50, run
`2a3ab50e-2202-4b14-9209-3ab1fba4fd92`; 3 warm-up + 20 mẫu:

| Query | p50 (ms) | p95 (ms) |
|---|---:|---:|
| Comparison SQL self pair, tầng 1 m | 66,85 | 94,43 |
| Region SQL, vùng nội miền và khoảng 1–15 m | 203,09 | 221,38 |

Nguồn tái lập: `npm run db:benchmark:spatial` trong `app/`, report local
`artifacts/a8-spatial-benchmark.json` giữ geometry query, môi trường, units/grid,
hash/version và full EXPLAIN ANALYZE/BUFFERS. Đây là SQL timings gồm fetch rows,
không tính HTTP/mask validation/rendering; không phải SLA. Không suy từ
self-pair benchmark rằng đã so sánh khoa học hai scenario hoặc kiểm GPU/FPS.

Đo lại ngày 20/10/2026 trên cùng run/grid, 3 warm-up + 20 mẫu, không sửa DB:
comparison SQL self pair p50/p95 **124,94/146,43 ms**; region SQL
**267,66/302,32 ms**. Report cùng đường dẫn trên đã cập nhật. Chênh lệch thời gian
phản ánh môi trường/tải máy lúc đo, không phải thay đổi thuật toán hay SLA mới.
## Part 1 normalization and physical design audit

The audit uses the migration-defined keys and the single-scene seed policy. The
functional dependencies below describe the documented domain rules and identify
physical representations that need separate justification.

| Relations | Candidate key and dependency | 1NF–3NF assessment |
| --- | --- | --- |
| `study_areas` | Both `id` and `name` determine the scene metadata for this deployment. | The relational identifiers are scalar and the scene has a single owner. Grid and provenance JSON package structured values. The fixed projected SRID is redundant with the geometry type and is retained for the API contract. |
| `building_footprints`, `road_segments`, `water_features`, `green_features` | The generated `id` determines geometry, source identity and feature attributes. The same source identifier can occur in multiple road segments. | Under these dependencies the scalar attributes depend on the feature key. Study-area metadata lives behind the FK. Geometry is a PostGIS domain value. |
| `grid_cells` | `(study_area_id,i,j)` determines geometry and the solid interval. | No partial dependency is required for the cell attributes. Footprint geometry is physically materialized from the grid and indices for spatial lookup. |
| `scenarios`, `thresholds` | Scenario `id` determines its area and parameters. Threshold `key` determines the label, value and seed provenance. | Scalar catalogs use single-column keys. JSON parameters and the shared seed hash are explicit provenance/parameter representations. Threshold values are independent of the hash alone. |
| `simulation_runs`, `run_metrics` | Run `id` determines execution metadata; `run_id` determines metrics. Equal input hashes can belong to several runs. | Scenario is referenced by FK, metrics by PK/FK. The immutable input snapshot intentionally records the exact parameters used for reproduction. |
| `verification_checks`, `artifacts` | `(run_id,check_name)` and `(run_id,kind)` determine the check outcome and artifact metadata, respectively. | The recorded values depend on the whole key. Run metadata is kept in the run relation. |
| `concentration_columns` | `(run_id,i,j)` determines one dense altitude profile. Logical `(run_id,i,j,k)` determines one concentration. | The logical per-voxel relation is the normalized representation. The physical `real[]` is a deliberate packed layout for profile access. The migration validates one-based, nonempty arrays and complete solid intervals. The existing trigger checks length against `nz` and the horizontal bounds. |

Primary, foreign and unique keys already exist in the migrations. Validate geometric
type/SRID, scenario and run references, grid bounds, array shape and nullable
masks separately. The supported seed path locks run creation and refuses a
different seed revision after a run exists. The real-PostGIS API regression
checks that a changed config cannot overwrite the reference catalog. This policy
assumes catalog changes go through the seeder. Versioned scenes in a shared database
would require an explicit run-to-scene relationship.

| Query path | Existing index and reason |
| --- | --- |
| Slice, region and corridor overlay | GiST `grid_cells_geom_gist` filters projected XY candidates. Exact geometry tests and partial-height weights follow candidate selection. |
| Profile, transect samples and run comparison | `concentration_columns_pkey(run_id,i,j)` supports single profiles and run-bounded reads. `grid_cells_pkey(study_area_id,i,j)` supports the grid lookup. |
| Selected roads | `road_segments_study_area_idx` supports area filtering. The measured narrow and broad corridor plans scanned the small road relation. An additional compound index needs evidence on a larger scene. |
| Queue, historical runs and catalogs | `simulation_runs_status_created_idx` supports claim order and status filtering; scenario and input-hash indexes serve their respective lookups. |

Reproduce the production plan with `npm run db:benchmark:spatial` in `app/`
and set `BENCHMARK_RUN_ID` for a fixed non-mock run and `BENCHMARK_OUTPUT` for a
separate report. The report stores actual index definitions and sizes, request
parameters, returned rows, nearest-rank p50/p95 and JSON plans. Slice, profile
and transect use the same SQL constants as their models.
Transect SQL timings cover projection and the batched column query separately
from the sample generation and response assembly in NestJS.

The first corrected benchmark used FV run
`2a3ab50e-2202-4b14-9209-3ab1fba4fd92` on the 100 × 100 × 50 grid.

| Production SQL case | p50 (ms) | p95 (ms) |
| --- | ---: | ---: |
| Slice, viewport | 58 | 69 |
| Slice, full domain | 75 | 102 |
| Cell profile | 2.2 | 2.8 |
| Transect projection | 2.4 | 2.7 |
| Transect, 100 columns | 8.9 | 10.9 |
| Comparison with itself | 78 | 100 |
| Region | 267 | 564 |
| Corridor, one road | 41 | 76 |
| Corridor, 50 roads | 1,494 | 1,756 |

Both corridor plans used the grid GiST and concentration primary key. The broad
case visited about 11,655 grid candidates across three bands and expanded them
across the requested altitude range. Review that workload before adding a road
index. These measurements are SQL client timings with 20 samples and three
warmups, and should be repeated on the release revision.

## Đối chiếu lưới và benchmark 15/11/2026

Từ gốc lưới EPSG:32648 (686012,538 E và 1191324,79 N), với dx = dy = 5 m,
dz = 2 m, điểm (686015,038 E và 1191332,29 N) ở z = 15 m thuộc
`(i,j,k) = (0,1,7)`: tính floor của độ lệch chia cho bước lưới theo từng trục.
Lấy `c_ug_m3[8]` từ cột `(run_id,0,1)` do mảng PostgreSQL bắt đầu tại 1.
Một ô giao 10 m² ở mặt bằng và giao 1 m theo cao độ đóng góp 10 m³.
Phần thể tích thiếu dữ liệu được tính vào độ phủ và được loại khỏi mẫu nồng độ.

Mô hình logic dùng khóa `(run_id,i,j,k)`. Bảng lưu mảng có khóa vật lý
`(run_id,i,j)`, và dùng ràng buộc chỉ số bắt đầu tại 1. Lựa chọn lưu mảng
giảm số hàng cho truy vấn profile. Phạm vi chuẩn hóa được phân tích ở cấp
quan hệ logic. Cột mảng là đánh đổi vật lý được thiết kế cho dữ liệu 3D Array.

| Truy vấn mốc `6b27847` (PostGIS 3.4.3) | p50 (ms) | p95 (ms) |
| --- | ---: | ---: |
| Lát ngang toàn miền | 61,89 | 79,15 |
| Profile | 1,25 | 2,10 |
| Mặt cắt, truy xuất 100 cột | 6,64 | 8,60 |
| Vùng | 232,48 | 303,40 |
| Hành lang, 1 đường | 38,79 | 69,60 |
| Hành lang, 50 đường | 1.764,88 | 2.071,69 |

Đo SQL với 20 mẫu và 3 lượt làm nóng trên lượt mùa khô
`1502de2c-3d55-4698-8be8-549f307dc58e`. Xem tham số và execution plan trong
`query-benchmark.json` của bản chạy sạch. GiST lọc ứng viên mặt bằng.
Khóa chính kết quả phục vụ join `run_id,i,j`. Các thời gian này dành cho SQL.

Thử nghiệm A/B 10 lần trên cùng DB cho thấy dùng
[`ST_ContainsProperly`](https://postgis.net/docs/manual-3.4/ST_ContainsProperly.html)
để lấy diện tích nguyên ô khi ô nằm hoàn toàn bên trong dải làm giảm trung
vị từ 37,44 xuống 32,46 ms (1 đường) và từ 1.608,27 xuống 1.102,89 ms (50 đường).
Ô chạm biên vẫn qua `ST_Intersection`. Hình học trả về và tám trường số ở
cả hai ca khớp kết quả gốc. Không cần thêm chỉ mục cho thay đổi này.
