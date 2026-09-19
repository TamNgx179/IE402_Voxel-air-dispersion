# ROADMAP — 8 tuần, 2 người, sản phẩm cuối là **ứng dụng web 3D**

> **Ràng buộc:** 2 người · numpy mức cơ bản · 8 tuần lịch · **bán thời gian**
> **Ngân sách:** ~4 người-ngày/tuần → **~32 người-ngày tổng**
> **Giả định:** gói seminar sẵn sàng **cuối tuần 4**. Nếu seminar rơi sớm/muộn hơn, dịch Giai đoạn 1 cho khớp nhưng **giữ nguyên thứ tự** và **giữ cổng quyết định M3**.

---

## 0. SẢN PHẨM CUỐI CÙNG

> ### 🎯 Một **ứng dụng web 3D** chạy được trên trình duyệt, hiển thị trường nồng độ ô nhiễm trên mô hình thành phố voxel.

### 0.1 Web phải có gì

| # | Tính năng | Bắt buộc? | Vì sao |
|---|---|---|---|
| **W1** | Bản đồ nền + **toà nhà 3D** (extrude từ footprint + chiều cao) | ✅ | Bối cảnh không gian |
| **W2** | **Trường nồng độ 3D** hiển thị dưới dạng lớp voxel theo độ cao | ✅ | Sản phẩm chính |
| **W3** | ⭐ **Thanh trượt chọn độ cao z** (1,5 m → 100 m) | ✅ **Quan trọng nhất** | Kéo thanh trượt là **thấy ngay nồng độ đổi theo độ cao** — chứng minh trực tiếp luận điểm "phải 3D" |
| **W4** | **Chuyển kịch bản** (gió ĐB mùa đông ↔ gió ĐN mùa hè) | ✅ | Cho thấy mô hình phản ứng với đầu vào |
| **W5** | **Bật/tắt ngưỡng** QCVN 50 và WHO 15 µg/m³ (tô màu vùng vượt) | ✅ | Nối kết quả với tiêu chuẩn |
| **W6** | **Click một điểm → hiện profile đứng** (đồ thị nồng độ theo z) | 🟡 nên có | Tính năng "ăn tiền" thứ hai |
| **W7** | Panel số liệu: thể tích vượt ngưỡng, nồng độ trung bình theo tầng | 🟡 nên có | |
| **W8** | Isosurface 3D (glTF) | ⬜ nếu dư | Đẹp nhưng không thiết yếu |

### 0.2 Công nghệ web — chọn đường rẻ nhất

**Chốt: `deck.gl` + `MapLibre`, một file HTML, load qua CDN, KHÔNG có bước build.**

| Phương án | Chi phí | Quyết định |
|---|---|---|
| ⭐ **deck.gl + MapLibre, 1 file HTML, CDN** | ~5 người-ngày | ✅ **CHỌN** — không npm, không webpack, không Node. Có sẵn bản đồ nền, `PolygonLayer` extrude toà nhà, `GridCellLayer`/`PointCloudLayer` cho voxel |
| CesiumJS + 3D Tiles + glTF | ~8 người-ngày | ❌ Phải tự tạo tileset; `VoxelPrimitive` là **extension draft, experimental** |
| Three.js thuần | ~6 người-ngày | ❌ Phải tự làm camera, bản đồ nền, định vị địa lý |
| Qgis2threejs export | ~2 người-ngày | 🟡 **Dự phòng** nếu deck.gl vỡ — xuất trang web tĩnh thẳng từ QGIS, xấu hơn nhưng vẫn là web |

**Luồng dữ liệu ra web:**

![Luồng dữ liệu ra web](./img/data-flow-web.svg)

### 0.3 Ngân sách đã phải cắt gì để có web

Web tốn ~6 người-ngày. Ngân sách vốn đã khít, nên **cắt thẳng**:

| ✂️ Cắt | Người-ngày thu về | Lý do |
|---|---|---|
| **URock** (trường gió có cavity/wake) | 5 | Rủi ro cài đặt Java/H2GIS cao, nằm ngoài đường găng |
| **Phơi nhiễm dân số WorldPop** | 2 | Web quan trọng hơn |
| **Isosurface glTF cho web** | 1 | Giữ isosurface cho hình báo cáo, không đưa lên web |

---

## 1. Bản đồ tổng thể

![Bản đồ tổng thể 8 tuần](./img/roadmap-overview.svg)

| Mốc | Cuối tuần | Có gì trong tay |
|---|---|---|
| 🏁 **M1** | T2 | Mảng chiếm chỗ 3D `B[k,j,i]` + **trường nồng độ 3D đầu tiên** (Gaussian) |
| 🏁 **M2** | T3 | Bộ giải FV chạy đúng **ở 2D**, đã verify |
| 🏁 **M3** | T4 | Bộ giải FV **3D** đã verify + **GÓI SEMINAR SẴN SÀNG** + 🚦 cổng |
| 🏁 **M4** | T5 | Trường gió mass-consistent (nhà làm lệch dòng, div ≈ 0) |
| 🏁 **M5** | T6 | 3 kịch bản đã chạy + **dữ liệu đã export sang JSON cho web** |
| 🏁 **M6** | T7 | **Web chạy được** với W1–W5 |
| 🏁 **M7** | T8 | Web hoàn thiện + báo cáo + slide bảo vệ |

---

## 2. Phân vai hai người

| | 👤 **NGƯỜI A — "GIS, Dữ liệu & Web"** | 👤 **NGƯỜI B — "Mô hình & Số trị"** |
|---|---|---|
| **Kỹ năng cần** | QGIS, geopandas/rasterio, một chút HTML/JS, thẩm mỹ trình bày | numpy, vòng lặp số, debug, toán |
| **Sở hữu toàn bộ** | Tầng 0 (voxel hoá) · nguồn phát thải · phân tích không gian · **ỨNG DỤNG WEB** · báo cáo phần dữ liệu & kết quả | Tầng 1 (trường gió) · Tầng 2 (vận chuyển) · kiểm chứng · tối ưu tốc độ · báo cáo phần mô hình & hạn chế |
| **File chính** | `01_voxelize.py`<br>`emissions.py`<br>`04_analysis.py`<br>`05_viz.py`<br>`06_export_web.py`<br>`web/index.html` | `gaussian.py`<br>`02_wind.py`<br>`03_transport.py`<br>`tests/test_verification.py` |
| **Đầu ra cho người kia** | `B[k,j,i]` (mask nhà) · `S[k,j,i]` (nguồn) | `wind_field.nc` · `C[k,j,i]` (nồng độ) |
| **Giao diện giữa hai người** | **File netCDF.** Không ai gọi hàm của ai. A đưa B hai mảng, B trả A một mảng. | |

> 📌 **Quy tắc bất di bất dịch:** ở **mỗi mốc M**, cả hai phải **chạy được toàn bộ pipeline trên máy mình**. Dành 30 phút cuối mỗi mốc để người kia clone về chạy thử. Nếu chỉ một người chạy được, đồ án có một điểm chết.

---

## 3. GIAI ĐOẠN 1 — Tới seminar (T1–T4)

### 🗓️ TUẦN 1 — Dữ liệu và chọn địa bàn

> ⭐ **Tuần này quyết định một thứ KHÔNG SỬA LẠI ĐƯỢC: chọn địa bàn.** Chọn sai (OSM thưa thẻ chiều cao) thì tới tuần 3 mới phát hiện và mất cả tuần.

**👤 NGƯỜI A**
1. Chọn **3 địa bàn ứng viên** ở Hà Nội / TP.HCM — tiêu chí: có hẻm phố rõ, gần trạm quan trắc, giao thông đông
2. ⭐ **Chạy Overpass** đếm cho từng ứng viên: tổng `building` vs `building["building:levels"]` vs `building["height"]`
3. **Chốt địa bàn có tỉ lệ gắn thẻ chiều cao cao nhất** → lưu `study_area.geojson`
4. Tải: OSM extract (Geofabrik VN), footprint + mạng đường, DEM GLO-30

**👤 NGƯỜI B**
1. Dựng repo + môi trường: `numpy scipy xarray netCDF4 rasterio geopandas matplotlib pyvista`
2. Kéo **Open-Meteo**: profile gió 19 mực áp suất + PBL height cho địa bàn
3. Vẽ **hoa gió theo mùa** → chốt 2 hướng gió đại diện (ĐB mùa đông, ĐN mùa hè)
4. Lấy **API key OpenAQ**, chạy `?iso=VN` đếm trạm thật

**Nếu cả 3 địa bàn đều thưa thẻ chiều cao:** dùng **Google Open Buildings 2.5D Temporal** làm nguồn chính + **số hoá tay ~50 toà nhà** ở lõi miền. Cộng 2 người-ngày.

---

### 🗓️ TUẦN 2 — Voxel hoá + Gaussian → 🏁 M1

**👤 NGƯỜI A — Tầng 0, voxel hoá.** `01_voxelize.py`:
- rasterize footprint → `H[y,x]` ở Δ = 5 m
- `B = Z[:,None,None] < H[None,:,:]` → mask 3D bool
- ⚠️ **kiểm bằng mắt**: cắt 3 mặt phẳng, chồng lên ảnh vệ tinh, xem nhà có đúng chỗ không
- lưu netCDF → **đây là đầu vào cho người B**

**👤 NGƯỜI B — Gaussian giải tích trên voxel.** `gaussian.py`:
- `C(x,y,z)` với **σ Briggs ĐÔ THỊ** (không phải bảng nông thôn)
- profile gió luỹ thừa với p đô thị
- nguồn đường = chồng chập nguồn điểm
- **làm 2D trước, rồi mở 3D**

> 🏁 **M1 — mốc quan trọng về tâm lý:** từ đây **đồ án LUÔN có kết quả để nộp**. Mọi thứ sau là nâng cấp.

---

### 🗓️ TUẦN 3 — Bộ giải FV ở 2D + nguồn phát thải → 🏁 M2

> ⭐ **Tuần rủi ro nhất của cả đồ án.** Đây là lý do phải làm 2D trước.

**👤 NGƯỜI A — Nguồn phát thải.** `emissions.py`:
- lấy mạng đường OSM trong miền, phân theo `highway=`
- nhân **EF xe máy Hà Nội** (Tran et al. 2024): PM 0,053 g/km
- raster hoá vào voxel ở z ≈ 1 m → `S[k,j,i]`
- chuẩn hoá tổng theo EDGAR, **ghi lại mọi giả định vào file** (sẽ cần cho chương Hạn chế)

**👤 NGƯỜI B — ⭐ Bộ giải FV trên mặt cắt 2D (x–z), lưới 100 × 50:**
- upwind bậc 1 + khuếch tán trung tâm
- CFL: `Cr ≤ 0,5`
- biên: tường = flux 0 · đất = phản xạ · ra = mở
- **verify 1**: so Gaussian 2D trong dòng đều → sai số < 6%
- **verify 2**: kiểm bảo toàn khối lượng

**Mẹo debug 2D:** `matplotlib.imshow` sau mỗi 50 bước. Lỗi dấu upwind hay lỗi biên **nhìn ra ngay** — chùm khói đi ngược, nồng độ âm, hoặc vệt sọc ở biên.

---

### 🗓️ TUẦN 4 — FV lên 3D + gói seminar → 🏁 M3 + 🚦 CỔNG

**👤 NGƯỜI A — Gói seminar** (chi tiết ở [`SEMINAR.md`](./SEMINAR.md)):
- làm hình H1–H4: voxel city, hai lát cắt 1,5 m vs 15 m, mặt cắt đứng, isosurface
- dựng slide 13 trang
- viết báo cáo seminar theo 5 mục bắt buộc
- **tập dượt bấm giờ ít nhất 2 lần**

**👤 NGƯỜI B — Mở FV lên 3D.** `03_transport.py`:
- thêm trục y — code gần như y hệt 2D
- dùng trường gió **đồng nhất** (chưa có nhà làm lệch dòng)
- **Kiểm định Bậc 1**: so nghiệm Gaussian giải tích 3D, mục tiêu **sai số < 6%**
- đo thời gian chạy; nếu chậm thì tối ưu bằng slicing

> ## 🚦 CỔNG QUYẾT ĐỊNH — cuối tuần 4
>
> **Bộ giải FV 3D có đạt sai số < 6% so với nghiệm giải tích không?**
>
> | | Làm gì |
> |---|---|
> | ✅ **ĐẠT** | Đi tiếp → T5 làm trường gió |
> | 🟡 **GẦN ĐẠT (8–10%)** | Cho thêm tuần 5 để sửa, rồi chốt lại. Dời trường gió sang T6 |
> | ❌ **KHÔNG ĐẠT** | **DỪNG phần số trị.** Dùng `C_gauss` làm kết quả chính + mask toà nhà. Dồn T5–T8 vào **phân tích không gian + WEB + báo cáo**. Ghi rõ trong Hạn chế. **Vẫn đúng đề bài, vẫn có web, vẫn có đồ án hoàn chỉnh.** |

---

## 4. GIAI ĐOẠN 2 — Sau seminar (T5–T8)

### 🗓️ TUẦN 5 — Trường gió + phân tích không gian → 🏁 M4

**👤 NGƯỜI A — Phân tích không gian** (chạy trên `C_gauss` trước, sau thay bằng kết quả FV):
1. Lát cắt ngang ở z = 1,5 / 6 / 15 / 30 m
2. Mặt cắt đứng cắt ngang hẻm phố
3. Profile đứng tại vị trí trạm quan trắc
4. Chuẩn hoá lưu trữ: xarray `(z,y,x)`, CF, `positive="up"` → netCDF-4

**👤 NGƯỜI B — ⭐ Trường gió bảo toàn khối lượng.** `02_wind.py`:
- khởi tạo: profile luỹ thừa `u(z)`, đặt **u = v = w = 0 bên trong nhà**
- giải Poisson cho λ bằng **SOR, ω = 1,78**, dừng khi `Σ|λ^(t+1) − λ^t| < 1e-4`
- hệ số mặt `e,f,g,h,m,n = 0` ở mặt tường
- `u = u₀ + (1/2α₁²)·∂λ/∂x` …
- **làm 2D trước**
- ⚠️ **kiểm: `div(u) ≈ 0` ở mọi voxel khí**

**Kiểm tra trực quan bắt buộc:** vẽ vector gió trên lát cắt ngang ở z = 10 m. **Phải thấy dòng đi vòng qua các khối nhà.** Nếu gió đi xuyên nhà → hệ số mặt đang sai.

---

### 🗓️ TUẦN 6 — Kịch bản + export dữ liệu web → 🏁 M5

**👤 NGƯỜI B — Ghép gió vào bộ giải và chạy 3 kịch bản:**
1. Gió ĐB mùa đông, Δ = 5 m
2. Gió ĐN mùa hè, Δ = 5 m
3. Gió ĐB, **Δ = 10 m** (kiểm độ nhạy độ phân giải)
- chạy tới trạng thái dừng (~800–1200 bước, dưới 1 phút/kịch bản)
- bảng so sánh độ phân giải 5 m vs 10 m

**👤 NGƯỜI A — Bắt đầu web:**
1. `06_export_web.py`: netCDF → JSON cho web
   - gộp `C` theo **50 tầng z**, mỗi tầng một lưới 100 × 100
   - lọc bỏ ô có `C` dưới ngưỡng nhỏ để giảm dung lượng
   - xuất thêm `buildings.geojson` (footprint + height) cho layer toà nhà
   - **mục tiêu: tổng dữ liệu < 5 MB**
2. Dựng khung `web/index.html`: MapLibre basemap + deck.gl qua CDN + `PolygonLayer` extrude toà nhà (**W1**)

---

### 🗓️ TUẦN 7 — Xây web → 🏁 M6

**👤 NGƯỜI A — Toàn bộ tính năng web:**
- **W2** `GridCellLayer` hiển thị nồng độ một tầng z, tô màu theo thang
- ⭐ **W3** thanh trượt chọn z → đổi tầng hiển thị (tính năng quan trọng nhất)
- **W4** nút chuyển kịch bản gió
- **W5** bật/tắt tô màu vùng vượt ngưỡng QCVN 50 / WHO 15
- Legend, tiêu đề, chú thích nguồn dữ liệu

**👤 NGƯỜI B — Hỗ trợ + hoàn thiện mô hình:**
- Giúp A phần xuất dữ liệu nếu file quá nặng (gộp ô, hạ độ phân giải cho web)
- **W6** tính sẵn profile đứng cho mỗi ô lưới ngang → xuất JSON để web click là hiện ngay
- **W7** tính số liệu cho panel: thể tích vượt ngưỡng, nồng độ trung bình theo tầng
- Làm sạch code, viết docstring, đảm bảo chạy lại được từ đầu

> ⚠️ **Thứ Sáu tuần 7 là hạn chót của W1–W5.** Nếu chưa xong thì **bỏ deck.gl, chuyển sang Qgis2threejs export** (2 người-ngày, xuất trang web tĩnh thẳng từ QGIS). Xấu hơn nhưng vẫn là web và vẫn nộp được.

---

### 🗓️ TUẦN 8 — Hoàn thiện và bảo vệ → 🏁 M7

**👤 NGƯỜI A:**
- Hoàn thiện web: **W6** click → profile đứng, **W7** panel số liệu, làm đẹp giao diện
- Test web trên **2 máy khác nhau + điện thoại**
- Viết chương: Bối cảnh · Dữ liệu · Quy trình xây dựng · Kết quả · Phân tích không gian · **Ứng dụng web**
- Quay **video demo web 1–2 phút** (phòng khi hôm bảo vệ mạng lỗi)

**👤 NGƯỜI B:**
- Viết chương: Mô hình · Phương pháp số · Kiểm chứng · **Hạn chế**
- Chuẩn bị trả lời câu hỏi kỹ thuật (SEMINAR.md §7)

**Cả hai:** đọc chéo bài của nhau · kiểm mọi con số truy được nguồn · **tập dượt bảo vệ 2 lần bấm giờ** · đóng gói repo + README + hướng dẫn chạy web.

**Chương Hạn chế phải liệt kê đủ — đây là chương ghi điểm, không phải chương thú tội:**
1. Không có xoáy tái tuần hoàn / xoáy hẻm phố → nồng độ trong hẻm bị ước lượng thấp
2. Khuếch tán số của upwind bậc 1 — **kèm con số K_num đo được**
3. Không có rối do giao thông (TPT) → sai lệch lúc lặng gió
4. Chỉ verification, **chưa validation** với số liệu thực nghiệm — kèm lý do
5. Lưu lượng giao thông là bất định lớn nhất, dùng proxy cấp đường OSM
6. Chiều cao toà nhà từ sản phẩm ML **chưa kiểm định ở Đông Nam Á**
7. LoD1, không có hoá học, một trường gió tựa dừng mỗi lần chạy
8. Web hiển thị dữ liệu đã gộp/giảm mẫu, không phải toàn bộ 500k voxel

---

## 5. Ngân sách

| Tuần | 👤 A (pd) | 👤 B (pd) | Cộng dồn | Trọng tâm |
|---|---|---|---|---|
| T1 | 2 | 2 | 4 | Dữ liệu |
| T2 | 2 | 2 | 8 | Voxel + Gaussian |
| T3 | 2 | 2 | 12 | FV 2D |
| T4 | 2 | 2 | 16 | FV 3D + Seminar |
| T5 | 2 | 2 | 20 | Gió + phân tích |
| T6 | 2 | 2 | 24 | Kịch bản + export web |
| T7 | 2,5 | 1,5 | 28 | **WEB** |
| T8 | 2 | 2 | **32** | Web + báo cáo |

📐 Đúng 32 người-ngày — **không có đệm**. Nếu một tuần trượt thì **cắt**, không dồn.

**Thứ tự cắt khi cần:**
`W8 isosurface web` → `W7 panel số liệu` → `W6 click profile` → `kịch bản thứ 3 (Δ=10 m)` → `mặt cắt đứng`

⚠️ **Không được cắt:** W1–W5 của web, kiểm định Bậc 1, chương Hạn chế.

---

## 6. Quy tắc làm việc

1. **Git từ ngày đầu.** Một repo, hai nhánh, merge ở mỗi mốc. Không gửi file qua Zalo.
2. **`.gitignore` cho `data/raw/` ngay commit đầu** — OSM extract Việt Nam nặng 313 MB.
3. **Giao diện giữa hai người là file netCDF**, không phải lời gọi hàm. A đưa B hai mảng, B trả A một mảng.
4. **Lưu mọi kết quả trung gian ra netCDF.** Chạy lại được từng tầng độc lập.
5. **Không tối ưu sớm.** numpy slicing cho chạy đúng trước; chỉ dùng Numba khi đo được là chậm thật.
6. **Mọi con số đưa vào báo cáo phải ghi nguồn ngay lúc viết** — xem `RESEARCH.md` §19.
7. **Hình xuất ≥ 300 dpi ngay từ đầu.** Vẽ lại hình vào tuần 8 là lãng phí.
8. **Web test trên ≥ 2 máy.** "Chạy được trên máy tôi" không tính.

---

## 7. Bốn thứ dễ làm trượt lịch nhất

| Nguy cơ | Dấu hiệu sớm | Xử lý |
|---|---|---|
| **Bộ giải FV không hội tụ / nồng độ âm** | Xuất hiện ngay ở 2D tuần 3 | Kiểm 3 thứ theo thứ tự: (1) dấu upwind với u âm, (2) `Cr` có thực sự ≤ 0,5, (3) biên tường có đúng flux = 0. **Đừng đụng 3D khi 2D còn sai** |
| **Dữ liệu web quá nặng** | File JSON > 20 MB, trình duyệt lag | Gộp ô cho web (Δ = 10 m thay vì 5 m), lọc bỏ ô nồng độ thấp, tách file theo tầng và tải lười |
| **Dữ liệu chiều cao toà nhà tệ** | Phát hiện ở tuần 1 nếu làm đúng Overpass | Số hoá tay ~50 nhà ở lõi miền, và **biến nó thành phân tích độ nhạy** |
| **Web không kịp** | Hết thứ Sáu tuần 7 mà W1–W5 chưa chạy | Chuyển sang **Qgis2threejs export** — 2 người-ngày, xấu hơn nhưng vẫn là web |

---

## 8. Cấu trúc repo

```
IE402_Voxel-air-dispersion/
├── README.md                  ← mô tả + ảnh H2 + link web demo + hướng dẫn chạy
├── docs/
│   ├── RESEARCH.md · DECISION.md · ROADMAP.md · SEMINAR.md
├── src/
│   ├── 01_voxelize.py         👤A  Tầng 0
│   ├── emissions.py           👤A  nguồn phát thải
│   ├── gaussian.py            👤B  baseline + chuẩn kiểm chứng
│   ├── 02_wind.py             👤B  Tầng 1 — SOR Poisson
│   ├── 03_transport.py        👤B  Tầng 2 — FV
│   ├── 04_analysis.py         👤A  Tầng 3 — phân tích không gian
│   ├── 05_viz.py              👤A  hình cho báo cáo
│   └── 06_export_web.py       👤A  netCDF → JSON cho web
├── web/                       👤A  ⭐ SẢN PHẨM CUỐI
│   ├── index.html             deck.gl + MapLibre, CDN, không build
│   ├── app.js
│   ├── style.css
│   └── data/                  *.json đã export (< 5 MB)
├── tests/
│   └── test_verification.py   👤B  Bậc 1: giải tích + bảo toàn khối lượng
├── data/
│   ├── raw/                   .gitignore
│   └── processed/             .gitignore trừ file nhỏ
├── output/                    netCDF + hình; .gitignore trừ hình báo cáo
├── notebooks/                 thử nghiệm 2D tuần 3 và tuần 5
├── requirements.txt
└── .gitignore
```
