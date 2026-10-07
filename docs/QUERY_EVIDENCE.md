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
npm run db:benchmark > ../artifacts/query-benchmark.json
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
