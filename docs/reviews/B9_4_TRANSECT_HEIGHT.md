# B9.4 — Review độc lập mặt cắt đứng (A9.3), phân tích cao độ và chất lượng hình học

Người review: B (khoa học/dữ liệu). Ngày: 2026-11-01. Phục vụ cổng `XG-6`.
Nguyên tắc: không coi test của A là B ký duyệt. B viết lại bộ lấy mẫu từ spec
(BR-46…BR-49, E-18, AC-38), không dùng code của A, rồi mới đối chiếu.

**Kết luận: PASS có ghi chú.** Không có sai lệch nào làm sai số liệu khoa học
trên lưới hiện tại (z0 = 0, dz đều, mask LoD1 liền từ mặt đất). Còn 2 ghi chú
mức trung bình (độ chính xác lưu DB so với NetCDF, giả định z0 = 0) và vài ghi
chú nhỏ về test/UI. Chất lượng chiều cao nhà có một hạn chế khoa học đáng kể
(GOB thấp hơn nhiều so với tag OSM ở các tháp cao), cần đưa vào báo cáo.

## 1. Đã kiểm những gì

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| Bộ lấy mẫu tham chiếu độc lập | `src/analysis/transect_reference.py` (pyproj, numpy), viết từ spec | xong |
| Test tham chiếu | `tests/test_transect_reference.py`, 19 test | **19 passed** |
| Số kỳ vọng trong fixture e2e của A | Dựng lại đúng fixture 2×2×4 (`app/test/fixtures/scene`, các cột trong `transect.e2e-spec.ts:41-46`), chạy bằng bộ tham chiếu | Khớp toàn bộ (mục 3) |
| Logic TypeScript của A | Đọc `transect.service.ts`, `transect.repository.ts`, DTO, schema, controller, `web/viewer-transect.js`; chuyển vòng lặp lấy mẫu của A sang Python từng dòng và so khác biệt với bộ tham chiếu trên 300 tuyến ngẫu nhiên ở lưới thật 100×100×50 (1/3 số tuyến có đỉnh nằm đúng trên mặt ô) | 0 khác biệt về số vị trí, chainage, x/y (sai số ≤1e-6 m), i/j, tầng và các trường hợp bị từ chối |
| E2E của A với PostGIS | Không chạy được: Docker daemon không chạy trên máy review (`docker ps` lỗi). Test e2e tự `skipIf` khi không có DB | **chưa chạy lại**, chỉ review tĩnh |
| Nhất quán cảnh ↔ kết quả | So `db/seeds/scene/grid_cells.csv` (solid_from_k…solid_to_k), `data/processed/voxel_grid.nc` (B) và NaN trong `concentration.nc` của run thật | Trùng khớp tuyệt đối |
| Phân tích cao độ/tầng | Run FV `78fa0ad4-4038-495a-b671-172fae2fcf63` (dry_nov_apr, verification `pass`, steady_state residual 9,5e-5) | `layer_stats.csv`, `height_1p5_vs_15m.csv`, hình |
| Nguồn chiều cao | `data/processed/buildings_with_height.geojson`, `db/seeds/scene/buildings.csv` | `height_sources.csv` |

Môi trường: `.venv` của repo trỏ tới Python của người dùng khác
(`C:\Users\Admin\...`) nên không chạy được; B dùng một venv tạm Python 3.13
ngoài repo (numpy, xarray, netCDF4, pyproj, matplotlib, pytest). Lệnh chạy lại:
`python -m pytest tests/test_transect_reference.py -q`.

## 2. Quy tắc bộ tham chiếu (theo spec)

- LineString WGS84 [lon, lat], 2–100 đỉnh, chiếu sang CRS lưới (EPSG:32648) trước khi đo chiều dài.
- Bước mặc định min(dx, dy) = 5 m; bước người dùng phải 0 < step ≤ 5 m.
- N = ceil(L/step) khoảng đều theo chiều dài chiếu tích lũy qua các đỉnh; lấy N+1 vị trí, có cả hai đầu; bước thực L/N ≤ step.
- Ô chứa theo khoảng nửa kín [x0, x1), [z0, z1); mặt trong thuộc ô bắt đầu tại đó (2 m → tầng k=1, tâm 3 m); mặt ngoài Đông/Bắc/đỉnh (100 m) ngoài miền. Chỉ "snap" nhiễu round-trip ≤1e-9 ô.
- Không nội suy; trả cả độ cao yêu cầu (overlap của dải) và tâm tầng (k+0,5)·dz.
- `solid` lấy từ mask cảnh, không suy từ C = 0; `no_data` là giá trị thiếu/không hữu hạn ở ô khí; 0 là giá trị hợp lệ. Giá trị hữu hạn trong ô rắn → xung đột (409).
- Giới hạn (N+1) × số tầng ≤ 20.000, kiểm trước khi đọc nồng độ (E-18; có test chứng minh không đọc mảng).
- Đảo tuyến → đảo thứ tự mẫu, cùng vị trí/giá trị, d + d' = L.

## 3. Đối chiếu số kỳ vọng của A (fixture C = 2 + 3z)

Fixture: lưới 2×2×4, dx = dy = 5 m, dz = 2 m, tâm tầng 1/3/5/7 m → C = 5/11/17/23.

| Ca e2e của A | Kỳ vọng của A | Bộ tham chiếu B | Ghi chú |
|---|---|---|---|
| Tuyến 3 m, z 0–3 | 2 mẫu, (i,j)=(1,0), tầng k0 [0,2) tâm 1, k1 [2,3) tâm 3; C = 5, 11 | giống hệt | 11 là giá trị tâm 3 m, không phải 2+3·2,5 → không nội suy |
| Tuyến y=7,5, x 0,5→9,5 | mẫu đầu (0,1): 0 `air`, null `no_data`; mẫu cuối `solid` | giống; 3 mẫu (0,1),(1,1),(1,1) | |
| x = 686005 (mặt trong) / x = 686010 (mặt ngoài) | i=1 / 400 | giống | |
| Tuyến gấp khúc 8+8 m và đảo chiều | L=16, vị trí/ô/giá trị đảo đúng | giống; 5 mẫu (ceil(16/5)=4 khoảng) | |
| step = 1 m | ≥4 mẫu, hai đầu | đúng 4 mẫu | A chỉ assert `>= 4` (lỏng) |
| step = 1e-10 | 400 "20.000" | từ chối | |
| Giá trị trong ô rắn | 409 | `TransectConflict` | |

Lưu ý: fixture không thuần C = 2+3z: ô (1,0,k2) = 0 và (0,1,k0) = 0 là số 0 cố ý để kiểm "0 hợp lệ". B kiểm mọi giá trị hữu hạn khác 0 đều bằng 2+3·z_tâm.

## 4. Sai lệch và ghi chú (file:dòng)

Không có sai lệch làm sai kết quả trên dữ liệu hiện tại. Các điểm dưới đây xếp theo mức độ.

**Trung bình**

1. `src/solver.py:299` — `columns.csv.gz` (nguồn nhập DB, dùng cho mặt cắt/CSV) ghi giá trị bằng `f"{c:.6g}"` từ trường float64, còn `concentration.nc` lưu float32. Đo trên run 78fa0ad4: chênh tuyệt đối tối đa 5,4e-7 µg m⁻³, tương đối tối đa 5,0e-6; vị trí NULL/NaN khớp 100%. BR-49 nói DB "bảo toàn giá trị đã lưu" — đúng với chuỗi DB→JSON, nhưng giá trị DB **không trùng bit** với NetCDF. Không ảnh hưởng khoa học (nhỏ hơn nhiều sai số mô hình), nhưng mọi đối chiếu "CSV mặt cắt = NetCDF" phải dùng dung sai tương đối ~1e-5, hoặc sửa writer sang `.9g` (đủ round-trip float32). Không thuộc file A9.3; chuyển chủ sở hữu solver.
2. `app/src/modules/results/services/transect.service.ts:107-108, 119-121` — chọn tầng và tâm tầng dùng `z / dz` và `(k+0,5)·dz`, tức giả định đáy miền z0 = 0 và dz đều; `GridSchema` (`schemas/simulation-result.schema.ts:1-10`) không có trường gốc z. Đúng với cấu hình hiện tại (`config/project.yaml` vertical.min_m = 0, `voxel_grid.nc` domain_z_min_m = 0). Nếu sau này đổi z0 hoặc lưới giãn theo chiều đứng thì kết quả sai âm thầm. Đề nghị ghi giả định này vào spec hoặc thêm guard.

**Nhỏ**

3. `transect.service.ts:46-55` — chỉ nhận dải [z_min, z_max) với z_min < z_max; không có chế độ "một độ cao". BR-48 vẫn thỏa: 2 m là đáy dải → tầng k1; 100 m không thể là z_min; z_max = 100 được nhận như cận trên mở (đúng nửa kín). Bộ tham chiếu B có thêm chế độ một độ cao để kiểm BR-48 trực tiếp.
4. `transect.service.ts:99-102` — từ chối hai đỉnh liên tiếp trùng nhau; BR-46 không quy định. Web đã lọc điểm trùng (`web/viewer-transect.js:323`), nên chấp nhận được; bộ tham chiếu B bỏ qua đoạn dài 0 thay vì từ chối. Khác biệt chỉ ở trường hợp tuyến vẽ thủ công qua API.
5. `transect.service.ts:109` — `Math.ceil(length/step)` không có dung sai; nếu L là bội đúng của step nhưng có nhiễu round-trip CRS +1e-9 m thì thêm 1 khoảng (ví dụ 3 → 4 khoảng). Vẫn thỏa "bước ≤ step", chỉ đổi số mẫu ±1 và có thể lật ngưỡng 20.000 ở đúng biên. Bộ tham chiếu có cùng hành vi (để so sánh được); test `transect.e2e-spec.ts:172` dùng `>= 4` có lẽ vì lý do này.
6. `web/viewer-transect.js:389` — tooltip chọn tầng bằng khoảng đóng `z >= overlap_min && z <= overlap_max`, nên chuột đúng mặt 2 m chỉ tầng dưới (trái quy tắc nửa kín). Chỉ ảnh hưởng hiển thị, không ảnh hưởng số liệu/CSV.
7. `web/viewer-transect.js:248-275` — vẽ mỗi ô theo dải overlap, nhưng giá trị là của tâm tầng; với dải hẹp (ví dụ 0–0,5 m) tâm 1 m nằm ngoài phần được tô. Đúng nghĩa "giá trị ô chứa", nhưng caption/hình báo cáo nên ghi rõ "giá trị tâm ô".
8. `transect.service.ts:172-176` — trạng thái solid suy từ một khoảng liên tục `solid_from_k..solid_to_k`. B kiểm trên cảnh thật: mọi cột rắn liên tục từ k=0 (LoD1 đùn từ mặt đất), mask cảnh = `voxel_grid.nc` B = NaN của run (41.084 voxel rắn, 0 giá trị hữu hạn trong ô rắn, 0 NaN trong ô khí) → không có 409 giả trên dữ liệu thật. Giả định này sẽ hỏng nếu có LoD2/mái đua (liên quan B9.5).
9. Khoảng trống test của A (`app/test/transect.e2e-spec.ts`): không có ca z_min đúng mặt trong (2 m), không có dải chạm đỉnh miền (z_max = 8 trong fixture), không có ca ở đúng ngưỡng 20.000 (chỉ 1e-10). Bộ tham chiếu B đã phủ ba ca này.
10. Spec không có nhãn "TC-CUT"; tiêu chí tương ứng là `E-18` và `AC-38` (`docs/spec.md:121, 179`). Roadmap B9.4 nhắc "E/TC-CUT" — nên thống nhất nhãn.

## 5. Chất lượng chiều cao và hình học

Bảng `height_sources.csv` (62 nhà, cảnh Nguyễn Huệ):

| Hạng mục | Số nhà | Tỷ lệ |
|---|---|---|
| Chiều cao cuối dùng Google Open Buildings 2.5D | 62 | 100% |
| Chiều cao từ tag OSM `height` | 0 (14 nhà có tag, chỉ dùng đối chiếu) | 0% |
| Chiều cao từ `building:levels` × 3 m | 0 (13 nhà có tag) | 0% |
| Fallback (trung vị/cố định) | 0 | 0% |
| Nhà < 1 m (không tạo voxel với quy tắc tâm ô, dz = 2 m) | 2 (0,5 m; 0,5 m) | 3,2% |

Đối chiếu GOB − OSM: với tag `height`, trung vị −5,5 m, trung vị |Δ| 6,25 m, tối đa |Δ| 102 m; với `levels`×3 m, trung vị +3,5 m, trung vị |Δ| 14 m, tối đa 71,5 m. Chênh lớn tập trung ở tháp cao: OSM 164,9 / 154 / 186 m trong khi GOB 62,5 / 88,5 / 91 m. Tức là GOB **thấp hơn rõ rệt ở nhà cao tầng**, và kể cả nếu dùng OSM thì đỉnh miền 100 m cũng sẽ cắt các tháp này. Nhà thấp/trung bình khớp trong vài mét.

Raster hóa (quy tắc tâm ô, `src/voxel/rasterizer.py`): 2.323 cột có H > 0, 2.317 cột có voxel rắn (6 cột H < 1 m mất hẳn). Đỉnh voxel − H: trung bình −0,39 m, trong [−1,0; +0,5] m, 100% cột |sai số| ≤ dz/2 = 1 m — đúng lý thuyết lượng tử hóa.

## 6. Phân tích theo tầng (run FV 78fa0ad4)

Chi tiết đủ 50 tầng ở `layer_stats.csv`; hình `b9.4_vertical_quality.png`.

| Độ cao yêu cầu | Tầng k | Tâm ô | Tỷ lệ ô khí | Trung bình | Trung vị | P95 | Max (µg m⁻³) |
|---|---|---|---|---|---|---|---|
| 1,5 m | 0 | 1 m | 76,8% | 0,200 | 0,161 | 0,515 | 0,890 |
| 15 m | 7 | 15 m | 82,1% | 0,0628 | 0,0592 | 0,152 | 0,323 |

- Trung bình tầng 15 m bằng 0,31 lần tầng 1,5 m. So từng cột khí ở cả hai độ cao (7.683 cột): trung vị tỷ số C15/C1,5 = 0,31; chỉ 1,4% cột có C ở 15 m cao hơn ở 1,5 m (chưa phân tích vị trí các cột này; giả thuyết là vùng khuất gió sau nhà, cần kiểm thêm).
- Nồng độ giảm đơn điệu theo z: trung bình 1,5e-6 µg m⁻³ ở tâm 99 m; tỷ lệ ô khí tăng từ 76,8% (k0) lên 100% từ tầng k45 [90, 92) trở lên (nhà cao nhất 91 m chiếm tới k44).
- Lưu ý: "1,5 m" là độ cao yêu cầu, giá trị đọc là tâm tầng 1 m của tầng [0, 2); "15 m" rơi đúng tâm tầng [14, 16).
- Mặt cắt tham chiếu thật (panel c, `transect_reference_real_run.csv`): tuyến gấp khúc 531 m qua cột cao nhất (H = 91 m), 108 vị trí × 30 tầng = 3.240 mẫu, bước thực 4,96 m; 2.972 ô khí, 268 ô rắn, 0 no_data; đảo tuyến cho đúng ô/giá trị ngược thứ tự.

## 7. Diễn giải khoa học (theo dữ liệu)

- Phép lấy mẫu mặt cắt của A cho cùng ô, cùng chainage và cùng trạng thái với bộ tham chiếu độc lập; khác biệt duy nhất về số là sai số làm tròn 6 chữ số khi xuất cột (≤5e-6 tương đối), nhỏ hơn rất nhiều bậc so với độ bất định của mô hình (gió chẩn đoán, phát thải proxy, chưa kiểm định quan trắc). Không có cơ sở để coi chênh này là khác biệt vật lý.
- Gradient đứng mạnh (giảm ~3,2 lần từ 1 m lên 15 m, trung vị theo cột) phù hợp với nguồn giao thông ở mặt đất và hệ số khuếch tán của run; đây là kết quả của mô hình với một kịch bản gió, không phải phép đo, không suy ra phơi nhiễm thực.
- Do GOB thấp hơn OSM ở tháp cao, vùng sau các tháp này có thể đang bị mô hình hóa với vật cản thấp hơn thực tế; kết luận ở độ cao > ~60 m quanh các tháp kém tin cậy hơn ở tầng thấp. Ở tầng 1,5–15 m ảnh hưởng nhỏ hơn vì nhà vẫn chặn đủ các tầng này.
- Sai số lượng tử hóa chiều cao ≤1 m (dz/2) là giới hạn lưới, không phải lỗi dữ liệu.

## 8. Hạn chế của review

- Chưa chạy lại e2e PostGIS của A (không có Docker); phép chiếu PostGIS (`ST_Transform`) có thể khác pyproj ở mức ~1e-9 m — chỉ ảnh hưởng điểm nằm đúng mặt ô, cả hai bên đều có snap.
- Phần so sánh với A dựa trên bản chuyển ngữ Python của vòng lặp TS; nếu code A đổi thì cần chạy lại.
- Phân tích tầng chỉ trên một run (dry_nov_apr); chưa lặp cho wet và cho các run lưới khác (B9.1).
- Chưa có dữ liệu quan trắc theo độ cao để kiểm định gradient đứng.

## 9. Bàn giao

- Cho A9.5/báo cáo: dùng `height_sources.csv` cho bảng nguồn chiều cao (ghi rõ 100% GOB, 0 fallback, chênh OSM ở tháp cao); dùng hình và `height_1p5_vs_15m.csv` cho mục chiều đứng; caption ghi "giá trị tâm ô, không nội suy".
- Cho chủ sở hữu solver: cân nhắc `.9g` ở `src/solver.py:299` (ghi chú 1).
- Cho spec: ghi giả định z0 = 0/dz đều (ghi chú 2), thống nhất nhãn TC-CUT ↔ E-18/AC-38 (ghi chú 10).

## Tệp

- `src/analysis/transect_reference.py`, `tests/test_transect_reference.py`
- `artifacts/b9.4-review/height_sources.csv`, `layer_stats.csv`, `height_1p5_vs_15m.csv`, `transect_reference_real_run.csv`, `b9.4_vertical_quality.png`, `REVIEW.md`
