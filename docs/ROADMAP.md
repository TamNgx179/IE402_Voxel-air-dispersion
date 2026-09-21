# ROADMAP — 8 tuần, 2 người, sản phẩm cuối là ứng dụng web 3D

**Ràng buộc:** 2 người · numpy mức cơ bản · 8 tuần lịch · bán thời gian (~4 người-ngày/tuần, ~32 tổng)
**Phạm vi đã cắt:** xem [`DECISION.md`](DECISION.md) §0
**Giả định về seminar:** gói seminar sẵn sàng cuối tuần 4. Seminar rơi vào tuần khác thì dịch Giai đoạn 1, giữ nguyên thứ tự và giữ cổng quyết định ở M3.

---

## 1. Sản phẩm cuối

Một **ứng dụng web 3D** chạy trong trình duyệt, hiển thị trường nồng độ ô nhiễm trên mô hình thành phố voxel.

| Mã | Tính năng | Bắt buộc |
|---|---|---|
| W1 | Bản đồ nền + toà nhà 3D (extrude từ footprint) | Có |
| W2 | Trường nồng độ hiển thị theo từng tầng độ cao | Có |
| W3 | **Thanh trượt chọn độ cao z (1,5 → 100 m)** | Có — quan trọng nhất |
| W4 | Chuyển kịch bản gió (ĐB mùa đông ↔ ĐN mùa hè) | Có |
| W5 | Bật/tắt ngưỡng QCVN 50 và WHO 15 µg/m³ | Có |
| W6 | Click một điểm → hiện profile đứng | Nên có |
| W7 | Panel số liệu: thể tích vượt ngưỡng, trung bình theo tầng | Nên có |
| W8 | Isosurface 3D | Nếu dư thời gian |

**W3 là tính năng mang toàn bộ luận điểm của đồ án.** Kéo thanh trượt là thấy ngay nồng độ đổi theo độ cao — chứng minh trực tiếp "phải 3D" ngay trên sản phẩm, không cần giải thích bằng lời.

### Công nghệ

**Chốt: deck.gl + MapLibre, một file HTML, load qua CDN, không có bước build.** Không npm, không webpack, không Node.

| Phương án | Chi phí | Quyết định |
|---|---|---|
| deck.gl + MapLibre, 1 file HTML | ~5 người-ngày | **Chọn** |
| CesiumJS + 3D Tiles | ~8 | Loại — `VoxelPrimitive` là extension draft, Cesium ghi rõ có thể đổi bất cứ lúc nào |
| Three.js thuần | ~6 | Loại — phải tự làm bản đồ nền, định vị địa lý, camera |
| Qgis2threejs export | ~2 | **Dự phòng** nếu deck.gl vỡ |

### Luồng dữ liệu ra web

![Luồng dữ liệu ra web](./img/data-flow-web.svg)

### Đã cắt gì để có web

Web tốn ~6 người-ngày trên ngân sách vốn không có đệm.

| Cắt | Thu về | Lý do |
|---|---|---|
| URock (trường gió có cavity/wake) | 5 pd | Rủi ro cài đặt Java/H2GIS cao, nằm ngoài đường găng |
| Phơi nhiễm dân số WorldPop | 2 pd | Web quan trọng hơn |
| Isosurface đưa lên web | 1 pd | Giữ isosurface cho hình báo cáo, không lên web |

---

## 2. Bản đồ tổng thể

![Bản đồ tổng thể 8 tuần](./img/roadmap-overview.svg)

| Mốc | Cuối tuần | Có gì trong tay |
|---|---|---|
| M1 | 2 | Mảng chiếm chỗ 3D + trường nồng độ Gaussian đầu tiên |
| M2 | 3 | Bộ giải FV chạy đúng ở 2D |
| M3 | 4 | Bộ giải FV 3D đã verify + gói seminar + **cổng quyết định** |
| M4 | 5 | Trường gió mass-consistent, div ≈ 0 |
| M5 | 6 | 3 kịch bản đã chạy + dữ liệu đã export cho web |
| M6 | 7 | Web chạy được với W1–W5 |
| M7 | 8 | Web hoàn thiện + báo cáo + slide |

---

## 3. Phân vai

| | **Người A — GIS, Dữ liệu, Web** | **Người B — Mô hình, Số trị** |
|---|---|---|
| Kỹ năng cần | QGIS, geopandas/rasterio, chút HTML/JS, thẩm mỹ trình bày | numpy, vòng lặp số, debug, toán |
| Sở hữu | Tầng 0 voxel hoá · nguồn phát thải · phân tích không gian · **ứng dụng web** · báo cáo phần dữ liệu và kết quả | Tầng 1 trường gió · Tầng 2 vận chuyển · kiểm chứng · tối ưu tốc độ · báo cáo phần mô hình và hạn chế |
| File chính | `01_voxelize.py` · `emissions.py` · `04_analysis.py` · `05_viz.py` · `06_export_web.py` · `web/` | `gaussian.py` · `02_wind.py` · `03_transport.py` · `tests/` |

**Giao diện giữa hai người là file netCDF, không phải lời gọi hàm.** A đưa B hai mảng, B trả A một mảng. Cách này để người đang sửa code không chặn người kia.

**Ở mỗi mốc M, cả hai phải chạy được toàn bộ pipeline trên máy mình.** Dành 30 phút cuối mốc để người kia clone về chạy thử. Chỉ một người chạy được là đồ án có điểm chết.

---

## 4. Giai đoạn 1 — tới seminar

### Tuần 1 — Dữ liệu và chọn địa bàn

Tuần này quyết định một thứ **không sửa lại được: chọn địa bàn**. Chọn sai (OSM thưa thẻ chiều cao) thì tới tuần 3 mới phát hiện và mất cả tuần.

| | Người A | Người B |
|---|---|---|
| **Việc** | Chọn 3 địa bàn ứng viên ở Hà Nội / TP.HCM — có hẻm phố rõ, gần trạm quan trắc, giao thông đông. Chạy Overpass đếm `building` vs `building:levels` vs `height` cho từng cái. **Chốt địa bàn mà khối nhà trung vị phân giải được ở Δ = 5 m (≥ 4 voxel mỗi cạnh)**; độ phủ thẻ chỉ là tiêu chí phụ. **Ghép chiều cao từ Google Open Buildings 2.5D.** Tải OSM extract, footprint, mạng đường, DEM GLO-30 | Dựng repo và môi trường. Kéo Open-Meteo lấy profile gió 19 mực áp suất + PBL height. Vẽ hoa gió theo mùa, chốt 2 hướng gió đại diện. Lấy API key OpenAQ, đếm trạm Việt Nam thật. **Chạy spike SOR 2D** (xem dưới) |
| **Output** | `data/raw/study_area.geojson`<br>`study_area_candidates.csv` — 3 ứng viên kèm độ phủ thẻ, λ_P, số voxel mỗi cạnh **và provenance chiều cao cuối cùng**<br>**Bảng đối chứng chéo OSM vs Google 2.5D**<br>Thư mục dữ liệu thô đã tải | `wind_profile.csv`<br>Hình hoa gió 2 mùa<br>**Kết luận spike: SOR có hội tụ không, sau bao nhiêu vòng lặp**<br>Repo chạy được trên cả 2 máy |

**Spike tuần 1 — kéo bài toán rủi ro nhất lên sớm 4 tuần.** Chưa ai biết SOR Poisson có hội tụ trên mask toà nhà thật hay không. Nó nằm trên đường găng với hai stage phụ thuộc phía sau, mà lịch cũ để tận tuần 5.

- **Việc:** lưới 2D x–z, 100 × 50 ô, một khối nhà hình hộp, profile luỹ thừa thổi vào, `u = 0` trong nhà, giải Poisson cho λ bằng SOR ω = 1,78. Khung có sẵn ở `notebooks/02_wind_2d_debug.ipynb`.
- **Chi phí:** ~1 người-ngày. Không cần dữ liệu thật, không cần Tầng 0 — mask dựng bằng `np.zeros` rồi gán `True` cho một khối chữ nhật.
- **Ba câu hỏi:** (1) hội tụ không, sau bao nhiêu vòng? (2) `div(u)` sau khi giải có về dưới ngưỡng ở mọi ô khí không? (3) vẽ vector — dòng có đi vòng qua khối nhà không?
- **Đạt cả ba** → độ tin cậy nhảy từ ~70% lên ~85%, phần còn lại chỉ là mở lên 3D. **Không hội tụ** → còn bảy tuần để đổi hướng, thay vì hai.

**Nếu cả 3 địa bàn đều thưa thẻ chiều cao:** dùng Google Open Buildings 2.5D Temporal làm nguồn chính + số hoá tay ~50 toà nhà ở lõi miền. Cộng 2 người-ngày.

> **Trạng thái 21/09/2026 — phần Người A đã xong.** Cả 3 địa bàn **đều** thưa thật
> (33,8 % / 33,9 % / 4,9 %), nên đã đi đúng nhánh dự phòng này. Chốt **Nguyen Hue**
> (4,82 voxel/cạnh; Ben Thanh 2,00 và Landmark 81 2,90 đều không phân giải được).
> **Google Open Buildings 2.5D phủ 62/62 toà nhà — không còn toà nào phải suy ra chiều cao.**
> Truy cập **không cần đăng nhập**, chi phí thực tế ~0,5 ngày chứ không phải 2.
> **Số hoá tay 50 nhà: không cần nữa.** Đối chứng chéo và trần 100 m:
> `docs/DECISION.md` *Amendment 21/09/2026* §B.

### Tuần 2 — Voxel hoá và Gaussian → M1

| | Người A | Người B |
|---|---|---|
| **Việc** | Tầng 0 trong `01_voxelize.py`: rasterize footprint thành `H[y,x]` ở Δ = 5 m, rồi `B = Z < H` thành mask 3D. **Kiểm bằng mắt**: cắt 3 mặt phẳng, chồng lên ảnh vệ tinh | Gaussian giải tích trên lưới voxel: `C(x,y,z)` với σ **Briggs đô thị**, profile gió luỹ thừa p đô thị, nguồn đường là chồng chập nguồn điểm. Làm 2D trước rồi mở 3D |
| **Output** | `data/processed/voxel_grid.nc` chứa `H (y,x)` và `B (z,y,x)`<br>Hình kiểm tra 3 mặt cắt chồng ảnh vệ tinh | `C_gaussian_ug_m3 (z,y,x)` trong cùng file netCDF<br>Hình lát cắt ngang đầu tiên |

**M1 quan trọng về mặt tâm lý:** từ đây đồ án **luôn có kết quả để nộp**. Mọi thứ sau là nâng cấp.

### Tuần 3 — Bộ giải FV ở 2D và nguồn phát thải → M2

Tuần rủi ro nhất của cả đồ án. Đây là lý do phải làm 2D trước.

| | Người A | Người B |
|---|---|---|
| **Việc** | `emissions.py`: lấy mạng đường OSM, phân theo `highway=`, nhân EF xe máy Hà Nội (PM 0,053 g/km), raster hoá vào voxel ở z ≈ 1 m, chuẩn hoá tổng theo EDGAR. **Ghi lại mọi giả định vào file** — sẽ cần cho chương Hạn chế. Thêm: **spike khung web** (xem dưới) | Bộ giải FV trên mặt cắt 2D x–z, lưới 100 × 50: upwind bậc 1 + khuếch tán trung tâm, `Cr ≤ 0,5`, biên tường flux 0 / đất phản xạ / ra mở. Verify hai thứ: so Gaussian 2D sai số < 6%, và bảo toàn khối lượng |
| **Output** | `S[k,j,i]` nguồn phát thải trong netCDF<br>File ghi giả định phát thải<br>`web/index.html` chạy được với dữ liệu giả | `transport_2d` chạy đúng<br>2 đồ thị verify: so giải tích, và bảo toàn khối lượng |

**Spike khung web, ~0,5 người-ngày.** Web là thứ cả đồ án bị chấm, nhưng lịch cũ chỉ đụng tới ở tuần 7. Việc: một `web/index.html`, MapLibre + deck.gl qua CDN, và **dữ liệu bịa** — 3 tầng độ cao, mỗi tầng lưới 10 × 10 số ngẫu nhiên ghi thẳng trong JS, một thanh trượt đổi tầng. Không cần netCDF, không cần kết quả mô hình. Chỉ trả lời: **thanh trượt có chạy trong trình duyệt không?**

**Mẹo debug 2D:** `matplotlib.imshow` sau mỗi 50 bước. Lỗi dấu upwind hay lỗi biên nhìn ra ngay — chùm khói đi ngược, nồng độ âm, hoặc vệt sọc ở biên.

### Tuần 4 — FV lên 3D và gói seminar → M3, cổng quyết định

| | Người A | Người B |
|---|---|---|
| **Việc** | Gói seminar (chi tiết ở [`SEMINAR.md`](SEMINAR.md)): làm hình H1–H4, dựng slide 13 trang, viết báo cáo theo 5 mục bắt buộc, **tập dượt bấm giờ ít nhất 2 lần** | Mở FV lên 3D: thêm trục y, code gần như y hệt 2D, dùng trường gió đồng nhất (chưa có nhà làm lệch dòng). **Kiểm định Bậc 1**: so nghiệm Gaussian giải tích 3D, mục tiêu sai số < 6%. Đo thời gian chạy |
| **Output** | 4 hình H1–H4<br>Slide 13 trang + bản PDF dự phòng<br>Báo cáo seminar | `transport_3d` đã verify<br>Báo cáo sai số và thời gian chạy |

**Cổng quyết định — cuối tuần 4.** Bộ giải FV 3D có đạt sai số < 6% so với nghiệm giải tích không?

| Trả lời | Làm gì |
|---|---|
| Đạt | Đi tiếp, tuần 5 làm trường gió |
| Gần đạt (8–10%) | Cho thêm tuần 5 để sửa rồi chốt lại, dời trường gió sang tuần 6 |
| Không đạt | **Dừng phần số trị.** Dùng `C_gauss` làm kết quả chính + mask toà nhà. Dồn tuần 5–8 vào phân tích không gian, web và báo cáo. Ghi rõ trong Hạn chế. Vẫn đúng đề bài, vẫn có web, vẫn có đồ án hoàn chỉnh |

---

## 5. Giai đoạn 2 — tới sản phẩm web

### Tuần 5 — Trường gió và phân tích không gian → M4

| | Người A | Người B |
|---|---|---|
| **Việc** | Phân tích không gian phần 1 (chạy trên `C_gauss` trước, sau thay bằng kết quả FV): lát cắt ngang ở z = 1,5 / 6 / 15 / 30 m, mặt cắt đứng qua hẻm phố, profile đứng tại vị trí trạm quan trắc. Chuẩn hoá lưu trữ: xarray `(z,y,x)`, CF, `positive="up"` | Trường gió bảo toàn khối lượng trong `02_wind.py`: profile luỹ thừa, `u = v = w = 0` trong nhà, giải Poisson cho λ bằng SOR ω = 1,78 dừng khi `Σ\|Δλ\| < 1e-4`, hệ số mặt = 0 ở tường, rồi khôi phục `u = u₀ + (1/2α₁²)·∂λ/∂x`. Làm 2D trước |
| **Output** | 3 sản phẩm phân tích: lát cắt, mặt cắt đứng, profile đứng<br>netCDF chuẩn CF mở được bằng QGIS | `wind_field.nc` với `div(u) ≈ 0` ở mọi ô khí<br>Hình vector gió trên lát cắt z = 10 m |

**Kiểm tra trực quan bắt buộc:** vẽ vector gió trên lát cắt ngang ở z = 10 m. Phải thấy dòng **đi vòng qua** các khối nhà. Nếu gió đi xuyên nhà thì hệ số mặt đang sai.

### Tuần 6 — Kịch bản và export dữ liệu web → M5

| | Người A | Người B |
|---|---|---|
| **Việc** | `06_export_web.py`: netCDF → JSON. Gộp `C` theo 50 tầng z, mỗi tầng lưới 100 × 100, lọc bỏ ô nồng độ thấp, xuất thêm `buildings.geojson`. Dựng khung `web/index.html` thật: MapLibre + deck.gl + `PolygonLayer` extrude toà nhà (W1) | Ghép gió vào bộ giải, chạy 3 kịch bản: ĐB mùa đông Δ=5 m, ĐN mùa hè Δ=5 m, ĐB Δ=10 m. Chạy tới trạng thái dừng (~800–1200 bước). **Viết test tích hợp đầu-cuối** — hiện chưa có cái nào. Thêm kiểm tra nguồn phát thải không nằm trong voxel rắn |
| **Output** | `web/data/*.json` tổng dưới 5 MB<br>`buildings.geojson`<br>Web hiện được toà nhà 3D (W1) | 3 file kết quả kịch bản<br>Bảng so sánh độ phân giải 5 m vs 10 m<br>`tests/test_integration.py` |

### Tuần 7 — Xây web → M6

| | Người A | Người B |
|---|---|---|
| **Việc** | Toàn bộ tính năng web: W2 lớp nồng độ theo tầng, **W3 thanh trượt độ cao**, W4 nút chuyển kịch bản, W5 bật/tắt ngưỡng QCVN và WHO. Legend, tiêu đề, chú thích nguồn dữ liệu | Giúp A phần xuất dữ liệu nếu file quá nặng. Tính sẵn profile đứng cho mỗi ô lưới ngang để web click là hiện ngay (W6). Tính số liệu cho panel (W7). Làm sạch code, viết docstring, đảm bảo chạy lại được từ đầu |
| **Output** | Web chạy được với đủ W1–W5 | JSON profile đứng<br>JSON số liệu panel<br>Code đã dọn sạch |

**Thứ Sáu tuần 7 là hạn chót của W1–W5.** Chưa xong thì bỏ deck.gl, chuyển sang Qgis2threejs export (~2 người-ngày). Xấu hơn nhưng vẫn là web và vẫn nộp được.

### Tuần 8 — Hoàn thiện và bảo vệ → M7

| | Người A | Người B |
|---|---|---|
| **Việc** | Hoàn thiện web: W6 click hiện profile, W7 panel số liệu, làm đẹp giao diện. **Test trên 2 máy khác nhau và điện thoại.** Viết chương Bối cảnh, Dữ liệu, Quy trình, Kết quả, Phân tích không gian, Ứng dụng web. Quay video demo 1–2 phút | Viết chương Mô hình, Phương pháp số, Kiểm chứng, **Hạn chế**. Chuẩn bị trả lời câu hỏi kỹ thuật ([`SEMINAR.md`](SEMINAR.md) §7) |
| **Output** | Web hoàn chỉnh W1–W7<br>Video demo 1–2 phút<br>6 chương báo cáo | 4 chương báo cáo<br>Bộ câu trả lời Q&A |

**Cả hai:** đọc chéo bài của nhau, kiểm mọi con số truy được nguồn, tập dượt bảo vệ 2 lần bấm giờ, đóng gói repo kèm hướng dẫn chạy web.

**Chương Hạn chế phải liệt kê đủ** — đây là chương ghi điểm, không phải chương thú tội:

1. Không có xoáy tái tuần hoàn và xoáy hẻm phố → nồng độ trong hẻm bị ước lượng thấp
2. Khuếch tán số của upwind bậc 1, kèm con số `K_num` đo được
3. Không có rối do giao thông → sai lệch lúc lặng gió
4. Chỉ verification, chưa validation với số liệu thực nghiệm, kèm lý do
5. Lưu lượng giao thông là bất định lớn nhất, dùng proxy cấp đường OSM
6. Chiều cao toà nhà từ sản phẩm ML chưa kiểm định ở Đông Nam Á
7. LoD1, không có hoá học, một trường gió tựa dừng mỗi lần chạy
8. Web hiển thị dữ liệu đã gộp và giảm mẫu, không phải toàn bộ 500.000 voxel

---

## 6. Ngân sách

| Tuần | A | B | Cộng dồn | Trọng tâm |
|---|---|---|---|---|
| 1 | 2 | **3** | 5 | Dữ liệu + spike gió 2D |
| 2 | 2 | 2 | 9 | Voxel + Gaussian |
| 3 | **2,5** | 2 | 13,5 | FV 2D + spike khung web |
| 4 | 2 | 2 | 17,5 | FV 3D + Seminar |
| 5 | 2 | 2 | 21,5 | Gió + phân tích |
| 6 | 2 | 2 | 25,5 | Kịch bản + export + test tích hợp |
| 7 | 2,5 | 1,5 | 29,5 | Web |
| 8 | 2 | 2 | **33,5** | Web + báo cáo |

**33,5 người-ngày trên ngân sách ~32 — vượt 1,5 ngày, và đó là chi phí của hai spike.** Không giả vờ là chúng miễn phí.

**Vì sao vẫn đáng:** cả hai spike mua lại thứ đắt hơn nhiều so với 1,5 ngày. Nếu SOR không hội tụ, biết ở tuần 1 còn bảy tuần để đổi hướng; biết ở tuần 5 thì còn hai. Nếu deck.gl không chạy, biết ở tuần 3 còn bốn tuần để chuyển Qgis2threejs; biết ở tuần 7 thì hết đường.

**Bù 1,5 ngày ở đâu:** cắt kịch bản thứ 3 (Δ = 10 m) và panel số liệu web (W7) ngay từ đầu, thay vì để dành cắt sau. Hai cái cộng lại đúng khoảng 1,5 ngày và không cái nào nằm trong phần bị chấm.

**Thứ tự cắt tiếp nếu vẫn trượt:** W8 isosurface web → W6 click profile → mặt cắt đứng → phân tích độ nhạy độ phân giải.

**Không được cắt:** hai spike ở tuần 1 và 3, W1–W5 của web, kiểm định Bậc 1, test tích hợp, chương Hạn chế.

---

## 7. Giả định và độ tin cậy

Kế hoạch đứng trên bảy giả định, liệt kê riêng từng cái để ai cũng phản bác được từng cái một.

| | Giả định | Nếu sai |
|---|---|---|
| A1 | Có địa bàn với độ phủ thẻ chiều cao OSM đủ tốt để extrude | Dùng raster chiều cao và báo cáo tỉ lệ nhà bị suy ra; hoặc số hoá tay ~50 nhà |
| **A2** | **SOR Poisson hội tụ trên mask toà nhà thật trong số vòng lặp chấp nhận được** | Tầng gió tắc, kéo theo Tầng 2 và 3. **Ẩn số lớn nhất** — chính là lý do có spike tuần 1 |
| A3 | ω = 1,78 chuyển được từ lưới so le sang lưới tâm-ô | Dò ω bằng thực nghiệm. Tốc độ hội tụ đổi, tính đúng đắn không đổi |
| A4 | 500.000 voxel × vài trăm bước chạy dưới một phút bằng numpy | Hạ về Δ = 10 m — bảng CAIRDIO cho thấy vẫn chấp nhận được (NMSE 0,25) |
| A5 | Xuất JSON theo tầng vừa ngân sách dung lượng trình duyệt | Giảm mẫu thêm và ghi lại hệ số giảm mẫu |
| A6 | Cả hai thành viên chạy được toàn bộ pipeline | Đồ án có điểm chết. Kiểm ở mỗi mốc M |
| A7 | Phát thải sai trị tuyệt đối nhưng dùng được về tương đối | Báo cáo nồng độ chuẩn hoá thay vì µg/m³ tuyệt đối, và nói rõ |

### Độ tin cậy: ~70%

**Đứng trên:** Tầng 0 và Tầng 2 đã cài xong, Tầng 2 đã verify với 12 test — khoảng một nửa rủi ro kỹ thuật đã trả.

**Bị kéo xuống bởi:** A2 chưa giải quyết — chưa ai chạy phép giải này trên mask thật, mà nó nằm trên đường găng. A1 chưa đo — địa bàn chưa chọn.

| Việc nâng độ tin cậy | Lên | Chi phí |
|---|---|---|
| SOR 2D hội tụ trên mask thật (spike tuần 1) | **~85%** | ~1 người-ngày |
| Đếm được độ phủ thẻ chiều cao của địa bàn | +5% | ~0,5 |
| Khung deck.gl chạy với dữ liệu giả (spike tuần 3) | +5% | ~0,5 |

Dưới ~60% thì đây là bản nháp cần thử nghiệm chứ không phải kế hoạch để thực thi. Ở 70% nó thực thi được, **với điều kiện hai spike được kéo lên sớm**.

### Các tầng test

| Tầng | Chứng minh gì | Trạng thái |
|---|---|---|
| Unit, hàm thuần | hệ số σ, số học CFL, parse chiều cao | Có — `tests/test_verification.py` |
| Verification vs giải tích | luật phương sai khuếch tán, quãng đường tải | Có — `tests/test_transport_verification.py` |
| Bất biến ở mọi bước | bảo toàn khối lượng, không âm, tường không lọt | Có — rẻ nhất, bắt đúng lỗi quan trọng nhất |
| **Tích hợp đầu-cuối** | 4 tầng ghép lại chạy được | **Chưa có** — thêm ở tuần 6 |

---

## 8. Quy tắc làm việc

1. **Git từ ngày đầu.** Một repo, hai nhánh, merge ở mỗi mốc. Không gửi file qua Zalo.
2. **`.gitignore` cho `data/raw/` ngay commit đầu** — OSM extract Việt Nam nặng 313 MB.
3. **Giao diện giữa hai người là file netCDF**, không phải lời gọi hàm.
4. **Lưu mọi kết quả trung gian ra netCDF.** Chạy lại được từng tầng độc lập.
5. **Không tối ưu sớm.** numpy slicing cho chạy đúng trước; chỉ dùng Numba khi đo được là chậm thật.
6. **Ghi nguồn ngay lúc viết**, không để cuối kỳ mới truy lại.
7. **Hình xuất ≥ 300 dpi ngay từ đầu.** Vẽ lại hình vào tuần 8 là lãng phí.
8. **Web test trên ít nhất 2 máy.** "Chạy được trên máy tôi" không tính.

---

## 9. Bốn thứ dễ làm trượt lịch nhất

| Nguy cơ | Dấu hiệu sớm | Xử lý |
|---|---|---|
| Bộ giải FV không hội tụ hoặc ra nồng độ âm | Xuất hiện ngay ở 2D tuần 3 | Kiểm theo thứ tự: dấu upwind với u âm, `Cr` có thực sự ≤ 0,5, biên tường có đúng flux = 0. **Đừng đụng 3D khi 2D còn sai** |
| Dữ liệu web quá nặng | File JSON > 20 MB, trình duyệt lag | Gộp ô cho web (Δ = 10 m), lọc ô nồng độ thấp, tách file theo tầng và tải lười |
| ✅ **ĐÃ XẢY RA, ĐÃ XỬ LÝ** — dữ liệu chiều cao OSM tệ | Phát hiện ở tuần 1 đúng như dự kiến: **66 % số toà nhà không có thẻ chiều cao** | Google Open Buildings 2.5D phủ 100 %, không cần số hoá tay. **Phân tích độ nhạy vẫn nên làm** — nay đã có hai trường chiều cao độc lập nên chỉ tốn một lần chạy lại |
| Web không kịp | Hết thứ Sáu tuần 7 mà W1–W5 chưa chạy | Chuyển sang Qgis2threejs export |

---

## 10. Cấu trúc repo

```
IE402_Voxel-air-dispersion/
├── README.md
├── docs/
│   ├── RESEARCH.md · DECISION.md · spec.md · ARCHITECTURE.md · ROADMAP.md · SEMINAR.md
│   └── img/
├── src/
│   ├── 01_voxelize.py         A   Tầng 0
│   ├── emissions.py           A   nguồn phát thải
│   ├── gaussian.py            B   baseline + chuẩn kiểm chứng
│   ├── 02_wind.py             B   Tầng 1, SOR Poisson
│   ├── 03_transport.py        B   Tầng 2, thể tích hữu hạn
│   ├── 04_analysis.py         A   Tầng 3, phân tích không gian
│   ├── 05_viz.py              A   hình cho báo cáo
│   └── 06_export_web.py       A   netCDF → JSON cho web
├── web/                       A   SẢN PHẨM CUỐI
│   ├── index.html                 deck.gl + MapLibre, CDN, không build
│   ├── app.js · style.css
│   └── data/                      *.json đã export, dưới 5 MB
├── tests/
│   ├── test_verification.py       voxel hoá
│   ├── test_transport_verification.py   B   Bậc 1
│   └── test_integration.py        B   thêm ở tuần 6
├── notebooks/
│   ├── 01_fv_2d_debug.ipynb       debug bộ giải ở 2D
│   └── 02_wind_2d_debug.ipynb     khung spike SOR tuần 1
├── config/project.yaml
├── data/                          raw/ và processed/, đều gitignore
├── output/                        netCDF + hình
├── requirements.txt · pyproject.toml
└── .gitignore
```
