# B8.1 — Xác nhận độc lập phép so sánh run và thống kê vùng

Ngày review: 01/11/2026 · Người review: B (khoa học/dữ liệu) · Đối tượng: phần A8.1–A8.4 của A
Phạm vi: định nghĩa trong `docs/spec.md` BR-44, BR-45, BR-48, BR-49, E-06, E-07, AC-36, AC-37;
code `app/src/modules/results/{repositories,services}/spatial-analysis.*.ts`;
fixture `app/test/spatial-analysis.e2e-spec.ts` và `app/test/fixtures/scene/grid_cells.csv`.

## 1. Cách kiểm

- B viết **bản tham chiếu riêng** `src/analysis/region_reference.py`, dựa vào spec, không chép SQL của A.
  Hình học: cắt polygon (có lỗ) với ô chữ nhật bằng Sutherland–Hodgman và tính diện tích bằng shoelace
  trong hệ toạ độ cục bộ. Bộ test so khớp với `shapely` trên 300 polygon lõm ngẫu nhiên, sai số ≤ 1e-9 m².
  Có mặt nạ solid **riêng** lấy từ scene, tách khỏi no-data (NaN) và khỏi giá trị 0.
- Test: `tests/test_region_reference.py` (30 test). Fixture chép từ e2e của A kèm file:dòng:
  `tests/fixtures/b8_1_a8_e2e_fixture.json`.
- Tính lại **mọi giá trị kỳ vọng số** trong e2e của A từ dữ liệu đầu vào thô, rồi so với bản tham chiếu.
- Không đối chiếu với API live được: Docker daemon không chạy (`docker ps` lỗi npipe), nên chưa có số liệu PostGIS thật.
- Môi trường: `.venv\Scripts\python.exe` **bị hỏng** vì trỏ tới `C:\Users\Admin\...\Python312`, đường dẫn này không có trên máy.
  B chạy bằng CPython 3.12.15 do uv quản lý, dùng `PYTHONPATH=.venv\Lib\site-packages`
  (numpy 2.5.3, shapely 2.1.2, pyproj 3.8.0, pytest 9.1.1). Không sửa venv.

## 2. Công thức đã chốt (định nghĩa của B)

Ô (i,j,k) chiếm hộp nửa kín `[x0+i·dx, x0+(i+1)·dx) × [y0+j·dy, …) × [k·dz, (k+1)·dz)`.

| Đại lượng | Định nghĩa |
|---|---|
| Trọng số voxel | `w = area(P ∩ ô_xy) × max(0, min(z_max,(k+1)dz) − max(z_min,k·dz))` |
| Tập hợp lệ | ô không khí (không solid theo scene) **và** có giá trị hữu hạn; 0 hợp lệ |
| Thể tích không khí | `V = Σ w` |
| Trung bình | `Σ w·c / V`; `null` khi V = 0 |
| Cực đại | `max c` trên các voxel có w > 0; `null` khi V = 0 |
| Thể tích vượt ngưỡng | `Σ w` với `c > ngưỡng` (ngưỡng tính chặt); bằng 0 khi V = 0 |
| Tổng nhiều tầng | cộng trực tiếp Σw, Σw·c; **không** lấy trung bình của các mean |
| Báo cáo thêm | thể tích solid và thể tích no-data giao với vùng, báo riêng |
| ΔC | `comparison − baseline` tại `k = floor(z/dz)`; giá trị float32 được nới sang float64 rồi mới trừ |
| Điều kiện so sánh | trùng study area, CRS, lưới (origin, dx, dy, dz, nx, ny, nz), phiên bản hình học scene, model và mặt nạ solid; trùng cả mẫu no-data (cùng chính sách thận trọng như A). Thiếu điều kiện nào thì từ chối trước khi tính |
| Thống kê ΔC trong một tầng | trung bình theo ô = trung bình theo thể tích, vì mọi ô trong một tầng cùng dx·dy·dz |

## 3. So sánh với cài đặt của A

| Tiêu chí B8.1 | Cài đặt A | Kết quả |
|---|---|---|
| Mean theo thể tích không khí | `REGION_SQL` `sum(c·volume)/sum(volume)` (`spatial-analysis.repository.ts:116`) | Khớp |
| Ô biên: diện tích giao XY × chiều dày giao z | `ST_Area(ST_Intersection)` × `greatest(0, least(zmax,o·dz) − greatest(zmin,(o−1)·dz))` (`:100-111`) | Khớp |
| Loại solid | Loại phần tử `NULL` (`:113`); solid **chỉ suy từ NULL** | Khớp nếu dữ liệu nhất quán; xem R1 |
| No-data khác 0 | Chỉ loại NULL, giữ 0 | Khớp (solid và no-data gộp chung, cả hai đều bị loại, đúng BR-44) |
| Không có ô khí → mean/max null, vượt ngưỡng 0 | `spatial-analysis.service.ts:178-193` | Khớp |
| Không lấy trung bình các mean khác trọng số | Mean tổng = `Σ mean_k·V_k / ΣV_k` (`service.ts:178-184`) | Khớp: tương đương đại số với Σw·c/Σw |
| ΔC = comparison − baseline | `b − a` (`repository.ts:93`) | Khớp |
| Chỉ so sánh khi tương thích | area, srid, scene_version, model, 8 tham số lưới (`service.ts:35-56`) và mẫu NULL giống nhau (`repository.ts:21-31`) | Khớp, xem R2 |
| Chỉ số tầng nửa kín | `Math.floor(z/dz)`, từ chối k ∉ [0,nz) (`service.ts:57-59`) | Khớp, xem R5 |

### Bảng tính lại giá trị kỳ vọng trong e2e của A

Các dòng dưới đây tính với ngữ nghĩa "solid = NULL", tức đúng cách API của A quyết định ô solid.

| Assertion (file:dòng trong `app/test/spatial-analysis.e2e-spec.ts`) | A kỳ vọng | B tính lại | Khớp? |
|---|---|---|---|
| :69-79 ΔC tại z=1, k=0, tâm tầng 1 m | [2, −2, 3] | [2, −2, 3] | Có |
| :80 mean ΔC | 1 | 1 | Có |
| :84 z=2.1 → k=1, tâm tầng 3 m | k=1, 3 | k=1, 3 | Có |
| :88-92 tự so sánh | 0/0/0 | 0/0/0 | Có |
| :95-98 run toàn 0 | 4 ô, mean 0 | 4 ô, mean 0 | Có |
| :105-107 float32 chính xác | fround(...) | float32→float64 | Có |
| :112-115 tầng toàn solid | 0 ô, mean null | 0 ô, null | Có |
| :191 area_m2 | 28 | 28 (round-trip WGS84: lệch < 1e-5) | Có |
| :192 air_volume_m3 | 20 | 20 | Có |
| :193 mean | 7.5 | 7.5 | Có |
| :194 max | 10 | 10 | Có |
| :195 vượt ngưỡng 15 | 0 | 0 | Có |
| :196-197 2 tầng, mean tầng 0 | 2; 10 | 2; 10 | Có |
| :205 vượt ngưỡng 7 | 10 | 10 | Có |
| :216-221 không có ô khí | V=0, null, null, layers [] | V=0, null, null; vượt ngưỡng 0 | Có (B giữ các hàng tầng với V=0, A trả []: chỉ khác cách trình bày) |
| :227-228 vùng toàn 0 | mean 0, V=32 | 0, 32 | Có |
| :247 polygon có lỗ | (3·4.9²−9)·2 = 126.06 | 126.059999998 (do biểu diễn nhị phân của 686000.1) | Có |

**Kết quả: 17/17 giá trị số khớp.** Không có công thức nào của A sai.

## 4. Rủi ro và điểm không nhất quán

**R1. Fixture e2e mâu thuẫn với mặt nạ solid của scene** (lỗi dữ liệu test, không phải lỗi công thức)

- Scene `app/test/fixtures/scene/grid_cells.csv:2` cho (0,0) solid ở k=0..2, còn `:5` cho (1,1) solid ở k=0..3.
  Theo `src/solver.py:205`, `solid_to_k` là cận bao gồm.
- Run baseline/comparison (`spatial-analysis.e2e-spec.ts:49-60`) lại có giá trị ở (0,0,k=2) và ở toàn bộ cột (1,1).
  Có 5 voxel mang giá trị nằm trong ô solid, đã kiểm ở `test_finding_a_fixture_values_contradict_scene_solid_mask`.
- Nếu tính theo mặt nạ scene, hai kỳ vọng sẽ khác:
  - `:79` sẽ là ΔC = [2, −2] chứ không phải [2, −2, 3].
  - `:247` sẽ là (2·4.9²−9)·2 = 78.04 chứ không phải 126.06.
- Lý do test vẫn PASS: `REGION_SQL`/`COMPARISON_SQL` chỉ dựa vào `NULL` và không đọc `grid_cells.solid_from_k/solid_to_k`.
- Trong khi đó module transect (`transect.service.ts:170-178`) lại dùng mặt nạ scene và phân biệt solid với no-data.
  Như vậy có hai định nghĩa solid khác nhau trong cùng module Results.
- Với production, `src/solver.py:581-582` ghi NaN đúng vào ô solid, nên hai cách cho cùng kết quả. Rủi ro chỉ xuất hiện khi dữ liệu import không nhất quán.
- Đề nghị A:
  - Sửa fixture: đặt NULL đúng chỗ scene solid, hoặc dùng scene khớp với run.
  - Hoặc nên làm thêm: lọc solid theo `grid_cells` trong REGION/COMPARISON SQL, hoặc kiểm NULL-mask = scene-mask khi import (`result-importer.ts` hiện chưa kiểm).

**R2. Kiểm tương thích mặt nạ chỉ so hai run với nhau** (`repository.ts:21-31`)
Hai run cùng sai so với scene vẫn được phép so sánh. Phần `scene_version` đã che được phần hình học. Mức: thấp.

**R3. BR-49 ở đầu solver, ngoài code của A** (`src/solver.py:299`)
- Cột DB được ghi bằng `f"{c:.6g}"`, tức 6 chữ số có nghĩa, trong khi NetCDF lưu float32 đầy đủ (`solver.py:585`).
- Mô phỏng trên 100.000 giá trị 1e-3..1e2 µg/m³: **96,6 %** giá trị DB khác float32 NetCDF, sai số tương đối lớn nhất 5,0e-6.
- Sai số này không đáng kể về khoa học, nhưng trái với câu chữ "DB bảo toàn giá trị đã lưu" của BR-49.
- Đề nghị ghi `.9g` (đủ để round-trip float32), hoặc nêu rõ giới hạn này trong spec.
- Test float32 của A (`:100-108`) chỉ kiểm đường DB → JSON, không kiểm NetCDF → DB.

**R4. Ngưỡng vượt dùng `>` chặt** (`repository.ts:118`)
B dùng cùng định nghĩa. Spec chưa ghi rõ `>` hay `≥`, nên đề nghị ghi vào BR-44/AC-36 để report và web không tự hiểu khác.

**R5. `Math.floor(z/dz)` với dz không nguyên** (`service.ts:57`)
Ví dụ z=0,6, dz=0,2 cho k=2 thay vì 3 do sai số dấu phẩy động. Lưới hiện tại có dz = 2 m nên không gặp. Nếu sau này đổi dz (B8.2), nên dùng dung sai hoặc số nguyên cm.

**R6. Polygon được kiểm "nằm trong miền" ở EPSG:4326, nhưng tính toán ở EPSG:32648** (`repository.ts:54-61`)
Sát biên có thể lệch rất nhỏ. Ngoài ra không có kiểm `Σ diện tích giao ô = area_m2`: nếu study area rộng hơn lưới, phần ngoài lưới sẽ bị bỏ qua mà không báo. Seed hiện tại có study area trùng lưới nên chưa xảy ra.

**R7. Không tách được solid với no-data trong vùng**
`air_voxels`/`air_volume_m3` không cho biết bao nhiêu thể tích bị loại vì solid và bao nhiêu vì thiếu dữ liệu. Đây không phải yêu cầu bắt buộc của BR-44. Bản tham chiếu của B có báo riêng hai đại lượng, A có thể cân nhắc bổ sung.

## 5. Kết luận

**PASS có ghi chú (PASS with notes).**

- Công thức trọng số thể tích, xử lý ô biên XY/z, loại solid/no-data, giữ 0, null khi không có không khí, ΔC = comparison − baseline và điều kiện tương thích đều đúng như spec.
- 17/17 giá trị kỳ vọng của A được B tính lại độc lập và khớp.
- Lỗi cần A sửa trước khi chốt XG-2: **R1**. Fixture e2e đang trái với mặt nạ scene, nên chưa kiểm được việc "loại solid theo scene". Hai kỳ vọng ở `:79` và `:247` chỉ đúng khi bỏ qua scene.
- R3 thuộc phía solver: báo cho chủ của `src/solver.py`. R2, R4–R7 là rủi ro mức thấp hoặc cần làm rõ trong tài liệu.
- Chưa đối chiếu với PostGIS live vì DB không chạy. Nếu cần, chạy lại `npm run test:e2e` trong `app/` khi Docker sẵn sàng.

Chạy lại test của B:
`python -m pytest tests/test_region_reference.py -q`. Nếu venv hỏng, dùng Python 3.12 bất kỳ với `PYTHONPATH=.venv\Lib\site-packages`.
Kết quả: 30 passed; toàn bộ suite collect được 277 test, không lỗi.

## Tiếp nối 01/11/2026 — đóng R1 và kiểm tra precision

Phần review phía trên giữ nguyên làm lịch sử. Tiếp nối thực hiện theo yêu cầu A8.1/B8.1:

- Fixture PostGIS và fixture tham chiếu B nay cùng mask scene: (0,0) k=0..2 và (1,1) k=0..3 là NULL. Test hồi quy bắt mọi fixture có giá trị trong solid.
- Hai kỳ vọng được sửa theo dữ liệu đúng: delta [2, -2], mean delta 0; thể tích polygon có lỗ 78,04 m³. Ca số 0 hợp lệ dùng polygon trong ô không khí, vẫn V=32 m³. Không đổi scene/mask để hợp thức hóa fixture sai.
- REGION_SQL/COMPARISON_SQL lọc thêm mask scene (cận k bao gồm); test cố ý đưa nồng độ vào solid chứng minh không tính nhầm vào không khí. Đây là lớp phòng vệ query, không phải xác nhận importer đã từ chối mọi bundle sai mask.
- Đo lại query trên lưới production 100×100×50: comparison p50/p95 = 121,6/160,3 ms; region = 249,2/308,6 ms. Số đo tại máy ngày 01/11, không phải SLA; plan/log ở `artifacts/a8-spatial-benchmark.json`.
- R4 chốt dấu > trong BR-44 và test bằng ngưỡng. Reference Python 30/30; spatial E2E 23/23; toàn bộ PostGIS E2E bắt buộc 98/98, 0 skip (`artifacts/a7-api-e2e.json`). R1 không còn chặn XG-2.
- R3 đã sửa writer: ép cùng float32 như NetCDF trước `.9g`. Test 10.005 giá trị round-trip trùng bit; trước sửa 9.661 giá trị khác bit. Profile/slice/summary/volume repository chuyển float4 sang float8 trước trả API.
- Hai run FV thật mùa khô/mưa được tạo trong DB test, đọc NetCDF độc lập bằng Python rồi đối chiếu toàn bộ profile và slice API. Không dùng số đã làm tròn từ DB làm giá trị tham chiếu.
- Không tái sinh hoặc ghi đè production run/artifact cũ. Run cũ qua `.6g` giữ nguyên giới hạn lịch sử; muốn bộ kết quả precision mới cần tạo run mới, giữ ID/hash riêng.

R5 (dz thập phân khác production), R6 (sát biên CRS/coverage) và R7 (tách thể tích solid/no-data trong báo cáo vùng) vẫn là giới hạn/đề xuất, không được diễn giải là đã triển khai. Nghiệm thu release toàn bộ thuộc A10/B10.
