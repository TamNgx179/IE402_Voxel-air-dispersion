# ROADMAP — Lộ trình 8 tuần, 2 người

> **Ràng buộc:** 2 người · numpy mức cơ bản · 8 tuần lịch · **bán thời gian** (làm song song đồ án môn khác)
> **Ngân sách:** ~15–20 giờ/tuần/người → **~4 người-ngày/tuần** → **~32 người-ngày tổng**
> **Phạm vi đã cắt:** xem [`DECISION.md`](./DECISION.md) §0
> **Giả định về seminar:** gói seminar sẵn sàng **cuối tuần 4**. Nếu seminar rơi sớm/muộn hơn, dịch toàn bộ Giai đoạn 1 cho khớp — nhưng **giữ nguyên thứ tự** và **giữ nguyên cổng quyết định W4**.

---

## 0. Bản đồ tổng thể

```
 T1        T2        T3        T4        T5        T6        T7        T8
 │         │         │         │         │         │         │         │
 ├─ Dữ liệu─┼─ Voxel ─┼─ FV 2D ─┼─ FV 3D ─┼─ Gió ───┼─ Ghép ──┼─ Phân ──┼─ Viết ──┤
 │  + địa   │  + Gauss│  + nguồn│  + SEMI │  SOR    │  + kịch │  tích + │  + bảo  │
 │  bàn     │         │  phát   │  NAR    │  Poisson│  bản    │  trực   │  vệ     │
 │          │         │  thải   │         │         │         │  quan   │         │
 │        🏁M1      🏁M2      🏁M3      🏁M4      🏁M5      🏁M6      🏁M7
 │                             ▲
 │                             └── 🚦 CỔNG QUYẾT ĐỊNH (§4)
```

| Mốc | Cuối tuần | Có gì trong tay |
|---|---|---|
| 🏁 **M1** | T2 | Mảng chiếm chỗ 3D `B[k,j,i]` + **trường nồng độ 3D đầu tiên** (Gaussian) |
| 🏁 **M2** | T3 | Bộ giải FV chạy đúng **ở 2D**, đã verify |
| 🏁 **M3** | T4 | Bộ giải FV **3D** đã verify + **GÓI SEMINAR SẴN SÀNG** |
| 🏁 **M4** | T5 | Trường gió mass-consistent (nhà làm lệch dòng, div = 0) |
| 🏁 **M5** | T6 | Pipeline hoàn chỉnh, 3 kịch bản đã chạy |
| 🏁 **M6** | T7 | 5 sản phẩm phân tích không gian + hình trực quan |
| 🏁 **M7** | T8 | Báo cáo + slide bảo vệ |

---

## 1. Phân vai

| | **Người A — "GIS & Dữ liệu"** | **Người B — "Mô hình & Số trị"** |
|---|---|---|
| **Sở trường cần** | QGIS, geopandas/rasterio, bản đồ, trình bày | numpy, vòng lặp số, debug |
| **Sở hữu** | Tầng 0 (voxel hoá), nguồn phát thải, phân tích không gian, trực quan hoá, báo cáo | Tầng 1 (gió), Tầng 2 (vận chuyển), kiểm chứng, tối ưu tốc độ |
| **File chính** | `01_voxelize.py`, `04_analysis.py`, `05_viz.py` | `02_wind.py`, `03_transport.py`, `tests/` |

> 📌 **Quy tắc bất di bất dịch:** ở **mỗi mốc M**, cả hai người phải **chạy được toàn bộ pipeline trên máy mình**. Nếu chỉ một người chạy được, đồ án có một điểm chết. Dành 30 phút cuối mỗi mốc để người kia clone về chạy thử.

---

## 2. GIAI ĐOẠN 1 — Tới seminar (T1–T4)

### 🗓️ TUẦN 1 — Dữ liệu và chọn địa bàn

> ⭐ **Tuần này quyết định một thứ không sửa lại được: CHỌN ĐỊA BÀN.** Chọn sai (OSM thưa thẻ chiều cao) thì tới tuần 3 mới phát hiện và mất cả tuần.

| | Người A | Người B |
|---|---|---|
| **Việc** | 1. Chọn **3 địa bàn ứng viên** ở Hà Nội / TP.HCM — tiêu chí: có hẻm phố rõ, gần trạm quan trắc, giao thông đông<br>2. ⭐ **Chạy Overpass** đếm cho từng ứng viên: tổng `building` vs `building["building:levels"]` vs `building["height"]`<br>3. **Chốt địa bàn có tỉ lệ gắn thẻ chiều cao cao nhất**<br>4. Tải: OSM extract (Geofabrik VN), footprint + đường, DEM GLO-30 | 1. Dựng repo + môi trường: `numpy, scipy, xarray, netCDF4, rasterio, geopandas, matplotlib, pyvista`<br>2. Kéo **Open-Meteo**: profile gió theo 19 mực áp suất + PBL height cho địa bàn<br>3. Vẽ **hoa gió theo mùa** → chốt 2 hướng gió đại diện (ĐB mùa đông, ĐN mùa hè)<br>4. Lấy **API key OpenAQ**, chạy `?iso=VN` đếm trạm thật |
| **Xong tuần** | 1 file `study_area.geojson` + bảng thống kê 3 ứng viên | `wind_profile.csv` + hoa gió + repo chạy được |

**Nếu cả 3 địa bàn đều thưa thẻ chiều cao:** dùng **Google Open Buildings 2.5D Temporal** làm nguồn chính (qua Earth Engine), và **số hoá tay ~50 toà nhà** ở lõi miền để đối chứng. Cộng 2 người-ngày.

---

### 🗓️ TUẦN 2 — Voxel hoá + Gaussian → 🏁 M1

| | Người A | Người B |
|---|---|---|
| **Việc** | **Tầng 0 — voxel hoá.** `01_voxelize.py`:<br>• rasterize footprint → `H[y,x]` ở Δ = 5 m<br>• `B = Z[:,None,None] < H[None,:,:]` → mask 3D<br>• **kiểm bằng mắt**: cắt 3 mặt phẳng, chồng lên ảnh vệ tinh, xem nhà có đúng chỗ<br>• lưu netCDF | **Gaussian giải tích trên lưới voxel.** `gaussian.py`:<br>• C(x,y,z) với **σ Briggs ĐÔ THỊ** (không phải bảng nông thôn)<br>• profile gió luỹ thừa với p đô thị<br>• nguồn đường = chồng chập nguồn điểm<br>• **làm 2D trước, rồi mở 3D** |
| **Xong tuần** | `B[50,100,100]` bool + hình kiểm tra | `C_gauss[50,100,100]` + hình lát cắt |

> 🏁 **M1 — QUAN TRỌNG VỀ MẶT TÂM LÝ:** từ đây trở đi **đồ án LUÔN có kết quả để nộp**. Mọi thứ sau là nâng cấp.

---

### 🗓️ TUẦN 3 — Bộ giải FV ở 2D + nguồn phát thải → 🏁 M2

> ⭐ **Tuần này là tuần rủi ro nhất của cả đồ án.** Đây là lý do phải làm 2D trước.

| | Người A | Người B |
|---|---|---|
| **Việc** | **Nguồn phát thải.** `emissions.py`:<br>• lấy mạng đường OSM trong miền, phân theo `highway=`<br>• nhân **EF xe máy Hà Nội** (Tran et al. 2024): PM 0,053 g/km<br>• raster hoá vào voxel ở z ≈ 1 m → `S[k,j,i]`<br>• chuẩn hoá tổng theo EDGAR, ghi lại giả định | ⭐ **Bộ giải FV trên mặt cắt 2D (x–z), lưới 100 × 50:**<br>• upwind bậc 1 + khuếch tán trung tâm<br>• CFL: `Cr ≤ 0,5`<br>• biên: tường = flux 0, đất = phản xạ, ra = mở<br>• **verify**: so với Gaussian 2D trong dòng đều → sai số < 6%<br>• **verify**: kiểm bảo toàn khối lượng |
| **Xong tuần** | `S[50,100,100]` + bảng giả định phát thải | `transport_2d.py` chạy đúng + 2 đồ thị verify |

**Mẹo debug 2D:** in thẳng mảng ra `matplotlib.imshow` sau mỗi 50 bước. Lỗi dấu upwind hay lỗi biên **nhìn phát ra ngay** — chùm khói đi ngược, hoặc nồng độ âm, hoặc vệt sọc ở biên.

---

### 🗓️ TUẦN 4 — FV lên 3D + gói seminar → 🏁 M3 + 🚦 CỔNG

| | Người A | Người B |
|---|---|---|
| **Việc** | **Gói seminar** (chi tiết ở [`SEMINAR.md`](./SEMINAR.md)):<br>• làm hình: lát cắt ngang 1,5 m, mặt cắt đứng qua hẻm phố, 1 isosurface<br>• dựng slide 13 trang<br>• viết báo cáo seminar theo 5 mục bắt buộc<br>• **tập dượt bấm giờ ít nhất 2 lần** | **Mở FV lên 3D.** `03_transport.py`:<br>• thêm trục y — code gần như y hệt 2D<br>• dùng trường gió **đồng nhất** (chưa có nhà làm lệch dòng)<br>• **Kiểm định Bậc 1**: so nghiệm Gaussian giải tích 3D, mục tiêu **sai số < 6%**<br>• đo thời gian chạy, tối ưu bằng slicing nếu chậm |
| **Xong tuần** | Slide + báo cáo + hình | `transport_3d.py` đã verify + báo cáo sai số |

> ## 🚦 CỔNG QUYẾT ĐỊNH — cuối tuần 4
>
> **Câu hỏi:** bộ giải FV 3D có đạt sai số < 6% so với nghiệm giải tích không?
>
> | Trả lời | Làm gì |
> |---|---|
> | ✅ **CÓ** | Đi tiếp theo kế hoạch → Tuần 5 làm trường gió |
> | ❌ **KHÔNG** | **DỪNG phần số trị.** Chuyển sang phương án Gaussian-only: dùng `C_gauss` làm kết quả chính, mask toà nhà để che vùng trong nhà, và dồn toàn bộ T5–T8 vào **phân tích không gian + trực quan hoá + báo cáo**. Ghi rõ trong Hạn chế: *"bộ giải số trị chưa đạt kiểm chứng, đây là hướng phát triển tiếp"*. **Vẫn đúng đề bài, vẫn có đồ án hoàn chỉnh.** |
>
> ⚠️ `DECISION.md` §0.3 ghi cổng này ở tuần 5. **Roadmap siết sớm hơn một tuần để có đệm** — nếu tuần 4 gần đạt (ví dụ sai số 8–10%) thì cho thêm tuần 5 rồi chốt lại.

---

## 3. GIAI ĐOẠN 2 — Sau seminar (T5–T8)

### 🗓️ TUẦN 5 — Trường gió mass-consistent → 🏁 M4

| | Người A | Người B |
|---|---|---|
| **Việc** | **Phân tích không gian, phần 1** (chạy trên `C_gauss` trước, sau thay bằng kết quả FV):<br>• Lát cắt ngang ở z = 1,5 / 6 / 15 / 30 m<br>• Mặt cắt đứng cắt ngang hẻm phố<br>• Profile đứng tại vị trí trạm quan trắc | ⭐ **Trường gió bảo toàn khối lượng.** `02_wind.py`:<br>• khởi tạo: profile luỹ thừa `u(z)`, đặt **u = v = w = 0 bên trong nhà**<br>• giải Poisson cho λ bằng **SOR, ω = 1,78**, dừng khi `Σ\|λ^(t+1) − λ^t\| < 1e-4`<br>• hệ số mặt `e,f,g,h,m,n = 0` ở mặt tường<br>• `u = u₀ + (1/2α₁²)·∂λ/∂x` …<br>• **làm 2D trước**<br>• **kiểm: div(u) ≈ 0 ở mọi voxel khí** |
| **Xong tuần** | 3 sản phẩm phân tích | `wind_field.nc` với div ≈ 0 |

**Kiểm tra trực quan bắt buộc:** vẽ vector gió trên một lát cắt ngang ở z = 10 m. **Phải thấy dòng đi vòng qua các khối nhà.** Nếu gió đi xuyên nhà thì hệ số mặt đang sai.

---

### 🗓️ TUẦN 6 — Ghép và chạy kịch bản → 🏁 M5

| | Người A | Người B |
|---|---|---|
| **Việc** | **Phân tích không gian, phần 2:**<br>• **Isosurface** bằng `marching_cubes(C, level=50, spacing=(2,5,5))` ở ngưỡng QCVN 50 µg/m³ và WHO 15 µg/m³<br>• **Thể tích vượt ngưỡng**: `(C > ngưỡng).sum() × Δx·Δy·Δz`<br>• Chuẩn hoá lưu trữ: xarray `(time,z,y,x)`, CF, `positive="up"` → netCDF-4 | **Ghép gió vào bộ giải vận chuyển** và chạy **3 kịch bản**:<br>1. Gió ĐB mùa đông, Δ = 5 m<br>2. Gió ĐN mùa hè, Δ = 5 m<br>3. Gió ĐB, **Δ = 10 m** (kiểm độ nhạy độ phân giải)<br>• chạy tới trạng thái dừng (~800–1200 bước, dưới 1 phút/kịch bản) |
| **Xong tuần** | 2 sản phẩm phân tích + netCDF chuẩn | 3 file kết quả + bảng so sánh độ phân giải |

> 🏁 **M5 — pipeline hoàn chỉnh chạy đầu-cuối.** Từ đây chỉ còn làm đẹp và viết.

---

### 🗓️ TUẦN 7 — Phơi nhiễm, trực quan hoá, (URock nếu kịp) → 🏁 M6

| | Người A | Người B |
|---|---|---|
| **Việc** | **Phân tích không gian, phần 3:**<br>• **Phơi nhiễm mặt đứng toà nhà**: `binary_dilation(B) & ~B` → lấy mẫu C ở voxel sát tường, phân theo tầng<br>• **Phơi nhiễm dân số**: giao lát cắt z = 1,5 m với WorldPop 100 m<br>• **Trực quan hoá**: QGIS 3D view + PyVista, xuất hình độ phân giải cao cho báo cáo | **Chọn một:**<br>🅰️ Nếu lõi ổn định → **chạy URock** trong QGIS/UMEP, lấy trường gió **có cavity + wake**, chạy lại kịch bản 1, **so sánh hai trường gió** (bản đồ hiệu số + tương quan) ← *phần nâng cấp giá trị nhất*<br>🅱️ Nếu còn lỗi → sửa lỗi, tối ưu tốc độ (Numba `@njit`), làm sạch code |
| **Xong tuần** | 2 sản phẩm phân tích + bộ hình | Kết quả so sánh URock **hoặc** code đã ổn định |

> ⚠️ **Đừng bắt đầu URock sau thứ Tư tuần 7.** Nếu chưa xong trong 3 ngày thì bỏ — rủi ro cài đặt Java/H2GIS trong QGIS là thật, và tuần 8 không có chỗ cho nó.

---

### 🗓️ TUẦN 8 — Viết và bảo vệ → 🏁 M7

| | Người A | Người B |
|---|---|---|
| **Việc** | Viết chương: Bối cảnh · Dữ liệu · Quy trình xây dựng · Kết quả · Phân tích không gian<br>Làm slide bảo vệ | Viết chương: Mô hình · Phương pháp số · Kiểm chứng · **Hạn chế**<br>Chuẩn bị trả lời câu hỏi kỹ thuật |
| **Cả hai** | Đọc chéo bài của nhau · Kiểm mọi con số đều truy được nguồn · **Tập dượt bảo vệ 2 lần bấm giờ** · Đóng gói repo + README |

**Chương Hạn chế phải liệt kê đủ (đây là chương ghi điểm, không phải chương thú tội):**
1. Không có xoáy tái tuần hoàn / xoáy hẻm phố (đã cắt 7 vùng Röckle) → nồng độ trong hẻm bị ước lượng thấp
2. Khuếch tán số của upwind bậc 1 — **kèm con số K_num đo được**
3. Không có rối do giao thông (TPT) → sai lệch lúc lặng gió
4. Chỉ verification, **chưa validation** với số liệu thực nghiệm — kèm lý do
5. Lưu lượng giao thông là bất định lớn nhất, dùng proxy cấp đường OSM
6. Chiều cao toà nhà từ sản phẩm ML **chưa kiểm định ở Đông Nam Á** (trích nguyên văn cảnh báo của Google)
7. LoD1, không có hoá học, một trường gió tựa dừng mỗi lần chạy

---

## 4. Bảng theo dõi ngân sách

| Tuần | Người A (pd) | Người B (pd) | Cộng dồn |
|---|---|---|---|
| T1 | 2 | 2 | 4 |
| T2 | 2 | 2 | 8 |
| T3 | 2 | 2 | 12 |
| T4 | 2,5 | 2 | 16,5 |
| T5 | 2 | 2,5 | 21 |
| T6 | 2 | 2 | 25 |
| T7 | 2 | 2 | 29 |
| T8 | 2 | 2 | **33** |

📐 33 người-ngày — vừa khít ngân sách ~32, **không có đệm**. Nghĩa là: nếu một tuần trượt, phải cắt chứ không dồn. Thứ tự cắt khi cần: URock (T7) → phơi nhiễm dân số (T7) → kịch bản thứ 3 (T6) → isosurface (T6).

---

## 5. Quy tắc làm việc

1. **Git từ ngày đầu.** Một repo, hai nhánh, merge ở mỗi mốc. Không gửi file qua Zalo.
2. **Mỗi mốc M: cả hai phải chạy được pipeline.** 30 phút cuối mốc dành cho việc này.
3. **Lưu mọi kết quả trung gian ra netCDF**, đừng giữ trong RAM giữa các bước. Chạy lại được từng tầng độc lập.
4. **Không tối ưu sớm.** Cứ viết numpy slicing cho chạy đúng trước. Chỉ dùng Numba khi đo được là chậm thật.
5. **Mọi con số đưa vào báo cáo phải ghi nguồn ngay lúc viết**, không để cuối kỳ mới truy lại — xem `RESEARCH.md` §19.
6. **Hình ảnh xuất ≥ 300 dpi ngay từ đầu.** Vẽ lại hình vào tuần 8 là lãng phí.

---

## 6. Ba thứ dễ làm trượt lịch nhất

| Nguy cơ | Dấu hiệu sớm | Xử lý |
|---|---|---|
| **Bộ giải FV không hội tụ / ra nồng độ âm** | Xuất hiện ngay ở 2D tuần 3 | Kiểm 3 thứ theo thứ tự: (1) dấu upwind với u âm, (2) `Cr` có thực sự ≤ 0,5 không, (3) biên tường có đúng flux = 0 không. **Đừng đụng vào 3D khi 2D còn sai** |
| **Cài URock hỏng** | Lỗi Java/H2GIS khi bật plugin UMEP | Cho đúng 3 ngày. Không xong thì bỏ — nó nằm ngoài đường găng |
| **Dữ liệu chiều cao toà nhà tệ** | Phát hiện ở tuần 1 nếu làm đúng Overpass | Số hoá tay ~50 nhà ở lõi miền, và **biến nó thành phân tích độ nhạy** |
