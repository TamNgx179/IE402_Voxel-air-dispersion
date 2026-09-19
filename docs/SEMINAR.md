# SEMINAR — Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D

> **Nhóm:** ☐ ................................. · ☐ .................................
> **Thời lượng:** 10–12 phút trình bày + 3 phút hỏi đáp
> **Gói sẵn sàng:** cuối tuần 4 ([`ROADMAP.md`](./ROADMAP.md) mốc M3)
> **Tài liệu nền:** [`RESEARCH.md`](./RESEARCH.md) (số liệu + nguồn) · [`DECISION.md`](./DECISION.md) (phương án + lý do)

---

## 0. Checklist hành chính

Theo đúng yêu cầu của môn:

| # | Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | **Tối đa 2 sinh viên/nhóm** | ☐ | Nhóm 2 người — đạt |
| 2 | **Mỗi đề tài chỉ 1 nhóm** — nguyên tắc **đăng ký trước** | ☐ | ⚠️ **Làm NGAY.** Đề tài này hấp dẫn, ai điền trước được trước |
| 3 | **Điền tên nhóm/thành viên** vào cột *"Nhóm đăng ký"*, sheet *"Danh sách đề tài"* | ☐ | Kiểm lại sau khi điền xem đã lưu chưa |
| 4 | Báo cáo đủ **5 mục bắt buộc** (§1 dưới đây) | ☐ | |
| 5 | Trình bày **10–12 phút** + 3 phút hỏi đáp | ☐ | **Bấm giờ tập ít nhất 2 lần** |
| 6 | **Hạn chót đăng ký và nộp báo cáo** — do GV thông báo trên lớp/LMS | ☐ | ⚠️ **Hỏi/kiểm LMS ngay tuần này**, vì lộ trình 8 tuần được neo vào mốc này |

> 🔴 **Hai việc làm trong 48 giờ tới:** (1) điền tên vào sheet để giữ đề tài; (2) xác nhận hạn chót trên LMS rồi dịch lại lịch trong `ROADMAP.md` cho khớp.

---

## 1. Dàn bài báo cáo seminar — 5 mục bắt buộc

> Đề bài yêu cầu đúng 5 mục sau. Dưới mỗi mục là **nội dung soạn sẵn** — chỗ `【...】` là nơi nhóm điền số liệu của chính mình.

---

### 1.1 ▸ Bối cảnh ứng dụng thực tế

**Vấn đề.** Ô nhiễm không khí đô thị ở Việt Nam bị chi phối bởi **giao thông**, trong đó **xe máy là nguồn phát thải chủ đạo** — khác hẳn các thành phố châu Âu/Bắc Mỹ nơi hầu hết mô hình chuẩn được hiệu chỉnh.

Số liệu kiểm kê đã công bố cho TP.HCM: hoạt động giao thông đường bộ chiếm **88% NOₓ, 99% CO, 79% SO₂, 99% NMVOC và 88% PM** trong phát thải ngành giao thông ([Ho et al. 2020](https://doi.org/10.34154/2020-jue-0101-29-38/euraass)).

**So sánh chuẩn.** Ngưỡng PM2.5 trung bình năm của **QCVN 05:2023/BTNMT là 25 µg/m³** — cao **gấp 5 lần** khuyến nghị WHO 2021 (**5 µg/m³**); ngưỡng 24 giờ (50) cao **gấp hơn 3 lần** mức WHO (15).

**Tại sao phải 3D chứ không phải bản đồ 2D** — đây là lập luận cốt lõi của đề tài. Nguồn trích dẫn: [Ridzuan et al. 2020](https://doi.org/10.5194/isprs-archives-XLIV-4-W3-2020-355-2020) chỉ ra **3 khiếm khuyết của trực quan hoá 2D** trong quản lý chất lượng không khí:

1. Không biểu diễn được **thông tin theo phương đứng**
2. Không định vị chính xác được **vị trí 3D** của chất ô nhiễm
3. Biểu diễn kém các **mô hình gió theo không gian**

Bổ sung ba lập luận vật lý:

- **Nồng độ biến thiên rất mạnh theo độ cao.** Người đi bộ (z ≈ 1,5 m), người ở tầng 2 (z ≈ 6 m) và người ở tầng 15 (z ≈ 45 m) chịu phơi nhiễm khác nhau — bản đồ 2D chỉ trả về **một con số cho cả toà nhà**.
- **Hẻm phố tạo xoáy tái tuần hoàn**, giữ chất ô nhiễm ở mặt khuất gió và làm loãng ở mặt đón gió — hiện tượng thuần 3D.
- **Nguồn cao** phát thải ở độ cao hiệu dụng H = h_ống khói + Δh, chùm khói chạm đất ở khoảng cách xa — không mô tả được bằng raster 2D.

**Ứng dụng thực tế của kết quả:** xác định tầng nào của toà nhà vượt ngưỡng · chọn vị trí đặt trạm quan trắc · đánh giá phương án quy hoạch (mở rộng đường, trồng cây, vùng phát thải thấp) · tính phơi nhiễm dân số theo độ cao.

---

### 1.2 ▸ Mô hình và dữ liệu GIS 3D sử dụng

#### a) Mô hình dữ liệu GIS 3D: **voxel / 3D array**

Nồng độ chất ô nhiễm là một **trường vô hướng thể tích**. Trong các mô hình dữ liệu 3D của GIS, chỉ voxel lưu được giá trị tại **mọi** điểm trong khối không khí:

| Mô hình | Lưu gì | Bản chất chiều |
|---|---|---|
| Raster 2.5D (DEM/DSM) | một z cho mỗi ô (x,y) | hàm z = f(x,y); không biểu diễn được trường phía trên mặt đất |
| TIN | mặt tam giác hoá | mặt 2.5D |
| B-rep solid (CityGML) | các mặt **biên** của khối | 3D nhưng **chỉ biên**, phần trong là ngầm định |
| Point cloud | mẫu 3D bất quy tắc | không lấp đầy không gian |
| ⭐ **Voxel / 3D array** | giá trị tại **mọi** ô lưới 3D đều | **trường 3D** — định nghĩa ở mọi điểm |

Tham chiếu học thuật: [Gorte et al. 2024](https://doi.org/10.5194/isprs-annals-X-4-2024-133-2024) đề xuất voxel hoá như **cơ chế chuẩn hoá** các bộ dữ liệu 3D không đồng nhất, vì dữ liệu cấu trúc voxel *"thoả mãn hầu hết các yêu cầu về tính hợp lệ và toàn vẹn"*. [Ridzuan et al. 2024](https://doi.org/10.22059/poll.2023.360562.1942) dùng chính voxel hoá cho mô hình hoá môi trường đô thị.

**Thông số lưới:**

| | |
|---|---|
| Miền | 500 m × 500 m × 100 m |
| Δx = Δy = **5 m**, Δz = **2 m** | Căn cứ: [CAIRDIO](https://doi.org/10.5194/gmd-14-1469-2021) — NMSE **0,10 ở 5 m → 1,35 ở 20 m** |
| Kích thước | 100 × 100 × 50 = **500.000 voxel** |
| Bộ nhớ | **2 MB/trường** ở float32 |
| LoD toà nhà | **LoD1** (extrude footprint) — ở voxel 5 m, mái dốc LoD2 không sống sót qua rời rạc hoá ([García-Sánchez et al. 2021](https://doi.org/10.5194/isprs-archives-XLVI-4-W4-2021-67-2021)) |

#### b) Mô hình vật lý: **hai mô hình ghép lại**

```
MÔ HÌNH 1 — TRƯỜNG GIÓ
  "Mô hình gió chẩn đoán bảo toàn khối lượng" (mass-consistent diagnostic wind model)
  Phương pháp biến phân Sasaki (1970). Họ mô hình của CALMET, MATHEW/ABLE.
  ⟶ Trả lời: gió thổi thế nào quanh các toà nhà?    Đầu ra: (u,v,w) tại MỌI voxel

MÔ HÌNH 2 — PHÁT TÁN
  Phương trình tải–khuếch tán, giải bằng thể tích hữu hạn (finite volume)
  ⟶ Trả lời: chất ô nhiễm đi đâu?                    Đầu ra: C tại MỌI voxel
```

**Mô hình 1 hoạt động thế nào (nói ngắn):** khởi tạo trường gió bằng profile luỹ thừa `u(z) = u_ref·(z/z_ref)^p`, đặt vận tốc **bằng 0 bên trong toà nhà**. Trường đó **sai về mặt vật lý** vì khí vào một voxel nhiều hơn khí ra (divergence ≠ 0). Hiệu chỉnh bằng cách giải phương trình Poisson cho nhân tử Lagrange λ:

```
∂²λ/∂x² + ∂²λ/∂y² + (α₁/α₂)²·∂²λ/∂z² = R        (R = divergence của trường thô)
```

giải bằng **SOR (ω = 1,78)**, rồi `u = u₀ + (1/2α₁²)·∂λ/∂x`. **Toà nhà đi vào bài toán qua hệ số mặt voxel** — đặt bằng 0 ở mặt nào là tường.

⭐ **Vì sao rẻ:** mô hình này **không giải phương trình động lượng (Navier–Stokes)**. Không có mô hình rối, không có bước thời gian. Đó là lý do nó nhanh hơn LES **hai đến ba bậc độ lớn** ([Front. Earth Sci. 2023](https://doi.org/10.3389/feart.2023.1251056)).

**Mô hình 2:** phương trình mà mọi mô hình CFD đều giải —
`∂C/∂t + ∇·(uC) − ∇·(K∇C) = S` — rời rạc bằng upwind bậc 1 + khuếch tán trung tâm, sơ đồ hiện, `Cr ≤ 0,5`.

**Baseline:** mô hình **chùm khói Gaussian giải tích** với hệ số phát tán **Briggs ĐÔ THỊ**, dùng để kiểm chứng bộ giải số và để so sánh.

#### c) Dữ liệu

| Nhu cầu | Nguồn | Ghi chú |
|---|---|---|
| Footprint toà nhà | **OSM** (Geofabrik VN / Overpass), ODbL | Hình học tốt ở nội đô VN |
| **Chiều cao toà nhà** | **Google Open Buildings 2.5D Temporal** (4 m hiệu dụng) + `building:levels × 3 m` | ⚠️ MAE 1,5 m nhưng Google ghi rõ *"đánh giá chỉ giới hạn ở Bắc Mỹ, châu Âu và Nhật Bản — không phải Global South"* |
| Địa hình | **Copernicus DEM GLO-30** (< 4 m, 90% LE) | ⚠️ Là **DSM** (đã chứa nhà) → không extrude nhà lên trên nó |
| Khí tượng | **Open-Meteo** — miễn phí, không cần key, **19 mực áp suất + geopotential height + PBL height** | Nguồn miễn phí duy nhất cho **profile gió đứng thật** |
| **Phát thải giao thông** | **Tran et al. 2024** — EF xe máy Hà Nội, **open access**: PM **0,053 g/km**, CO 4,8, NOₓ 0,13 | **Đo tại chỗ ở Hà Nội** — dùng thay giá trị COPERT châu Âu |
| Lưu lượng giao thông | Cấp đường OSM làm bộ phân bổ **tương đối** + chuẩn hoá theo EDGAR | ⚠️ **Không có bộ đếm mở nào cho Hà Nội/TP.HCM** — bất định lớn nhất |
| Dân số (phơi nhiễm) | **WorldPop VNM 100 m** UN-adjusted | CC BY 4.0 |
| Quan trắc đối chiếu | **US Embassy Hà Nội** (AirNow, cấp tham chiếu) + **OpenAQ v3** | |
| Ngưỡng đánh giá | **QCVN 05:2023/BTNMT** + **WHO 2021** | |

#### d) Công nghệ

Python (**numpy · scipy · xarray · rasterio · geopandas**) · QGIS · lưu trữ **netCDF-4 chuẩn CF** với `positive="up"` (mở được bằng QGIS/ArcGIS/Panoply) · trực quan hoá **PyVista + QGIS 3D view**.

---

### 1.3 ▸ Quy trình xây dựng

```
TẦNG 0 — HÌNH HỌC                                        【~4 người-ngày】
  OSM footprint + chiều cao  →  raster hoá  →  H[y,x]
  →  extrude:  B[k,j,i] = ( Z[k] < H[j,i] )     ⟹ mảng chiếm chỗ 3D
  →  raster hoá mạng đường × EF xe máy           ⟹ mảng nguồn S[k,j,i]
                              ↓
TẦNG 1 — TRƯỜNG GIÓ                                      【~6 người-ngày】
  (a) profile luỹ thừa u(z), đặt u=v=w=0 trong nhà   ⟹ (u₀,v₀,w₀), div ≠ 0
  (b) giải Poisson cho λ bằng SOR (ω = 1,78), dừng khi Σ|Δλ| < 1e-4
  (c) u = u₀ + (1/2α₁²)·∂λ/∂x  …                    ⟹ (u,v,w), div ≈ 0
                              ↓
TẦNG 2 — VẬN CHUYỂN                                      【~10 người-ngày】
  ∂C/∂t + ∇·(uC) − ∇·(K∇C) = S
  upwind bậc 1 + khuếch tán trung tâm, sơ đồ hiện, Cr ≤ 0,5
  chạy tới trạng thái dừng (~800–1200 bước ≈ dưới 1 phút)
                              ↓                    ⟹ C[k,j,i]
TẦNG 3 — PHÂN TÍCH KHÔNG GIAN + TRỰC QUAN HOÁ            【~8 người-ngày】
  lát cắt · mặt cắt đứng · profile đứng · isosurface ·
  thể tích vượt ngưỡng · phơi nhiễm mặt đứng · phơi nhiễm dân số
                              ↓
  netCDF-4 (CF)  +  hình PyVista / QGIS 3D
```

**Chiến thuật triển khai — điểm đáng nói trong seminar:** cả Tầng 1 và Tầng 2 đều được **viết ở 2D trước** (mặt cắt x–z, lưới 100 × 50), kiểm chứng xong mới mở lên 3D. Lý do: ở 2D một lỗi dấu upwind hay lỗi điều kiện biên **nhìn ra ngay bằng mắt**, còn ở 3D chỉ thấy "số ra kỳ kỳ".

**Kiểm chứng:** so bộ giải số với **nghiệm Gaussian giải tích** trong dòng đều, không toà nhà. Mục tiêu sai số < 6% (mốc tham chiếu: QES-Plume đạt **5,91%**). Cộng thêm kiểm **bảo toàn khối lượng**: tổng khối lượng trong miền + lượng thoát ra biên = tổng đã phát thải.

---

### 1.4 ▸ Kết quả minh hoạ

> 🔴 **Mục này BẮT BUỘC phải có hình do nhóm tự tính** — đề bài ghi rõ *"kết quả minh hoạ (hình ảnh/demo)"*. Seminar **không được** chỉ là bài review lý thuyết.

**Bộ hình tối thiểu cho seminar (4 hình):**

| # | Hình | Cho thấy điều gì |
|---|---|---|
| **H1** | **Mô hình voxel thành phố** — mảng chiếm chỗ 3D dựng từ OSM, render bằng PyVista | Sản phẩm GIS 3D: *"đây là thành phố ở dạng mảng 3D"* |
| **H2** | **Lát cắt ngang** nồng độ ở **z = 1,5 m** và **z = 15 m**, cạnh nhau | ⭐ Bằng chứng trực quan mạnh nhất cho luận điểm "phải 3D": **hai bản đồ khác hẳn nhau** |
| **H3** | **Mặt cắt đứng** cắt ngang một hẻm phố, kèm vector gió | Cấu trúc theo độ cao + dòng khí đi vòng qua nhà |
| **H4** | **Bề mặt đẳng trị** (marching cubes) ở ngưỡng **QCVN 50 µg/m³** và **WHO 15 µg/m³** lồng nhau | Hai "bong bóng" lồng nhau — hình ảnh đắt nhất về mặt truyền thông |

**Nếu kịp, thêm:**
- **H5** — Đồ thị **kiểm chứng**: nghiệm số vs nghiệm Gaussian giải tích, kèm sai số 【...%】
- **H6** — **Profile đứng** nồng độ theo z tại 3 vị trí (giữa hẻm / trên mái / khoảng trống)

**Số liệu cần điền khi có kết quả:**

| Đại lượng | Giá trị |
|---|---|
| Nồng độ PM2.5 mực người đi bộ (z = 1,5 m), trung bình miền | 【...】 µg/m³ |
| Nồng độ tại z = 15 m, trung bình miền | 【...】 µg/m³ |
| Tỉ lệ giảm theo độ cao (1,5 m → 15 m) | 【...】 % |
| Thể tích vượt ngưỡng QCVN 24h (50 µg/m³) | 【...】 m³ |
| Thể tích vượt ngưỡng WHO 24h (15 µg/m³) | 【...】 m³ |
| Sai số kiểm chứng so với nghiệm giải tích | 【...】 % |
| Thời gian chạy một kịch bản | 【...】 giây |

---

### 1.5 ▸ Đánh giá ưu – nhược điểm

#### ✅ Ưu điểm

| Ưu điểm | Cụ thể |
|---|---|
| **Đúng bản chất bài toán** | Nồng độ là trường thể tích; voxel lưu giá trị ở **mọi** điểm trong khối khí, kể cả trên mái và trong hẻm |
| **Phân giải được toà nhà** | Gió **đi vòng qua nhà** và khối lượng được bảo toàn — khác hẳn mô hình Gaussian phẳng |
| **Chi phí thấp** | 500.000 voxel, 2 MB/trường, một kịch bản chạy **dưới 1 phút trên laptop** |
| **Minh bạch** | Tự viết từng dòng → giải thích được mọi con số. Phần mềm hộp đen không làm được |
| **Bảo toàn khối lượng chính xác** | Sơ đồ thể tích hữu hạn bảo toàn đến độ chính xác máy — kiểm được bằng số |
| **Có phân tích ổn định viết ra được** | CFL, von Neumann |
| **Dữ liệu lấy được hết ở Việt Nam** | OSM + Google Open Buildings + Open-Meteo + EF xe máy Hà Nội, tất cả miễn phí |
| **Kết quả dùng lại được** | netCDF-4 chuẩn CF → mở trực tiếp trong QGIS/ArcGIS |

#### ❌ Nhược điểm — **nói thẳng, đây là mục ghi điểm**

| Nhược điểm | Mức | Ảnh hưởng cụ thể |
|---|---|---|
| **Không có xoáy tái tuần hoàn sau nhà và xoáy hẻm phố** | **Cao** | Đã lược bỏ phần tham số hoá thực nghiệm (7 vùng Röckle) vì vượt ngân sách. Hệ quả: **nồng độ trong hẻm phố bị ước lượng THẤP** |
| **Khuếch tán số** | **Cao** | Upwind bậc 1 sinh khuếch tán giả `K_num ≈ ½·u·Δx·(1−Cr)`. Với u = 3 m/s, Δx = 5 m thì cỡ **vài m²/s — so sánh được với khuếch tán rối vật lý**. Làm chùm khói nhoè hơn thực tế |
| **Không có rối do giao thông (TPT)** | Cao | [OSPM](https://envs.au.dk/en/research-areas/air-pollution-emissions-and-effects/the-monitoring-program/air-pollution-models/ospm/description-of-the-ospm-model) nêu rõ: *"lặng gió → cơ chế phát tán duy nhất là TPT"*. Thiếu nó → **sai lệch lớn nhất đúng lúc ô nhiễm nặng nhất** |
| **Chỉ verification, chưa validation** | Cao | Mới so với nghiệm giải tích, **chưa so với số liệu hầm gió hay hiện trường**. Lý do: dựng lại hình học Michelstadt + trích 196 điểm cảm biến vượt ngân sách |
| **Bất định lưu lượng giao thông** | **Rất cao** | Không có bộ đếm mở nào cho Hà Nội/TP.HCM → dùng cấp đường OSM làm proxy tương đối |
| **Chiều cao toà nhà chưa kiểm định ở Đông Nam Á** | Cao | Nhà ống Việt Nam (hẹp, cao, san sát) là ca khó cho sản phẩm suy từ Sentinel-2 ở 4 m |
| **LoD1** | Thấp | Nhà là khối hộp, không có mái dốc. Ở voxel 5 m thì hợp lý |
| **Không có hoá học** | TB | Đúng với PM2.5; **sai với NO₂** (phản ứng NO+O₃). Nên chọn PM2.5 |
| **Một trường gió tựa dừng mỗi lần chạy** | TB | Chạy nhiều kịch bản thay vì chuỗi thời gian liên tục |

#### 📊 Đặt phương án vào bối cảnh

| | Gaussian | ⭐ **Phương án nhóm** | Röckle đầy đủ | CFD RANS | LES |
|---|---|---|---|---|---|
| Toà nhà làm lệch dòng | ❌ | ✅ | ✅ | ✅ | ✅ |
| Xoáy tái tuần hoàn | ❌ | ❌ | ✅ | ✅ | ✅ |
| Chi phí | giây | **< 1 phút** | 2–10 phút | vài phút–giờ | **4.744 GPU-giờ** |
| Khả thi 2 SV / 8 tuần | ✅ | ✅ | 🟡 | ❌ | ❌ |

**Kết luận đánh giá:** phương án nằm ở **bậc thang đầu tiên** của thang đánh đổi độ-chính-xác/chi-phí — bậc rẻ nhất mà đổi được nhiều nhất về mặt "đây có phải mô hình 3D thật không". Bậc tiếp theo (Röckle đầy đủ) chỉ đắt thêm ~2× và là hướng phát triển ngay trước mắt; bậc LES đắt thêm ~1000× và nằm ngoài tầm một đồ án môn học.

---

## 2. Kịch bản trình bày — 11 phút

| # | Slide | Phút | Nội dung |
|---|---|---|---|
| 1 | **Tiêu đề + nhóm** | 0:00–0:20 | Tên đề tài, 2 thành viên |
| 2 | **Bối cảnh: vì sao Việt Nam** | 0:20–1:30 | Giao thông = 88% NOₓ / 99% CO / 88% PM ở TP.HCM · xe máy là nguồn chủ đạo · **PM2.5: QCVN 25 vs WHO 5 µg/m³ — gấp 5 lần** |
| 3 | ⭐ **Vì sao phải 3D** | 1:30–2:30 | 3 khiếm khuyết của 2D (Ridzuan 2020) + người đi bộ 1,5 m vs tầng 15 ở 45 m + xoáy hẻm phố là hiện tượng thuần 3D |
| 4 | **Đề tài và mô hình dữ liệu** | 2:30–3:10 | Bảng so sánh voxel vs TIN/B-rep/point cloud. **Nồng độ là trường thể tích → chỉ voxel lưu giá trị ở mọi điểm** |
| 5 | ⭐⭐ **Bản đồ 6 tầng mô hình** | 3:10–4:40 | **Slide quan trọng nhất.** Box → Gaussian → Canyon → **mass-consistent+voxel** → CFD → LES → CTM |
| 6 | ⭐ **Trade-off bằng CON SỐ** | 4:40–5:40 | Phương án nhóm **< 1 phút** · URock 2–10 phút · OpenFOAM RANS "vài phút" song song · **LES 4.744 GPU-giờ = 6,7 ngày trên 32 GPU** · CTM 11.520 CPU-giờ → **2–3 bậc độ lớn** |
| 7 | **Độ phân giải nào là đủ** | 5:40–6:15 | CAIRDIO: NMSE **0,10 ở 5 m → 0,25 ở 10 m → 1,35 ở 20 m** → chọn 5 m |
| 8 | **Quyết định + sơ đồ 4 tầng** | 6:15–7:15 | Sơ đồ §1.3. Nhấn: **mọi tầng đều native voxel, Tầng 1 và 2 dùng chung một mảng** |
| 9 | **Dữ liệu** | 7:15–7:55 | OSM + Google Open Buildings 2.5D + Open-Meteo 19 mực + **EF xe máy Hà Nội đo tại chỗ, open access** |
| 10 | ⭐⭐ **KẾT QUẢ** | 7:55–9:25 | **H1 voxel city · H2 hai lát cắt 1,5 m vs 15 m · H3 mặt cắt đứng · H4 isosurface**. Nói rõ đây là prototype giai đoạn nào |
| 11 | **Ưu – nhược điểm** | 9:25–10:25 | Ưu 4 gạch đầu dòng. **Nhược nói thật**: thiếu xoáy hẻm phố, khuếch tán số, chưa validation, bất định giao thông |
| 12 | **Hướng phát triển (→ đồ án)** | 10:25–10:55 | Thêm 7 vùng Röckle · validation với hầm gió Michelstadt · nhiều kịch bản · web 3D |
| 13 | **Tài liệu tham khảo** | 10:55–11:00 | 8–10 nguồn chính |

### Ba câu phải nói

1. > *"Nồng độ chất ô nhiễm là một trường vô hướng thể tích. Chỉ mô hình voxel mới lưu một giá trị ở mọi điểm trong khối không khí — kể cả phía trên mái nhà và bên trong hẻm phố."*
2. > *"Khoảng cách chi phí giữa mô hình gió chẩn đoán và LES là hai đến ba bậc độ lớn: bên này chạy dưới một phút trên laptop, bên kia tốn 4.744 GPU-giờ cho một ca. Với hai người và tám tuần, con số đó quyết định phương án."*
3. > *"Mô hình của em chưa có xoáy tái tuần hoàn trong hẻm phố, nên nồng độ trong hẻm bị ước lượng thấp. Em nêu rõ điều đó thay vì giấu, và đó là hạng mục đầu tiên trong hướng phát triển."*

### Phân vai khi trình bày

| | Slide | Lý do |
|---|---|---|
| **Người A** | 1–4, 9–10 | Bối cảnh, dữ liệu, kết quả — phần trực quan |
| **Người B** | 5–8, 11–12 | Mô hình, trade-off, đánh giá — phần kỹ thuật |
| Cả hai | Hỏi đáp | Ai nắm mảng nào thì trả lời mảng đó |

---

## 3. Chuẩn bị 3 phút hỏi đáp

| Câu hỏi dự kiến | Trả lời |
|---|---|
| **"Sao không dùng CFD cho chính xác?"** | Chia lưới `snappyHexMesh` trên hình học đô thị thật tốn 4–6 tuần trước khi chạm tới phát tán, và nghiên cứu Michelstadt ghi rõ kỹ năng mô hình phụ thuộc một hằng số *"tối ưu tuỳ ca và không biết trước"*. Em giữ CFD làm tầng trên của thang so sánh. |
| **"Mô hình có kiểm định không?"** | Có **verification** — so với nghiệm Gaussian giải tích, sai số 【...%】, mục tiêu < 6% (mốc QES-Plume 5,91%), cộng kiểm bảo toàn khối lượng. **Chưa có validation** với số liệu thực nghiệm, vì dựng lại hình học Michelstadt và trích 196 điểm cảm biến vượt ngân sách 8 tuần. Em nêu rõ trong Hạn chế. |
| **"Số liệu giao thông lấy ở đâu?"** | **Không có bộ đếm mở nào cho Hà Nội.** Em dùng cấp đường OSM làm bộ phân bổ **tương đối**, nhân hệ số phát thải xe máy **đo tại Hà Nội** (Tran et al. 2024, open access), rồi chuẩn hoá tổng theo EDGAR. Đây là bất định lớn nhất của đồ án. |
| **"Chiều cao toà nhà có chính xác không?"** | Google Open Buildings 2.5D báo MAE 1,5 m, **nhưng chính Google ghi rằng đánh giá đó chỉ làm ở Bắc Mỹ, châu Âu và Nhật Bản, không phải Global South.** Nhà ống Việt Nam là ca khó cho sản phẩm 4 m từ Sentinel-2. Em đối chứng với `building:levels` của OSM. |
| **"Voxel 5 m có đủ mịn không?"** | CAIRDIO cho thấy NMSE tăng từ 0,10 ở 5 m lên 1,35 ở 20 m — 5 m là chỗ mô hình chưa mất kỹ năng nhanh. Em chạy thêm ở 10 m để kiểm độ nhạy. |
| **"Khuếch tán số ảnh hưởng thế nào?"** | Upwind bậc 1 sinh khuếch tán giả cỡ ½·u·Δx·(1−Cr). Với u = 3 m/s, Δx = 5 m thì cỡ vài m²/s — **so sánh được với khuếch tán rối vật lý**. Em đo và báo cáo con số này như hạn chế đã lượng hoá. |
| **"Sao không dùng ảnh vệ tinh kiểm định?"** | Sentinel-5P cho **cột đứng tầng đối lưu** (mol/m²), không phải nồng độ bề mặt. So trực tiếp với µg/m³ mặt đất là sai về vật lý. Vệ tinh dùng cho mẫu hình không gian và điểm nóng thôi. |
| **"Đây có phải mô hình Röckle không?"** | **Không hẳn.** Röckle = tham số hoá thực nghiệm 7 vùng **+** bảo toàn khối lượng. Em chỉ cài vế thứ hai, nên gọi đúng là **mô hình gió chẩn đoán bảo toàn khối lượng** — họ của CALMET và MATHEW. Phần 7 vùng là hướng phát triển tiếp. |
| **"Có gì mới so với các bài đã công bố?"** | Em **không tuyên bố novelty phương pháp**. Đóng góp là một pipeline mở, đầu-cuối, cho một địa bàn Việt Nam, với các cảnh báo chất lượng dữ liệu cho bối cảnh Việt Nam được nêu rõ. Tiền lệ gần nhất là Shi et al. 2020 (3D grid + CA) và Jjumba & Dragićević 2015 (voxel automata). |
| **"Sao chọn PM2.5 mà không phải NO₂?"** | PM2.5 là chất **thụ động, không phản ứng**, hợp với giả định của mô hình. NO₂ có phản ứng NO+O₃ với thời gian phản ứng so sánh được với thời gian lưu trong hẻm phố, cần thêm module hoá học. |

---

## 4. Checklist trước ngày trình bày

**Nội dung**
- [ ] Đủ **5 mục bắt buộc** trong báo cáo (§1)
- [ ] **≥ 4 hình kết quả do nhóm tự tính** (H1–H4)
- [ ] Mọi con số trên slide **truy được về nguồn**
- [ ] Không còn mục ⚠️/🔴 nào bị trích mù (xem `RESEARCH.md` §18)
- [ ] Slide "Nhược điểm" **không né tránh** — nêu đủ 4 hạn chế chính

**Kỹ thuật trình bày**
- [ ] **Bấm giờ tập ≥ 2 lần**, mỗi lần đủ 10–12 phút
- [ ] Chốt phân vai từng slide
- [ ] Hình xuất **≥ 300 dpi**, chữ trên hình đọc được từ cuối phòng
- [ ] Slide dự phòng (backup) cho các câu hỏi §3: bảng thông số lưới, đồ thị kiểm chứng, bảng dữ liệu
- [ ] File slide có **bản PDF dự phòng** (phòng khi máy phòng học không mở được)

**Hành chính**
- [ ] Đã điền tên nhóm vào sheet *"Danh sách đề tài"*
- [ ] Đã nộp báo cáo đúng hạn GV thông báo trên LMS
- [ ] Biết trước phòng, thiết bị, thứ tự trình bày
