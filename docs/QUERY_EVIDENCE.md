# Bằng chứng truy vấn kết quả — A5.5/A5.6

## Phạm vi đo

Bốn nhóm truy vấn bắt buộc dùng cùng một run `succeeded`:

1. slice theo `z_m` và bbox;
2. vùng/thể tích vượt ngưỡng;
3. profile đứng tại cột `(i,j)`;
4. summary theo tầng.

API triển khai tại `app/src/modules/results/`. Tensor đầy đủ vẫn ở NetCDF; PostgreSQL chỉ lưu
10.000 cột/run, mỗi cột là mảng `real[nz]`.

## Cách tái tạo

```powershell
docker compose up -d db
cd app
npm run db:migrate
npm run db:seed
# tạo ít nhất một run thành công qua POST /api/runs
$env:BENCHMARK_RUN_ID = '3f5ca60f-2129-4769-8b21-146f6703e2e1'
$env:BENCHMARK_OUTPUT = '../artifacts/query-benchmark-a5.json'
npm run db:benchmark
```

`db:benchmark` chạy warm-up 3 lần, đo 20 lần cho từng query, xuất p50/p95 và
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. File bằng chứng phải giữ `run_id`, thời điểm đo và
execution plan; không chép số ước lượng vào báo cáo.

## Điều kiện PASS

- Slice/profile dùng prefix của PK `concentration_columns(run_id,i,j)` hoặc join có điều kiện
  `run_id`; spatial bbox dùng GiST `grid_cells_geom_gist` khi planner thấy có lợi.
- Không có sequential scan toàn bộ nhiều run do thiếu điều kiện `run_id`.
- Báo cáo p50/p95 trên đúng dataset demo 100 × 100 × 50.
- Kết quả API và SQL có cùng `run_id`, `z_m`, threshold và đơn vị `ug m-3`.

## Kết quả đo trên máy demo

Đo lúc **07/10/2026 15:21 ICT**, run
`3f5ca60f-2129-4769-8b21-146f6703e2e1`, 20 mẫu/query sau 3 lần warm-up và `ANALYZE`:

| Query | p50 (ms) | p95 (ms) | Rows/đặc điểm plan |
|---|---:|---:|---|
| Slice tầng 1 | 17,73 | 22,23 | 7.683 ô; hash join hai tập 10.000 rows |
| Exceedance toàn volume | 41,36 | 56,13 | chủ ý quét/unnest 500.000 voxel |
| Profile `(0,0)` | 1,09 | 1,35 | index scan bằng PK `(run_id,i,j)` |
| Summary 50 tầng | 147,06 | 178,85 | chủ ý aggregate 500.000 voxel, không spill ra disk |

Dung lượng relation gồm table và index: `concentration_columns` **3.203.072 bytes** cho 10.000
cột của run; `grid_cells` **2.727.936 bytes** cho 10.000 ô. Các query đều có điều kiện
`run_id`; sequential scan trong slice/exceedance/summary là lựa chọn hợp lý khi dataset hiện chỉ
có một run và truy vấn cần phần lớn hoặc toàn bộ 10.000 cột. Profile chọn đúng primary-key index.

Môi trường: Intel Core i5-12500H, RAM 15,7 GB, Node 22.16.0, PostgreSQL 16.4, PostGIS 3.4.3,
Docker Desktop. Run dùng `SOLVER_MODE=mock` để đo đường dữ liệu/API/DB; các con số này **không**
được dùng làm kết quả khoa học của mô hình. Script `db:benchmark` là nguồn tái lập số đo và full
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.

## Bổ sung A5 — 09/10/2026

Build/lint đạt; unit: **87 pass, 1 skip**; DB/API/executor E2E: **42 pass**.
Real executor E2E chạy Python wind/FV trên fixture nhỏ rồi đối chiếu profile và slice
với mảng nồng độ trong PostgreSQL; area = count × 25 m², volume tầng = count × 50 m³.
Retry được kiểm tra không nhân đôi 4 concentration columns hoặc 1 metrics record.
Kiểm thử cao độ gồm 0, 1,99, 2, 7,99 m; 8 m bị từ chối trên fixture cao 8 m.
`requested_z_m` là yêu cầu, `z_center_m`/legacy `z_m` là tâm ô. Bbox sai geographic range,
đảo biên và threshold xung đột bị từ chối.

Đo lại run synthetic trên lúc **10:00 ICT**, cùng grid 100 × 100 × 50:

| Query | p50 (ms) | p95 (ms) |
|---|---:|---:|
| Slice | 33,77 | 39,47 |
| Exceedance toàn miền | 37,90 | 57,02 |
| Profile | 0,96 | 1,83 |
| Summary | 60,30 | 69,78 |

Profile dùng PK index; slice dùng nested loop/index join; exceedance/summary chủ ý
aggregate cả volume đã lọc run. Dung lượng **toàn relation** concentration là 12.582.912
bytes và grid là 5.136.384 bytes; DB hiện chứa nhiều run, không phải dung lượng riêng
một run. Full report local: `artifacts/query-benchmark-a5.json` (generated artifact,
không commit); script ghi model/version/input_hash/warnings/grid để không nhầm synthetic
với kết quả khoa học. Benchmark production bổ sung bên dưới thay thế khoảng trống này.

## Production FV B5 — 09/10/2026

Run khô `6c58daaf-7698-4cb9-8816-fd52568d56e7`, 500.000 voxel, steady-state,
verification pass và warnings không chứa mock. 20 mẫu/query sau 3 warm-up,
`EXPLAIN ANALYZE` và provenance: `artifacts/query-benchmark-production.json`.

| Query | p50 (ms) | p95 (ms) |
|---|---:|---:|
| Slice | 31,60 | 34,68 |
| Exceedance | 42,11 | 53,20 |
| Profile | 0,96 | 1,66 |
| Summary | 59,07 | 65,19 |

Toàn relation concentration 21.954.560 bytes, grid 5.136.384 bytes: DB có nhiều run,
không gán con số này cho dung lượng một run. Đo trên DB development, không phải SLA.
Bằng chứng solver/science và nguồn dữ liệu: [B5_B6_EVIDENCE.md](./B5_B6_EVIDENCE.md).
