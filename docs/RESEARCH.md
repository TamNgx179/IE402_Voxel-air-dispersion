# RESEARCH — Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D (voxel)

> **Đề tài:** Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D
> **Kỹ thuật GIS 3D trọng tâm:** Mô hình 3D Array / voxel, phân tích không gian
> **Ngày tổng hợp:** 2026-09-19
> **File đi kèm:** [`DECISION.md`](./DECISION.md) — chốt phương án, lý do, kế hoạch triển khai.

---

## 0. Cách đọc tài liệu này

Tài liệu này **chỉ mô tả và so sánh**, không chốt phương án. Phần chốt nằm ở `DECISION.md`.

Mỗi khẳng định có gắn link nguồn gốc. Quy ước độ tin cậy:

| Ký hiệu | Nghĩa |
|---|---|
| ✅ | Đã đọc trực tiếp trang/tài liệu gốc trong quá trình research |
| ⚠️ | Có nguồn (DOI/URL thật) nhưng **nội dung chưa đọc được** (paywall, 403, PDF không trích xuất được) — phải tự mở trước khi trích dẫn vào báo cáo |
| 🔴 | Con số đang **mâu thuẫn giữa các nguồn** — bắt buộc tự kiểm chứng |
| 📐 | Suy luận/tính toán của nhóm, **không phải trích dẫn** |

> **Cảnh báo học thuật quan trọng:** những mục gắn ⚠️ và 🔴 **không được** đưa nguyên số vào báo cáo/slide nếu chưa tự mở tài liệu gốc. Đây đúng là chỗ giảng viên hay hỏi vặn. Danh sách đầy đủ (37 mục) ở **§18**.

---

## 1. Bối cảnh ứng dụng thực tế

### 1.1 Vấn đề

Ô nhiễm không khí đô thị ở Việt Nam (Hà Nội, TP.HCM) bị chi phối bởi **giao thông**, trong đó **xe máy là nguồn phát thải chủ đạo** — khác hẳn các thành phố châu Âu/Bắc Mỹ nơi hầu hết mô hình chuẩn được hiệu chỉnh.

Số liệu kiểm kê đã công bố cho TP.HCM: hoạt động giao thông đường bộ chiếm **88% NOₓ, 99% CO, 79% SO₂, 99% NMVOC và 88% PM** trong phát thải ngành giao thông ✅ ([Ho et al. 2020, DOI 10.34154/2020-jue-0101-29-38](https://doi.org/10.34154/2020-jue-0101-29-38/euraass)).

### 1.2 Tại sao phải là 3D chứ không phải bản đồ 2D

Đây là lập luận sống còn của đề tài. Nguồn trích dẫn tốt nhất là bài review của Ridzuan et al. (2020) ✅ ([ISPRS Archives XLIV-4/W3-2020, 355–363](https://isprs-archives.copernicus.org/articles/XLIV-4-W3-2020/355/2020/)), chỉ ra **3 hạn chế của trực quan hoá 2D** trong quản lý chất lượng không khí:

1. Không biểu diễn được **thông tin theo phương đứng**;
2. Không định vị chính xác được vị trí 3D của chất ô nhiễm;
3. Biểu diễn kém các **mô hình gió theo không gian**.

Bổ sung 3 lập luận vật lý (📐, nhưng có nguồn hỗ trợ từng phần):

- **Nồng độ biến thiên rất mạnh theo độ cao.** Một người đi bộ (z ≈ 1,5 m), một người ở tầng 2 (z ≈ 6 m) và một người ở tầng 15 (z ≈ 45 m) chịu phơi nhiễm khác nhau — bản đồ 2D chỉ trả về **một con số cho cả toà nhà**.
- **Hẻm phố (street canyon) tạo xoáy tái tuần hoàn.** Chất ô nhiễm bị giữ lại ở mặt khuất gió (leeward) và loãng ở mặt đón gió (windward) — đây là hiện tượng thuần 3D ✅ ([mô tả OSPM, Aarhus DCE](https://envs.au.dk/en/research-areas/air-pollution-emissions-and-effects/the-monitoring-program/air-pollution-models/ospm/description-of-the-ospm-model)).
- **Ống khói / nguồn cao** phát thải ở độ cao hiệu dụng H = h_stack + Δh, chùm khói chạm đất ở khoảng cách xa — không thể mô tả bằng raster 2D.

### 1.3 Tiêu chuẩn tham chiếu

**QCVN 05:2023/BTNMT** — ban hành theo Thông tư 01/2023/TT-BTNMT (13/03/2023), **hiệu lực 12/09/2023**, thay thế QCVN 05:2013 và QCVN 06:2009; bao 7 thông số cơ bản: SO₂, CO, NO₂, O₃, TSP, PM10, PM2.5 ✅ ([luatvietnam.vn](https://luatvietnam.vn/tai-nguyen/quy-chuan-viet-nam-qcvn-05-2023-btnmt-245815-d3.html) · [bản PDF gov.vn](http://huulung.langson.gov.vn/upload/105417/20250327/01-btnmt-qc05_a74c1.pdf)).

| Chất | 1 giờ | 8 giờ | 24 giờ | Trung bình năm | Độ tin cậy |
|---|---|---|---|---|---|
| **PM2.5** | — | — | **50 µg/m³** | **25 µg/m³** | ✅ hai nguồn độc lập khớp nhau |
| SO₂ | 350 | — | 125 | 50 | ⚠️ một nguồn |
| CO | 30.000 | 10.000 | — | — | ⚠️ một nguồn |
| NO₂ | 200 | — | 100 | 40 | ⚠️ một nguồn |
| O₃ | 200 | 120 | — | — | ⚠️ một nguồn |
| PM10, TSP, Pb | — | — | *mâu thuẫn* | *mâu thuẫn* | 🔴 **phải tự đọc Bảng 1 trong PDF** |

**WHO 2021 Global Air Quality Guidelines** ✅ ([WHO, ISBN 9789240034228](https://www.who.int/publications/i/item/9789240034228); số liệu lấy qua [EEA](https://www.eea.europa.eu/en/analysis/publications/europes-air-quality-status-2024) vì WHO đăng bảng dưới dạng **ảnh**, không phải text):

| Chất | Chu kỳ | Mức AQG 2021 |
|---|---|---|
| PM2.5 | năm / 24h | **5** / **15** µg/m³ |
| PM10 | năm / 24h | **15** / **45** µg/m³ |
| NO₂ | năm / 24h | **10** / **25** µg/m³ |
| O₃ | mùa cao điểm 8h / 8h | **60** / **100** µg/m³ |

📐 **Điểm nhấn cho báo cáo:** ngưỡng PM2.5 trung bình năm của Việt Nam (**25**) cao **gấp 5 lần** khuyến nghị WHO (**5**); ngưỡng 24 giờ (**50**) cao **gấp hơn 3 lần** mức WHO (**15**). Vẽ kết quả mô phỏng đối chiếu **cả hai ngưỡng** là một phần Kết quả rất mạnh.

---

## 2. Khung phân tầng các họ mô hình phát tán

Toàn bộ tài liệu này tổ chức theo **6 tầng**, sắp từ rẻ/thô đến đắt/chính xác. Đây là khung để so sánh và cũng là khung để trình bày trong seminar.

| Tầng | Họ mô hình | Ý tưởng cốt lõi | Chi phí tính toán | Có toà nhà? | Ra trường 3D? |
|---|---|---|---|---|---|
| **T0** | Box model | Toàn thành phố = 1 hộp trộn đều | Không đáng kể | Không | **Không** |
| **T1** | Gaussian plume / puff | Nghiệm giải tích của phương trình khuếch tán | Giây | Không (chỉ tham số hoá downwash) | **Có** (z là biến tường minh) |
| **T2** | Street canyon | Hộp xoáy + chùm khói trực tiếp trong hẻm phố | Giây | Có, dạng tham số | Một phần (1 giá trị / đoạn phố) |
| **T3** | Gió chẩn đoán (Röckle) + vận chuyển trên lưới voxel / hạt Lagrange | Không giải động lượng; chỉ ép bảo toàn khối lượng | Giây → phút | **Có, phân giải hình học** | **Có, native voxel** |
| **T4** | CFD (RANS / LES / LBM) | Giải Navier–Stokes | Giờ → ngày → HPC | Có, phân giải đầy đủ | Có |
| **T5** | Eulerian CTM (CMAQ/CAMx/WRF-Chem) | Hoá học–vận chuyển quy mô vùng | HPC, hàng tháng chuẩn bị | Không (ô ~1 km) | Có nhưng quá thô |
| **T6** | ML surrogate | Học ánh xạ hình học → trường nồng độ | Suy luận: mili-giây; huấn luyện: rất đắt | Gián tiếp | Có |

---

## 3. TẦNG T0 — Box model (mô hình hộp)

**Ý tưởng.** Coi toàn bộ đô thị là một hộp có chiều cao bằng chiều cao lớp xáo trộn (mixing height), phát thải được trộn đều tức thời trong hộp, gió thổi qua mang chất ô nhiễm đi.

Mô tả định tính (không có phương trình) ✅ ([Johnson 2022, *Environ. Sci. Proc.* 19:18](https://doi.org/10.3390/environsciproc2022019018)): *"toàn bộ phát thải được thả vào hộp. Sau khi thả, phát thải được giả định phân bố đều khắp hộp."*

📐 **Công thức trạng thái dừng (dạng sách giáo khoa, KHÔNG có nguồn chính thức đọc được):**

```
C = (Q_area · L) / (u · H)
```
với Q_area = thông lượng phát thải theo diện tích, L = chiều dài hộp theo hướng gió, u = tốc độ gió thông thoáng, H = chiều cao lớp xáo trộn.

| Tiêu chí | Đánh giá |
|---|---|
| Đầu vào | Kiểm kê phát thải toàn thành phố, mixing height, gió trung bình, nền |
| Chi phí | Một phép tính |
| Ưu | Kiểm tra bảo toàn khối lượng; baseline tuyệt đối; giải thích được trong 1 slide |
| Nhược | **Không có cấu trúc không gian nào cả** — 1 giá trị cho cả thành phố |
| Ra 3D? | **Không** |

**Vai trò trong đồ án:** dùng làm **phép kiểm tra tổng khối lượng** (tổng lượng chất trong lưới voxel phải khớp với cân bằng hộp) và làm baseline thấp nhất trong chương so sánh mô hình. Không dùng làm mô hình chính.

So sánh Box / Gifford-Hanna / Box-GH cho đô thị: ⚠️ [DOI 10.1023/A:1020958603263](https://doi.org/10.1023/A:1020958603263) (paywall, chỉ đọc được abstract).

---

## 4. TẦNG T1 — Họ Gaussian (plume và puff)

### 4.1 Phương trình chùm khói Gaussian trạng thái dừng

Nguồn gốc chuẩn mực và **miễn phí** để trích dẫn công thức là **EPA ISC3 User's Guide Vol. II — Description of Model Algorithms** ✅ ([EPA-454/B-95-003b, PDF](https://gaftp.epa.gov/aqmg/SCRAM/models/other/isc3/isc3v2.pdf)), phương trình 1-1:

```
C(x,y,z) = (Q · K · V · D) / (2π · u_s · σ_y · σ_z) · exp[ −0,5 · (y/σ_y)² ]
```

trong đó **số hạng đứng V** (Eq. 1-50) chứa chuỗi phản xạ ở mặt đất và ở nắp nghịch nhiệt:

```
V = exp[−0,5 (z − h_e)²/σ_z²] + exp[−0,5 (z + h_e)²/σ_z²]
    + Σₙ { các số hạng ảnh H1..H4 }
```

Ký hiệu: Q = cường độ nguồn, u_s = tốc độ gió ở độ cao ống khói, h_e = độ cao hiệu dụng, σ_y/σ_z = hệ số phát tán ngang/đứng, K = hệ số quy đổi đơn vị, D = số hạng phân rã.

> ⚠️ **Lưu ý kỹ thuật khi trích xuất:** bản PDF ISC3 khi trích tự động hay biến `σ` thành `F` và `χ` thành `ρ`. Phải mở PDF và chép lại bằng mắt.

**Dạng đóng của chuỗi phản xạ vô hạn** (hữu ích nếu không muốn cắt cụt tổng khi tính trên lưới voxel): ✅ [Micallef & Micallef 2024, *Sci* 6(3):48, DOI 10.3390/sci6030048](https://doi.org/10.3390/sci6030048), Eq. 52.

### 4.2 Giả định

- Phát thải liên tục, trạng thái dừng;
- Chất ô nhiễm **thụ động, không phản ứng hoá học**;
- Phân bố Gaussian theo phương ngang và phương đứng;
- Trường gió **đồng nhất, không đổi**;
- Phản xạ toàn phần ở mặt đất và nắp xáo trộn;
- **Tốc độ gió ≥ ~1 m/s** ✅ ([Johnson 2022](https://doi.org/10.3390/environsciproc2022019018) nêu rõ điều kiện này).

### 4.3 Hệ số phát tán σ_y, σ_z — bảng đầy đủ từ nguồn EPA

Toàn bộ dưới đây từ ISC3 Vol. II ✅ ([PDF](https://gaftp.epa.gov/aqmg/SCRAM/models/other/isc3/isc3v2.pdf)).

**(a) Pasquill-Gifford nông thôn, σ_y** (Eq. 1-32, x tính bằng **km**):

```
σ_y = 465,11628 · x · tan(TH),   TH = 0,017453293 · [ c − d·ln(x) ]
```

| Cấp ổn định | c | d |
|---|---|---|
| A | 24,1670 | 2,5334 |
| B | 18,3330 | 1,8096 |
| C | 12,5000 | 1,0857 |
| D | 8,3330 | 0,72382 |
| E | 6,2500 | 0,54287 |
| F | 4,1667 | 0,36191 |

**(b) Pasquill-Gifford nông thôn, σ_z** (Eq. 1-34): `σ_z = a · x^b` (x tính bằng km). Bảng đầy đủ có trong ISC3 Table 1-2 — ví dụ cấp D: x < 0,30 km → a=34,459, b=0,86974; 0,31–1,00 → 32,093 / 0,81066; 1,01–3,00 → 32,093 / 0,64403; 3,01–10,00 → 33,504 / 0,60486; 10,01–30,00 → 36,650 / 0,56589; > 30 → 44,053 / 0,51179.

**(c) ⭐ Briggs ĐÔ THỊ (McElroy-Pooler)** — ISC3 Tables 1-3, 1-4, **x tính bằng mét**. *Đây là bảng nhóm phải dùng, không phải bảng nông thôn:*

| Cấp | σ_y (m) | σ_z (m) |
|---|---|---|
| A–B | 0,32·x·(1 + 0,0004·x)^(−1/2) | 0,24·x·(1 + 0,001·x)^(**+1/2**) |
| C | 0,22·x·(1 + 0,0004·x)^(−1/2) | 0,20·x |
| D | 0,16·x·(1 + 0,0004·x)^(−1/2) | 0,14·x·(1 + 0,0003·x)^(−1/2) |
| E–F | 0,11·x·(1 + 0,0004·x)^(−1/2) | 0,08·x·(1 + 0,0015·x)^(−1/2) |

> **Chú ý dấu:** số mũ của σ_z ở cấp A–B đô thị là **+1/2** (không phải −1/2) — nghĩa là σ_z tăng **nhanh hơn tuyến tính**. Đây là trường hợp đối lưu đô thị và là khác biệt quan trọng nhất so với bảng nông thôn ở quy mô đường phố.

**(d) Số mũ profile gió theo luỹ thừa** `u(z) = u_ref · (z/z_ref)^p` — ISC3:

| Cấp | p nông thôn | p đô thị |
|---|---|---|
| A, B | 0,07 | **0,15** |
| C | 0,10 | **0,20** |
| D | 0,15 | **0,25** |
| E | 0,35 | **0,30** |
| F | 0,55 | **0,30** |

📐 Đây là **cách rẻ nhất** để có gió biến thiên theo độ cao trong mô hình voxel.

⚠️ **Không có trong ISC3 Vol. II:** bảng định nghĩa cấp ổn định Pasquill (bức xạ mặt trời × tốc độ gió). Phải lấy từ Turner's Workbook riêng.

### 4.4 Độ cao nâng chùm khói (Briggs) và độ cao hiệu dụng

Từ ISC3 Vol. II ✅:

| Đại lượng | Công thức |
|---|---|
| Thông lượng nổi | `F_b = g · v_s · d_s² · ΔT / (4·T_s)`, ΔT = T_s − T_a |
| Thông lượng động lượng | `F_m = v_s² · d_s² · T_a / (4·T_s)` |
| ΔT giao cắt | `ΔT_c = 0,0297·T_s·v_s^(1/3)·d_s^(2/3)` nếu F_b < 55; `0,00575·T_s·v_s^(2/3)·d_s^(1/3)` nếu F_b ≥ 55 |
| Khoảng cách tới độ cao cuối | `x_f = 49·F_b^(5/8)` (F_b<55); `119·F_b^(2/5)` (F_b≥55) |
| Nâng do nổi, bất ổn/trung tính | `Δh = 21,425·F_b^(3/4)/u_s` (F_b<55); `38,71·F_b^(3/5)/u_s` (F_b≥55) |
| Nâng do động lượng | `Δh = 3·d_s·v_s/u_s` |
| Nâng trong điều kiện ổn định | `Δh = 2,6·[F_b/(u_s·s)]^(1/3)` |
| Downwash đỉnh ống khói | `h_s' = h_s + 2·d_s·(v_s/u_s − 1,5)` khi `v_s < 1,5·u_s` |

Độ cao hiệu dụng: **H = h_s' + Δh**, và chính H đi vào số hạng đứng ở §4.1.

### 4.5 Các phần mềm cụ thể trong họ T1

#### AERMOD (US EPA) — mô hình quy chuẩn

- **Trạng thái pháp lý:** mô hình ưu tiên của EPA cho tầm gần, *"chính thức hoá từ 09/12/2006, thay thế ISC3"* ✅ ([EPA SCRAM](https://www.epa.gov/scram/air-quality-dispersion-modeling-preferred-and-recommended-models)).
- **Dạng tổng quát** (Eq. 51 trong Model Formulation Document ✅ [PDF](https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_mfd.pdf)): `C = (Q/ũ) · P_y · P_z`, với ũ là tốc độ gió hiệu dụng, P_y/P_z là hàm mật độ xác suất ngang/đứng.
- **Khác biệt then chốt so với ISC3:** dùng **thang tỉ lệ lớp biên liên tục** (u\*, w\*, L, z_i) thay vì cấp ổn định rời rạc A–F; trong lớp biên đối lưu dùng **PDF bi-Gaussian** với 3 thành phần (chùm trực tiếp, gián tiếp, xuyên thủng).
- **Đô thị:** AERMOD *"tính đến bản chất phát tán của lớp biên 'giống đối lưu' hình thành ban đêm ở khu đô thị bằng cách tăng cường rối so với mức mong đợi ở lớp biên ổn định nông thôn lân cận"* ✅ (MFD §5.10). Mặc định độ nhám đô thị **1 m** ✅ ([Implementation Guide](https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_implementation_guide.pdf)).
- **Downwash toà nhà:** tích hợp thuật toán **PRIME** (Schulman et al., 2000) ✅.
- **Gió yếu:** có tuỳ chọn **ADJ_U\*** trong AERMET; nhưng Implementation Guide cảnh báo *"nồng độ dự báo cho nguồn diện có thể bị ước lượng vượt trong điều kiện gió rất nhẹ (u < 1,0 m/s)"* ✅.
- **Ra trường 3D?** 📐 Có, nhưng **phải tự dựng**: AERMOD không có chế độ "xuất 3D"; dùng tuỳ chọn **FLAGPOLE** / receptor rời rạc có z, tạo một lưới Cartesian cho mỗi mực z rồi xếp chồng ✅ ([User's Guide](https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_userguide.pdf)).
- **Mã nguồn:** public domain, tải tự do — [aermod_source.zip](https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_source.zip), [aermod_exe.zip](https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_exe.zip) ✅.
- **Wrapper Python:** `pyaermod` — MIT, `pip install pyaermod`, 10 loại nguồn, lưới receptor Cartesian, **xuất GeoTIFF/Shapefile/GeoPackage/GeoJSON**, đọc POSTFILE, Python ≥3.11. **Là wrapper, không phải tái cài đặt** — vẫn cần binary EPA ✅ ([GitHub](https://github.com/atmmod/pyaermod)). ⚠️ Repo chỉ có 1 sao — độ trưởng thành cần cân nhắc.

#### ISC3 / ISCST3 — tiền thân, nhưng là nguồn công thức tốt nhất

Đã bị AERMOD thay thế ✅, nay nằm ở mục [Alternative Models](https://www.epa.gov/scram/air-quality-dispersion-modeling-alternative-models). **Nhưng**: ISC3 Vol. II là văn bản EPA **công khai, miễn phí, in rõ từng công thức** — đây chính là tài liệu để cài đặt lại bằng Python. Có 2 sơ đồ downwash: **Huber-Snyder** và **Schulman-Scire** ✅.

#### CALPUFF — mô hình puff phi dừng

- **Nồng độ của một puff** ✅ ([User's Guide v5](https://calpuff.org/calpuff/download/CALPUFF_UsersGuide.pdf)):
  `C = (Q/(2π·σ_x·σ_y)) · g · exp(−d_a²/2σ_x²) · exp(−d_c²/2σ_y²)`, với `g` là số hạng đứng có chuỗi phản xạ, suy biến về giới hạn trộn đều khi σ_z > 1,6·h.
- Dạng **slug** (puff kéo dài) *"xử lý đúng điều kiện lặng gió và gió yếu"* ✅ — đây là ưu điểm lớn so với plume model.
- 5 tuỳ chọn phát tán, trong đó có **PG nông thôn hoặc McElroy-Pooler đô thị (bản ISCST)** ✅.
- **Trạng thái:** từ 2003 đến 01/2017 là mô hình ưu tiên của EPA cho tầm xa, **đã bị loại khỏi danh sách ưu tiên** trong bản sửa 2017 của Guideline on Air Quality Models; nay là mô hình thay thế cần biện minh từng trường hợp; bản EPA chấp nhận là 5.8.5 ✅.
- **Không phù hợp quy mô đường phố** — thiết kế cho 10–100 km.
- Tải miễn phí sau khi đăng ký + chấp nhận EULA ✅ ([calpuff.org](https://calpuff.org/)).

#### R-LINE / kiểu nguồn RLINE trong AERMOD — dành cho nguồn đường

- Công thức Gaussian trạng thái dừng; nguồn đường được biểu diễn bằng **tích phân Romberg một dãy nguồn điểm** ✅ ([R-LINE v1.2 User's Guide](https://www.cmascenter.org/r-line/documentation/1.2/RLINE_UserGuide_11-13-2013.pdf)).
- Có **σ_z0 ban đầu** = chiều cao xe trung bình × 1,7/2,15; tuỳ chọn beta cho σ_y0 theo bề rộng đường (số làn × 3,5 m) ✅.
- ⭐ Có thành phần **meander** riêng cho gió yếu — *"giả định vật chất lan toả theo mọi hướng"*; xuất được riêng phần plume ('P'), meander ('M') hoặc tổng ('T') ✅. Đây là cách xử lý gió yếu sạch nhất trong các code Gaussian miễn phí.
- **Hạn chế nêu nguyên văn** ✅: *"R-LINE ở dạng hiện tại là mô hình địa hình phẳng và do đó không tính biến thiên cao độ địa hình"*; *"R-LINE không thiết kế cho nguồn thể tích, nguồn diện hay nguồn điểm"*.
- Nay đã được tích hợp thành kiểu nguồn `RLINE`/`RLINEXT` **bên trong AERMOD** ✅ ([CMAS](https://www.cmascenter.org/r-line/)).

### 4.6 Tổng kết tầng T1

| Tiêu chí | Đánh giá |
|---|---|
| **Ưu** | Giải tích, khả vi, song song hoá tầm thường; **z là biến tự do tường minh → hợp tự nhiên với lưới voxel**; chồng chập được (nguồn đường/diện = tích phân nguồn điểm); chuẩn mực, dễ bảo vệ, dễ dạy |
| **Nhược trong đô thị** | Không có toà nhà; không có xoáy hẻm phố; không có bẫy chất ô nhiễm ở mặt phố; không xử lý lặng gió (giả định u ≥ 1 m/s); cấp ổn định rời rạc thay vì thang tỉ lệ liên tục; hệ số Briggs đô thị chỉ là **hiệu ứng nhám đô thị trung bình theo vùng**, không phân giải từng toà nhà |
| **Chi phí** | Đại số dạng đóng cho mỗi (nguồn × receptor × giờ), vector hoá được hoàn toàn |
| **Ra 3D** | ✅ **Có, tự nhiên** |

**Tham chiếu tốc độ:** một bài peer-reviewed báo cáo mô phỏng puff trên **1.000.000 điểm lưới** chạy *"hơn 3 phút một chút"* sau tối ưu, so với 11,5 giờ nếu cài đặt ngây thơ, trên máy để bàn ✅ ([FastGaussianPuff, *Sci. Rep.* 15:18710](https://doi.org/10.1038/s41598-025-99491-x), [repo](https://github.com/Hammerling-Research-Group/FastGaussianPuff)). Plume model còn rẻ hơn nữa.

---

## 5. TẦNG T2 — Mô hình hẻm phố (street canyon)

### 5.1 Chế độ dòng chảy theo tỉ lệ H/W (Oke 1988)

Ba chế độ — **isolated roughness flow**, **wake interference flow**, **skimming flow** — có nguồn gốc từ ⚠️ [Oke, T.R. (1988), *Energy and Buildings* 11(1–3), 103–113, DOI 10.1016/0378-7788(88)90026-6](https://doi.org/10.1016/0378-7788(88)90026-6) (ScienceDirect 403, chưa đọc được).

🔴 **Các ngưỡng H/W thường được trích (H/W < ~0,3 isolated; 0,3–0,7 wake interference; > 0,7 skimming) chỉ xuất hiện trong search snippet.** Các nguồn thứ cấp khác nhau ghi ngưỡng trên là 0,65 hoặc 0,7. **Không đưa con số cụ thể kèm trích dẫn Oke nếu chưa mở bài gốc.**

Hỗ trợ gián tiếp: phân loại Davenport lớp 8 được đặt tên đúng là *"Skimming: City centre"* ✅ ([Ng et al. 2011, PMC7127139](https://pmc.ncbi.nlm.nih.gov/articles/PMC7127139/)).

### 5.2 OSPM (Operational Street Pollution Model, Aarhus/NERI)

Mô hình hẻm phố tham chiếu quốc tế ✅ ([mô tả chính thức, Aarhus DCE](https://envs.au.dk/en/research-areas/air-pollution-emissions-and-effects/the-monitoring-program/air-pollution-models/ospm/description-of-the-ospm-model)).

**Cấu trúc:** *"kết hợp một mô hình chùm khói cho đóng góp trực tiếp và một mô hình hộp cho phần chất ô nhiễm tái tuần hoàn trong đường phố."*

| Thành phần | Nội dung được nêu chính thức |
|---|---|
| Đóng góp trực tiếp | Phát thải giao thông = **nguồn đường vi phân vuông góc hướng gió** ở mực đường; phát thải đồng đều ngang hẻm; **bỏ qua khuếch tán ngang gió**; hướng gió mực phố **phản chiếu gương** so với hướng gió mực mái; phát tán ban đầu h₀ = 2–4 m tuỳ tốc độ gió; chùm khói nở tuyến tính theo khoảng cách |
| Xoáy tái tuần hoàn | Chiều dài xoáy = **2 × chiều cao toà nhà đón gió**; *"với tốc độ gió mực mái dưới 2 m/s, chiều dài xoáy giảm tuyến tính theo tốc độ gió"*; hình thang, cạnh trên dài tối đa bằng **một nửa** chiều dài xoáy; nồng độ trong hộp từ cân bằng vào = ra, nội bộ trộn đều |
| ⭐ **Rối do giao thông (TPT)** | *"Trong điều kiện lặng gió, cơ chế phát tán duy nhất là do TPT. Do đó TPT trở thành yếu tố quyết định mức ô nhiễm cao nhất."* |
| Meander | Nồng độ được lấy trung bình trên một quạt hướng gió, bề rộng quạt tăng khi gió giảm; *"ở điều kiện lặng gió, quạt trung bình tiến tới 360°"* |
| Hoá học | NO + O₃ ⇌ NO₂ + O₂; quan hệ NO₂/NOₓ phi tuyến vì thời gian lưu trong hẻm (hàng chục giây) so sánh được với thời gian phản ứng |

**Đầu vào:** *"giá trị theo giờ của tốc độ gió, hướng gió, nhiệt độ và bức xạ tổng"*, nồng độ **nền đô thị** theo giờ, hình học phố và dữ liệu giao thông ✅.

**Nhược điểm cốt tử với đề tài voxel:** OSPM cho ra nồng độ **ở mực đường, trung bình theo hẻm (mặt khuất gió / mặt đón gió)** — **không phải trường 3D**. Không có profile theo z phía trên mái; hộp tái tuần hoàn được giả định trộn đều.

⚠️ **Bộ phương trình đầy đủ của OSPM chưa lấy được:** Aarhus chỉ công bố mô tả khái niệm; [Berkowicz 2000, DOI 10.1023/A:1006448321977](https://doi.org/10.1023/A:1006448321977) bị paywall; review của [Kakosimos et al. 2010, DOI 10.1071/EN10070](https://doi.org/10.1071/EN10070) cũng paywall.

> ⭐ **Cách thay thế hợp lệ:** CERC công bố **công khai** đặc tả kỹ thuật module hẻm phố của ADMS-Urban, và nói rõ nó *"dựa trên mô hình OSPM của Đan Mạch"* — nghĩa là bạn có một bản mô tả **ở mức phương trình** hoàn toàn miễn phí ✅ ([CERC P28/01C/17, PDF](http://www.cerc.co.uk/environmental-software/assets/data/doc_techspec/P28_01.pdf)).

### 5.3 ADMS-Urban (CERC) — và bộ đặc tả kỹ thuật công khai

CERC đăng công khai toàn bộ [danh mục đặc tả kỹ thuật](http://www.cerc.co.uk/environmental-software/technical-specifications.html) ✅ — đây là tài liệu trích dẫn được.

**Nồng độ trung bình, điều kiện ổn định/trung tính** (P10/01 & P12/01, Eq. 3.1) ✅ ([PDF](http://www.cerc.co.uk/environmental-software/assets/data/doc_techspec/P10_01.P12_01.pdf)):

```
C = Qs/(2π σ_y σ_z U(z_m)) · exp(−y²/2σ_y²) ·
    { exp(−(z−z_s)²/2σ_z²) + exp(−(z+z_s)²/2σ_z²)
    + exp(−(z−2h+z_s)²/2σ_z²) + exp(−(z+2h−z_s)²/2σ_z²) + exp(−(z−2h−z_s)²/2σ_z²) }
```

⭐ **Trong điều kiện đối lưu, ADMS KHÔNG dùng Gaussian theo phương đứng** — Eq. 3.3 dùng **bi-Gaussian lệch** dựng trên PDF của w (Eq. 2.10), mode ŵ ≈ −σ_wc/2, độ lệch ≈ 0,48·σ_w³ ✅. Lớp biên tham số hoá bằng **h, L_MO, u\*, w\*** chứ không phải cấp Pasquill; đối lưu khi h/L_MO < −0,3 ✅.

**Module hẻm phố** (P28/01C/17) ✅ ([PDF](http://www.cerc.co.uk/environmental-software/assets/data/doc_techspec/P28_01.pdf)) — các công thức cụ thể:

| Đại lượng | Công thức |
|---|---|
| Chiều dài tái tuần hoàn | `L_R = 2·H_B·r`, với `r = 1` khi u_t ≥ 2 m/s; `r = (u_t − 1)` khi 1 < u_t < 2; **`r = 0` khi u_t ≤ 1 m/s** (không có xoáy khi lặng gió) |
| Nồng độ trong hốc | `C_R = (Q₁/L) / (v_d2 + v_d3 + d_w)` |
| Vận tốc thông gió | `v_d = [0,01·u_t² + 0,4·w₀]^(1/2)` |
| Rối mực phố | `w = [u_b² + w₀²]^(1/2)`, w₀ = thành phần do xe cộ sinh ra |
| Pha trộn với nguồn đường Gaussian thường | `C = (1 − S_ratio)·C_non-canyon + S_ratio·C_canyon`, `S_ratio = min(H_B²/L², 1)·sin θ` |

Có thêm bản **advanced street canyon** (P28/02C/25) ✅. ADMS-Urban còn có **mô hình quang hoá NOₓ–O₃** ✅ ([trang sản phẩm](https://www.cerc.co.uk/environmental-software/ADMS-Urban-model.html)).

**Giấy phép:** thương mại, không có mã nguồn.

### 5.4 SIRANE (École Centrale de Lyon / LMFA) — mạng lưới đường phố

✅ ([Soulhac et al. 2011, *Atmos. Environ.* 45:7379–7395, DOI 10.1016/j.atmosenv.2011.07.008](https://doi.org/10.1016/j.atmosenv.2011.07.008) · [bản tác giả PDF](http://air.ec-lyon.fr/Doc/Publi/Soulhac-Atm-Env-2011-a.pdf) · [trang chính thức](http://air.ec-lyon.fr/SIRANE/))

**Ý tưởng cốt lõi — rất đáng học cho đồ án:** tách dòng chảy thành **khí quyển bên ngoài** và **canopy đô thị**, trong đó canopy được biểu diễn là **một mạng lưới các đoạn phố và nút giao**.

- Cân bằng khối lượng cho mỗi đoạn phố: `Q_S + Q_I + Q_part,H = Q_H,turb + H·W·U_street·C_street + Q_part,gr + Q_wash` ✅
- Vận tốc trao đổi qua mặt phẳng mái: `u_d = σ_w·√(2/π)` ✅
- Nút giao = hộp trộn đều, phân phối lại thông lượng giữa các phố nối vào ✅
- Phía trên canopy: chùm khói Gaussian với σ_y, σ_z theo cấp ổn định + nâng chùm kiểu Briggs + nguồn ảnh ✅
- **Hình học phố (W, H, L) được trích tự động từ footprint toà nhà trong GIS** ✅ — đây là mô hình "GIS-native" nhất trong tầng T2.

**Kết quả kiểm định đã công bố (Lyon, 15 trạm, NO₂, năm 2008)** ✅ ([Part III, DOI 10.1016/j.atmosenv.2017.08.034](https://doi.org/10.1016/j.atmosenv.2017.08.034) · [PDF tác giả](http://air.ec-lyon.fr/Doc/Publi/Soulhac-Atm-Env2017.pdf)):

> **FAC2 = 0,73–0,90 · FB = −0,38 đến +0,20 · NMSE = 0,06–0,38 · r = 0,59–0,96**
> *"SIRANE thoả mãn tất cả tiêu chí do Chang & Hanna (2004) đề xuất… cho mọi trạm quan trắc, trừ một trạm."*

**Hạn chế do chính tác giả nêu** ✅: không có trường khí tượng 3D cho địa hình phức tạp; tham số hoá chưa đủ cho phố chỉ có nhà một bên; phát tán trường gần kém trong điều kiện rất bất ổn định.

**Ra 3D?** Một phần: **một giá trị trộn đều cho mỗi đoạn phố** trong canopy (không có profile đứng trong hẻm), cộng với trường Gaussian phụ thuộc z phía trên mái. 📐 Ánh xạ sang voxel: *điền giá trị đoạn phố vào các voxel trong hẻm, dùng trường Gaussian phía trên độ cao mái* — đúng kiến trúc hai lớp mà SIRANE được xây dựng.

**Giấy phép:** phần mềm nghiên cứu có bản quyền của ECL/LMFA, ⚠️ **không có bản open-source**.

### 5.5 MUNICH — bản mở của ý tưởng mạng lưới phố

Model mạng lưới hẻm phố, ghép được với SSH-aerosol và Polair3D, **GPL-3** ✅ ([GMD 15, 7371, 2022](https://gmd.copernicus.org/articles/15/7371/2022/) · [github.com/cerea-lab/munich](https://github.com/cerea-lab/munich)). Đây là lựa chọn mã nguồn mở gần nhất với SIRANE.

### 5.6 Tổng kết tầng T2

| | |
|---|---|
| **Ưu** | Là họ mô hình **duy nhất trong nhóm rẻ** xử lý đúng bẫy chất ô nhiễm trong hẻm và **rối do giao thông khi lặng gió** — đúng chế độ thời tiết gây ô nhiễm cao nhất ở Hà Nội; chi phí gần như bằng 0; đã kiểm định rộng rãi (SIRANE FAC2 0,73–0,90) |
| **Nhược** | **Không phải mô hình trường 3D** — cho 1 giá trị/đoạn phố; không có profile đứng trong hẻm; cần nồng độ **nền đô thị** làm đầu vào (phải lấy từ trạm hoặc mô hình khác) |
| **Vai trò khả dĩ trong đồ án** | Lớp "sub-grid" nằm dưới độ cao mái, ghép với một mô hình trường 3D ở trên — đúng kiến trúc của SIRANE và của EPISODE (§8.4) |

---

## 6. TẦNG T3 — Gió chẩn đoán + vận chuyển trên lưới voxel ⭐

**Đây là tầng quan trọng nhất của đề tài.** Nó là tầng duy nhất vừa (a) phân giải được toà nhà, vừa (b) chạy được trên laptop, vừa (c) **native voxel** — tức là mọi biến đều sống trên đúng lưới 3D array mà đề tài yêu cầu.

Tầng này gồm **hai bước độc lập**, và có thể chọn riêng từng bước:

- **Bước A** — sinh trường gió 3D (u,v,w) trên lưới voxel → §6.1–§6.3
- **Bước B** — vận chuyển chất ô nhiễm trên chính lưới đó → §6.4 (Euler) hoặc §6.5 (Lagrange)

### 6.1 Profile gió nền — điều kiện biên vào

**Profile logarit** (trường hợp trung tính, dạng rút gọn) ✅ ([Horne, Pan & Davis 2026, *Boundary-Layer Meteorol.* 192(5):25, PMC13053558](https://pmc.ncbi.nlm.nih.gov/articles/PMC13053558/)):

```
u(z) = (u*/κ) · ln( (z − d) / z₀ )
```
với u\* = vận tốc ma sát, κ = hằng số von Kármán, z₀ = chiều dài nhám, d = chiều cao dịch chuyển (displacement height). Dạng đầy đủ có thêm các số hạng hiệu chỉnh ổn định Ψ (triệt tiêu khi trung tính).

**Profile luỹ thừa** — URock dùng, Eq. 2 ✅ ([GMD 16, 5703–5727](https://gmd.copernicus.org/articles/16/5703/2023/)):

```
V(z) = V_ref · (z/z_ref)^p,   với   p = 0,12·z₀ + 0,18
```
tức là **số mũ được suy ra từ chiều dài nhám**, không tra bảng. URock Eq. 3 còn cho profile mũ trong canopy `V(z) = V_ref·exp(a·(z/H_r − 1))` khi z < H_r, và logarit phía trên.

**Bảng số mũ theo loại địa hình** (nguồn: EnergyPlus I/O Reference, gốc ASHRAE) ✅ ([bigladdersoftware](https://bigladdersoftware.com/epx/docs/24-1/input-output-reference/group-location-climate-weather-file-access.html)):

| Địa hình | α | Độ dày lớp biên δ (m) |
|---|---|---|
| Biển | 0,10 | 210 |
| Đồng bằng trống | 0,14 | 270 |
| Rừng / đô thị, công nghiệp | 0,22 | 370 |
| **Thị trấn và thành phố** | **0,33** | 460 |

⚠️ Đây là bảng tiêu chuẩn mô phỏng năng lượng toà nhà, không phải khí tượng vi mô — dùng được nhưng **phải nói rõ nguồn gốc**.

**Chiều dài nhám z₀ theo lớp phủ.** Phân loại Davenport được **WMO công bố chính thức** với các lớp: *smooth, open, roughly open, rough, very rough, closed, chaotic* ("Trung tâm thành phố lớn với hỗn hợp nhà thấp tầng và cao tầng"), *sea* ✅ ([WMO Codes Registry](https://codes.wmo.int/wmdr/SurfaceRoughnessDavenport)). Nguồn gốc bản sửa đổi: ✅ ([Davenport, Grimmond, Oke, Wieringa 2000, AMS](https://ams.confex.com/ams/AugDavis/techprogram/paper_15611.htm)).

> 🔴 **Bảng số z₀ bằng mét thường được lưu truyền** (0,0002 biển → 0,03 cỏ trống → 0,1 cây thấp → 0,5 công viên → **1,0 ngoại ô** → **≥2,0 trung tâm thành phố**) **chỉ xuất hiện trong search snippet, chưa xác thực.** Nguồn gốc phải đọc: ⚠️ [Wieringa (1992), *J. Wind Eng. Ind. Aerodyn.* 41, 357–368, DOI 10.1016/0167-6105(92)90434-C](https://doi.org/10.1016/0167-6105(92)90434-C).
>
> 🔴 Quy tắc ngón tay cái **z₀ ≈ 0,1·z_H, d ≈ 0,7·z_H** **không tìm thấy trong nguồn gốc đọc được**; thường được gán cho ⚠️ [Grimmond & Oke (1999), *J. Appl. Meteorol.* 38, 1262–1292](https://doi.org/10.1175/1520-0450(1999)038%3C1262:APOUAD%3E2.0.CO;2) (AMS chặn 403).

⭐ **Cách hay hơn cho một đồ án GIS: tính z₀ và d bằng phương pháp hình thái (morphometric) từ chính footprint toà nhà của mình.** Đầu vào: chiều cao trung bình H_av, **chỉ số diện tích mặt bằng λ_P** (diện tích mặt bằng nhà / tổng diện tích), **chỉ số diện tích chính diện λ_F** (diện tích chính diện / tổng diện tích). Các phương pháp được đánh giá: **Macdonald et al. (1998)**, **Kanda et al. (2013)**, **Kent et al. (2017b)** ✅ ([Horne et al. 2026](https://pmc.ncbi.nlm.nih.gov/articles/PMC13053558/)).

> ⚠️ **Cảnh báo từ chính nghiên cứu đó:** tại điểm trung tâm đô thị (Indianapolis), d tính theo hình thái chỉ bằng **10–42%** của d đo bằng khí tượng, và z₀ chỉ bằng **31–43%**. Nghĩa là: phương pháp hình thái *có thể sai đáng kể*, nhưng nó **có thể tính được từ dữ liệu GIS bạn đã có** — và việc nêu rõ sai số này chính là một điểm cộng học thuật.

### 6.2 ⭐ Tham số hoá Röckle (1990) — công thức đã xác thực bằng MÃ NGUỒN

Röckle-type model **không giải phương trình động lượng**: *"các mô hình kiểu Röckle không giải phương trình vận chuyển cho động lượng hay năng lượng; thay vào đó chúng dựa nhiều vào tham số hoá thực nghiệm và bảo toàn khối lượng"* ⚠️ ([Singh et al. 2008, DOI 10.1007/s10652-008-9084-5](https://doi.org/10.1007/s10652-008-9084-5), Springer chặn).

Quy trình **2 giai đoạn**, cả hai đều native voxel:

**Giai đoạn 1 — khởi tạo thực nghiệm.** Với mỗi toà nhà, "đóng dấu" các **vùng hình học** vào mảng 3D và gán vận tốc trong mỗi vùng theo công thức thực nghiệm khớp từ dữ liệu hầm gió. URock mô tả: *"khởi tạo trường gió quanh vật cản bằng các quy tắc thực nghiệm từ dữ liệu hầm gió"* ✅ ([GMD 16, 5703](https://gmd.copernicus.org/articles/16/5703/2023/)).

URock định nghĩa **7 vùng toà nhà + 2 vùng thực vật** ✅:
1. **Displacement** (trước mặt đón gió) · 2. **Displacement vortex** · 3. **Cavity** (bong bóng tái tuần hoàn ngay sau nhà) · 4. **Wake** (vùng hụt động lượng xa hơn) · 5. **Rooftop perpendicular** · 6. **Rooftop corner** · 7. **Street canyon** · 8–9. Thực vật trong khu xây dựng / khu trống.

> ### ⚠️ CẢNH BÁO RENDER — đọc kỹ chỗ này
> Bản HTML đã xuất bản của URock khi trích xuất tự động **làm hỏng công thức chiều dài hốc (Eq. A4)**, cho ra kết quả sai trên hai lần thử độc lập. Công thức đúng được lấy **trực tiếp từ mã nguồn** `CalculatesIndicators.py`, hàm `zoneProperties` ✅ ([raw source trên GitHub](https://raw.githubusercontent.com/UMEP-dev/UMEP-processing/main/functions/URock/CalculatesIndicators.py)).

**Công thức vùng — đã xác thực bằng mã nguồn** (H = chiều cao nhà, W = bề rộng hiệu dụng, L = chiều dài hiệu dụng):

| Vùng | Công thức | Nguồn |
|---|---|---|
| **Displacement (xoáy trước)** | `L_f = 1,5·W / (1 + 0,8·W/H)` | code + Eq. A1 ✅ |
| **Displacement vortex** | `L_fv = 0,6·W / (1 + 0,8·W/H)` | code + Eq. A2 ✅ |
| **Cavity / tái tuần hoàn** | **`L_r = 1,8·W / [ (L/H)^0,3 · (1 + 0,24·W/H) ]`** | **code** (Eq. A4 in ra bị lỗi render) ✅ |
| **Far wake** | **`L_w = 3·L_r`** | code ✅ |
| **Chiều cao tái tuần hoàn mái** | `H_cm = 0,22·(0,67·min(H,W) + 0,33·max(H,W))` | code + Eq. A5 ✅ |
| **Chiều dài tái tuần hoàn mái** | `L_cp = 0,9·(0,67·min(H,W) + 0,33·max(H,W))` | code + Eq. A6 ✅ |
| **Góc mái** | `L_cc = 2·L_fc·tan(2,94·exp(0,0297·\|θ\|) − π/2)` | Eq. A7 (chỉ có trong HTML) ⚠️ |

Dạng cavity là quan hệ **Kaplan & Dinar (1996)**; các dạng displacement được chú thích trong code là của **Bagal et al. (2004)** và **Kaplan et al. (1996)** ✅.

**Bề rộng và chiều dài hiệu dụng** — cách quy footprint bất kỳ về W và L (Eqs. 4–5) ✅:
```
W_eff = W_BBox · (A_B / A_BBox)
L_eff = L_BBox · (A_B / A_BBox)
```
(kích thước bounding box nhân với tỉ lệ lấp đầy của footprint).

**Trường vận tốc bên trong các vùng** (chép từ HTML — ⚠️ **độ tin cậy thấp về chi tiết đại số**, phải đối chiếu `InitWindField.py` trước khi cài đặt) ✅/⚠️:
- Cavity: `V₀(D_y,z)/V_p(H) = −(1 − D_y/D_oc)·(1 − z²/H²)²`, đỉnh vùng `H_c = H·(1 − D_y²/D_oc²)`
- Wake: `V₀(D_y,z)/V_p(z) = −(1 − D_oc/D_y)^1,5·(1 − z²/H²)^1,5`, `H_w = H·(1 − D_y²/D_ow²)`
- Displacement (Eq. B1): `V₀(z)/V_p(H_F) = C_dz·(z/H_F)^p` với `C_dz = 0,4`, `p = 0,16`

**Hẻm phố trong URock** ✅: *"vùng hẻm phố được tạo ra giữa hai khối nhà xếp chồng khi vùng hốc của toà nhà thượng lưu cắt vào mặt đón gió của toà nhà hạ lưu"*, và hệ số gió trong vùng đó tuân theo phương trình vùng cavity.

### 6.3 ⭐ Bước bảo toàn khối lượng — phương trình thực sự được giải

Trường sau giai đoạn 1 **có divergence khác 0** (phi vật lý). Giai đoạn 2 hiệu chỉnh nó về không phân kỳ bằng phương pháp biến phân **Sasaki (1970)**.

**Phiếm hàm biến phân** (URock Eq. 7) ✅ ([GMD 16, 5703](https://gmd.copernicus.org/articles/16/5703/2023/)):

```
E(u,v,w,λ) = ∫_V [ (α₁/2)(u−u₀)² + (α₁/2)(v−v₀)² + (α₂/2)(w−w₀)²
                   + λ·(∂u/∂x + ∂v/∂y + ∂w/∂z) ] dV
```

trong đó `(u₀,v₀,w₀)` là **trường đoán ban đầu** từ Röckle (§6.2), **λ là nhân tử Lagrange ép divergence = 0**, và α₁, α₂ là các **Gaussian precision moduli** (mặc định = 1) quyết định hiệu chỉnh nghiêng về phương ngang hay phương đứng.

**Phương trình Euler–Lagrange** khôi phục trường cuối (Eq. 9) ✅:
```
u = u₀ + (1/(2α₁²))·∂λ/∂x
v = v₀ + (1/(2α₁²))·∂λ/∂y
w = w₀ + (1/(2α₂²))·∂λ/∂z
```

Thế vào ràng buộc liên tục → **phương trình Poisson cho λ**, được QES-Winds in ra tường minh ✅ ([tài liệu QES-Winds](https://qes-documentation.readthedocs.io/en/latest/QES-Winds.html)):

```
∂²λ/∂x² + ∂²λ/∂y² + (α₁/α₂)²·∂²λ/∂z² = R        (R = divergence của trường ban đầu)
```

**Công thức cập nhật SOR trên lưới voxel — nguyên văn từ tài liệu QES-Winds** ✅:

```
λ_{i,j,k} = ω · [ (Δx)²·R_{i,j,k} + e·λ_{i+1} + f·λ_{i−1} + A(g·λ_{j+1} + h·λ_{j−1})
                  + B(m·λ_{k+1} + n·λ_{k−1}) ] / (e+f+g+h+m+n)
            + (1−ω)·λ_{i,j,k}
```
với hệ số nới lỏng **ω = 1,78**. Các hệ số `e,f,g,h,m,n` là **cờ rắn/lỏng của 6 mặt voxel** — *đây chính là cách toà nhà đi vào bộ giải* (đặt = 0 ở mặt tường).

**Lưới:** QES-Winds dùng **lưới Cartesian so le (staggered)** — u, v, w ở tâm mặt, λ và các đại lượng vô hướng ở tâm ô ✅. **Đây đúng nghĩa là một lưới voxel.**

**Tiêu chí hội tụ** (URock Eq. 8) ✅: lặp đến khi `Σ|λ^(t+1) − λ^(t)| < ε`, mặc định **ε = 10⁻⁴**.

**Tại sao rẻ hơn CFD hàng bậc độ lớn** — hai khẳng định có nguồn:
- QES-Winds *"giải phương trình bảo toàn khối lượng cho trường gió thay vì các bộ giải chậm hơn và thiên về vật lý hơn có bao gồm bảo toàn động lượng"* — không có phương trình động lượng, không đóng kín rối, không bước thời gian, chỉ một lần giải elliptic ✅ ([GMD 16, 5729](https://gmd.copernicus.org/articles/16/5729/2023/)).
- Họ mô hình chẩn đoán này **"nhanh hơn hai đến ba bậc độ lớn"** so với LES và DNS, cho kết quả độ phân giải 1–10 m *"trong vài phút"* trên máy tính cá nhân ✅ ([Front. Earth Sci. 2023, DOI 10.3389/feart.2023.1251056](https://www.frontiersin.org/journals/earth-science/articles/10.3389/feart.2023.1251056/full)). Cùng bài báo cáo một ca cụ thể: miền **1880 × 1880 × 150 m³ ở độ phân giải 5 m (~21 triệu ô)** chạy **11–12 giây/bước thời gian trên máy cá nhân**.

### 6.4 Bước B (lựa chọn 1) — Phương trình tải–khuếch tán 3D trên lưới voxel

#### Phương trình

Đây đúng là phương trình mà `scalarTransportFoam` của OpenFOAM giải ✅ ([mã nguồn OpenFOAM-10](https://github.com/OpenFOAM/OpenFOAM-10/blob/master/applications/solvers/basic/scalarTransportFoam/scalarTransportFoam.C)):

```cpp
fvScalarMatrix TEqn ( fvm::ddt(T) + fvm::div(phi, T) - fvm::laplacian(DT, T) == fvModels.source(T) );
```

tức là:

```
∂C/∂t + ∇·(u C) − ∇·(K ∇C) = S
```

Khai triển theo thành phần trên lưới voxel với K = diag(K_x, K_y, K_z):

```
∂C/∂t + u·∂C/∂x + v·∂C/∂y + w·∂C/∂z
      = ∂/∂x(K_x ∂C/∂x) + ∂/∂y(K_y ∂C/∂y) + ∂/∂z(K_z ∂C/∂z) + S − λC
```
với S = nguồn phát thải (kg·m⁻³·s⁻¹, ví dụ nguồn đường giao thông đã raster hoá vào voxel), λ = số hạng phân rã/lắng đọng bậc một.

#### Công thức cập nhật voxel (hiện, upwind bậc 1, khuếch tán trung tâm)

📐 Với u, v, w > 0:

```
C[i,j,k]^(n+1) = C[i,j,k]^n
   − (u·Δt/Δx)·(C[i,j,k] − C[i−1,j,k])
   − (v·Δt/Δy)·(C[i,j,k] − C[i,j−1,k])
   − (w·Δt/Δz)·(C[i,j,k] − C[i,j,k−1])
   + (K_x·Δt/Δx²)·(C[i+1,j,k] − 2C[i,j,k] + C[i−1,j,k])
   + (K_y·Δt/Δy²)·(C[i,j+1,k] − 2C[i,j,k] + C[i,j−1,k])
   + (K_z·Δt/Δz²)·(C[i,j,k+1] − 2C[i,j,k] + C[i,j,k−1])
   + Δt·S[i,j,k]
```

Dạng tổng quát cho vận tốc âm: `u·∂C/∂x|_i ≈ [u⁺(C_i − C_{i−1}) + u⁻(C_{i+1} − C_i)]/Δx`, với `u^± = (u ± |u|)/2`.

**Dạng thể tích hữu hạn (nên dùng)** — tích phân trên thể tích voxel V = Δx·Δy·Δz, áp dụng định lý divergence, được cân bằng thông lượng qua 6 mặt:
```
(C^(n+1) − C^n)/Δt · V = − Σ_{f=1..6} (F_adv,f + F_diff,f) · A_f
```
📐 Đây là dạng **bảo toàn** — khối lượng được bảo toàn đến độ chính xác máy, lý do lớn nhất để chọn FV thay vì FD khi cần cân bằng khối lượng chất ô nhiễm. **Lưới voxel vốn đã là một lưới thể tích hữu hạn**: A_f và V là hằng số, nên toàn bộ sơ đồ thu về đúng stencil trên.

#### Upwind vs central — mô tả từ chính tài liệu OpenFOAM ✅ ([fvSchemes](https://doc.cfd.direct/openfoam/user-guide-v12/fvschemes))

| Sơ đồ | Mô tả của OpenFOAM |
|---|---|
| `upwind` | *"bậc một, bounded, nhìn chung quá kém chính xác cho vận tốc"* |
| `linear` | *"bậc hai, unbounded"* |
| `linearUpwind` | *"bậc hai, thiên upwind, unbounded (nhưng ít hơn nhiều so với linear)"* |
| `limitedLinear` | *"sơ đồ linear tự giới hạn về upwind ở vùng gradient biến đổi nhanh"* |

📐 **Khuếch tán số (numerical diffusion) — điểm phải nêu trong seminar.** Khai triển Taylor của stencil upwind sinh số hạng sai số dẫn đầu tương đương một độ khuếch tán phụ `K_num = ½·u·Δx·(1 − Cr)`. ⚠️ **Biểu thức này không lấy được từ nguồn chính thức trong quá trình research — coi là kiến thức sách giáo khoa cần tự kiểm chứng.** Hệ quả thực tiễn: với u = 3 m/s và Δx = 5 m, K_num cỡ vài m²/s — **so sánh được hoặc lớn hơn độ khuếch tán rối ngang vật lý** mà ta đang cố mô hình hoá. Upwind bậc 1 trên lưới voxel thô làm nhoè chùm khói **nhiều hơn cả khí quyển thật**.

#### Điều kiện ổn định CFL

Nguồn gốc: ⚠️ [Courant, Friedrichs & Lewy (1928), *Math. Ann.* 100, 32–74, DOI 10.1007/BF01448839](https://doi.org/10.1007/BF01448839) (Springer chuyển hướng xác thực; bản ghi thư mục xác nhận qua [NASA ADS](https://ui.adsabs.harvard.edu/abs/1928MatAn.100...32C/abstract) ✅).

```
Ràng buộc tải (Courant):    Cr = Δt·( |u|/Δx + |v|/Δy + |w|/Δz ) ≤ 1
Ràng buộc khuếch tán:       Δt ≤ ½ · ( K_x/Δx² + K_y/Δy² + K_z/Δz² )^(−1)
```
Lấy Δt = min của hai giá trị, nhân hệ số an toàn ~0,5.

📐 **Số liệu tính thử cho đồ án:** miền 1 km × 1 km × 200 m với Δx = Δy = 5 m, Δz = 2 m → 200 × 200 × 100 = **4 × 10⁶ voxel**. Với u = 5 m/s: giới hạn tải cho Δt ≤ 1 s; giới hạn khuếch tán đứng với K_z = 1 m²/s, Δz = 2 m cho Δt ≤ 2 s. Vậy **Δt ≈ 0,5 s**, và một giờ mô phỏng = 7200 bước × 4 M voxel ≈ **2,9 × 10¹⁰ phép cập nhật voxel**. Với NumPy vector hoá bằng array slicing: **vài phút đến một giờ trên laptop**. Với vòng lặp `for` thuần Python: **nhiều ngày**. → **Bắt buộc dùng NumPy slicing hoặc Numba, tuyệt đối không lặp Python lồng nhau.**

**Sơ đồ ẩn** (Euler lùi, Crank–Nicolson) ổn định vô điều kiện về mặt tải, bỏ được trần Δt, đổi lại phải giải hệ tuyến tính thưa lớn mỗi bước (stencil 7 điểm → `scipy.sparse.linalg`). Với lưới 4 M voxel đó là gánh nặng bộ nhớ thật. 📐 **Khuyến nghị cho nhóm 2 người: giữ sơ đồ hiện, Cr ≤ 0,5.**

#### Tách toán tử (operator splitting)

Tách toán tử nhiều chiều thành chuỗi bước 1-D (ADI / directional splitting), và tách tải – khuếch tán – hoá học. Tài liệu kinh điển: ⚠️ [Strang (1968), *SIAM J. Numer. Anal.* 5(3), 506–517, DOI 10.1137/0705041](https://doi.org/10.1137/0705041). Tách **đối xứng (Strang)** — nửa bước X, nửa bước Y, đủ bước Z, nửa Y, nửa X — khôi phục độ chính xác bậc hai, trong khi tách tuần tự ngây thơ chỉ bậc một.

Đây chính là cách các mô hình Eulerian lớn làm: CMAQ mô tả *"cách tiếp cận tách thời gian hay tách quá trình, trong đó mỗi phương trình quá trình được giải tuần tự, thường giải quá trình có thang thời gian lớn nhất trước"* ✅ ([EPA CMAQ](https://www.epa.gov/cmaq/evaluation-cmaq-applications-neighborhood-scales)).

#### Tổng kết lựa chọn Euler-voxel

| | |
|---|---|
| **Ưu** | Native voxel; ghép thẳng vào raster 3D của GIS; hoàn toàn minh bạch; **đúng kỹ thuật mà đề tài yêu cầu**; dễ trực quan hoá và tạo animation; là mục **chắc chắn hoàn thành được** |
| **Nhược** | Khuếch tán số; **phải TỰ CUNG CẤP trường gió và K** chứ không tự tính ra; không có vật lý rối; toà nhà chỉ ảnh hưởng nếu trường gió đã mang thông tin đó |
| **Chi phí** | 2–3 tuần cho một bộ giải 3D chạy được bằng Python/NumPy, cộng phần kiểm chứng với nghiệm Gaussian giải tích |

### 6.5 Bước B (lựa chọn 2) — Lagrangian particle (LPDM) trên cùng lưới voxel

#### Phương trình Langevin

Thả N hạt tính toán, tích phân cho mỗi hạt một phương trình vị trí và một phương trình vận tốc ngẫu nhiên (tiêu chuẩn well-mixed của Thomson 1987):
```
dx_i = (U_i + u_i)·dt
du_i = a_i(x,u,t)·dt + b_ij(x,t)·dW_j
```
với dW = gia số quá trình Wiener, `b_ij·b_ij = C₀·ε̄`.

**QES-Plume viết tường minh phương trình Langevin tổng quát** ✅ ([Margairaz et al. 2023, GMD 16, 5729–5754](https://gmd.copernicus.org/articles/16/5729/2023/)):
```
du_i = [ −(C₀·ε̄/2)·τ⁻¹_ik·u_k + ½·τ⁻¹_ℓj·(dτ_iℓ/dt)·u_j + ½·∂τ_iℓ/∂x_ℓ ]·dt + √(C₀·ε̄)·dW_i
```
với τ_ij = tensor ứng suất Reynolds, ε̄ = tốc độ tiêu tán trung bình.

Tích phân thời gian trong QES-Plume dùng **sơ đồ ẩn trễ ổn định vô điều kiện** cho vận tốc và Euler tiến cho vị trí ✅.

⭐ **Nồng độ được khôi phục bằng cách đếm hạt vào các ô voxel** — đây chính là lý do LPDM vẫn tương thích voxel dù là phương pháp hạt. Kiểm định của QES-Plume dùng hộp lấy mẫu **1,5 × 1,5 × 1,5 m** ✅.

📐 **Ưu điểm then chốt so với sơ đồ Euler: không có khuếch tán số và không bị ràng buộc CFL ở số hạng tải.** ⚠️ (Đây là lập luận tiêu chuẩn của LPDM, không trích nguyên văn được từ nguồn nào đã đọc.)

#### Các cài đặt cụ thể

| Mô hình | Điểm chính | Giấy phép | Phù hợp đồ án? |
|---|---|---|---|
| **QES-Plume / QES-Winds** ⭐ | Bản mã nguồn mở, tăng tốc GPU của ý tưởng QUIC. Lưới Cartesian so le, Röckle + SOR Poisson, 4 biến thể solver. Miền đã trình diễn: **6 km × 6 km ở 2 m**, địa hình chênh 124 m ✅ | **GPL-3.0** ✅ ([GitHub](https://github.com/UtahEFD/QES-Public)) | **Chỉ khi có GPU NVIDIA Compute Capability ≥ 7.0** + CUDA, GDAL, NetCDF, Boost, C++17 |
| **QUIC** (LANL) | Bản gốc của phương pháp Röckle. *"mô hình phát tán đô thị phản hồi nhanh chạy trên laptop"*; QUIC-URB tính trường 3D quanh cụm nhà *"trong vài giây đến 15 phút"*; QUIC-PLUME *"hàng chục giây, tới 30 phút cho bài toán lớn"* ✅ ([LANL](https://www.lanl.gov/science-engineering/science-programs/office-of-science-programs/quic)) | **Không mã nguồn mở** — *"cấp cho nghiên cứu chính phủ và qua giấy phép nghiên cứu/thương mại"* ✅ | ❌ Không lấy được. **Nhưng [User's Guide](https://cdn.lanl.gov/files/quicurb-usersguide_c8fb5.pdf) là public release** — đọc để hiểu Röckle |
| **GRAL / GRAMM** (TU Graz) | GRAMM = mô hình dự báo mesoscale; GRAL = LPDM có **mô hình trường dòng vi mô tích hợp** tính *"ảnh hưởng của toà nhà lên phát tán"*, nhắm riêng *"điều kiện gió yếu và địa hình phức tạp"* ✅ ([gral.tugraz.at](https://gral.tugraz.at/)) | **GPL-3.0**, C#/.NET ✅ ([GitHub](https://github.com/GralDispersionModel/GRAL)) | ✅ Khả thi (Windows). ⚠️ Khuyến nghị về lưới/số hạt nằm trong PDF ở [GRALRecommendations](https://github.com/GralDispersionModel/GRALRecommendations) — chưa đọc được |
| **AUSTAL** (Đức) | Mô hình LPDM quy chuẩn theo TA Luft Phụ lục 2; **v3.3.0 (22/03/2024)** | **GNU GPL, miễn phí, CÓ MÃ NGUỒN**, Windows + Linux ✅ ([Umweltbundesamt](https://www.umweltbundesamt.de/en/topics/air/air-quality-control-in-europe/download)) | ✅ Đáng cân nhắc làm mô hình đối chứng |
| **FLEXPART v10.4** | Langevin + tiêu chuẩn well-mixed Thomson; *"thang từ hàng chục mét tới toàn cầu"* nhưng **không có tham số hoá toà nhà** — độ phân giải hiệu dụng = độ phân giải dữ liệu NWP đầu vào ✅ ([GMD 12, 4955](https://gmd.copernicus.org/articles/12/4955/2019/)) | **GPLv3** ✅ | ❌ Sai thang quy mô. Trích dẫn, đừng chạy |
| **SPRAY / Micro-Swift-Spray (MSS), PMSS** | SWIFT (dòng chẩn đoán bảo toàn khối lượng) + SPRAY (LPDM). Kiểm định với MUST, JU2003, CUTE ⚠️. Kỷ lục quy mô: **AIRCITY — toàn Paris, miền 14 × 11,5 km ở độ phân giải 3 m**, dùng 341–8052 lõi tính ⚠️ ([PDF ARIA](https://www.aria.fr/projets/aircity/pdf/H15-184.Moussafir.AIRCITY.V4.pdf)) | Thương mại (ARIA/MOKILI/CEA) | ❌ Không lấy được. Trích dẫn làm "state of practice" |

**Độ chính xác của lớp T3** (hai con số đã xác thực):
- URock vs QUIC-URB trên 4 bố cục nhà + 1 cây đơn lẻ: **hệ số tương quan 0,89–0,99** ✅. Chế độ hỏng đã biết: *"URock và QUIC-URB đánh giá vượt tốc độ gió ở hạ lưu cạnh đón gió của các toà nhà rộng, và cũng ở hạ lưu tán cây đơn lẻ"* ✅.
- QES-Plume vs hầm gió mảng 7×11 khối lập phương: **59% dự báo nằm trong hệ số 2 (FAC2 = 0,59)**, 99% khớp giá trị bằng 0, RMSE tương đối trung bình 15,6%; so với nghiệm Gaussian giải tích trong dòng đều: **sai số tương đối tối đa 5,91%** ✅.

### 6.6 URock 2023a — công cụ mã nguồn mở đáng chú ý nhất cho đề tài này ⭐

✅ ([Bernard, Lindberg & Oswald 2023, GMD 16, 5703–5727, DOI 10.5194/gmd-16-5703-2023](https://doi.org/10.5194/gmd-16-5703-2023) · [tài liệu UMEP](https://umep-docs.readthedocs.io/en/latest/processor/Wind%20model%20URock.html) · [dữ liệu Zenodo](https://doi.org/10.5281/zenodo.7681245))

| Thuộc tính | Giá trị (đã xác thực) |
|---|---|
| Bản chất | Cài đặt Python của tham số hoá Röckle + bảo toàn khối lượng Sasaki |
| Phân phối | **Plugin UMEP cho QGIS** (`urock_prepare` / `urock_analyser`), *"cũng dùng được như thư viện Python độc lập"* |
| Ngôn ngữ | Python + CSDL không gian H2GIS + **Numba** để tăng tốc |
| Giấy phép | **Creative Commons Attribution 4.0** |
| **Đầu ra** ⭐ | Raster tốc độ gió 2D, trường vector 2D, **và một file NetCDF chứa TRƯỜNG GIÓ 3D** |
| Lưới mặc định | **2 m ngang, 2 m đứng**; mở rộng miền mặc định 60 m theo gió, 40 m ngang gió, 20 m đứng ngoài phạm vi nhà |
| **Trần kỹ thuật** ⚠️ | *"Plugin này nặng tính toán, lưới lớn sẽ mất nhiều thời gian và lưới rất lớn (**trên 30.000.000 ô lưới 3D**) sẽ không dùng được"* |
| Chi phí thực đo | **15 → 180 giây, đơn luồng**, CPU 2,3 GHz, RAM 16 GB, cho các ca kiểm thử AIJ từ **4.900 đến 540.000 ô** (Table 2). Với 0,5–3 triệu ô: **~2–10 phút** |

📐 **Ý nghĩa:** URock cho phép nhóm **hoặc** dùng trực tiếp trường gió 3D của nó làm đầu vào cho bộ giải vận chuyển tự viết, **hoặc** tự cài đặt lại Röckle + SOR rồi dùng URock làm mốc đối chiếu. Cả hai đều là kết quả đồ án tốt.

**Nguồn gốc Röckle:** luận án tiến sĩ năm 1990 (TH Darmstadt), được URock dẫn là gốc của phương pháp ✅. ⚠️ **Không tìm được bản online của luận án** — trích dẫn gián tiếp qua URock hoặc QUIC-URB guide.

### 6.7 Cellular automata / voxel automata — biến thể "GIS-thuần" của cùng một thứ

**Có công trình đã xuất bản, và rất đúng chủ đề.**

⭐ **Bài gần đề tài nhất:** Shi, Tong, Yang, Chang, Zhong, Gai & Zuo (2020), *"SIMULATION AND EXPRESSION OF ATMOSPHERIC POLLUTION DISPERSION PROCESS BASED ON 3D GRID"*, **ISPRS Annals V-4-2020, 239–245** ✅ **(mở, đọc PDF miễn phí)** ([DOI 10.5194/isprs-annals-V-4-2020-239-2020](https://doi.org/10.5194/isprs-annals-V-4-2020-239-2020) · [PDF](https://isprs-annals.copernicus.org/articles/V-4-2020/239/2020/isprs-annals-V-4-2020-239-2020.pdf)). Trình bày một **mô hình dữ liệu lai hướng trạng thái/hướng đối tượng**, cài đặt *"biểu diễn lưới ba chiều thực sự và suy diễn cellular automata"*, thử với kịch bản một nguồn và nhiều nguồn, cho phép **tính toán và trực quan hoá động nồng độ theo thời gian, theo mặt cắt và theo vùng không gian**. ⚠️ Các quy tắc chuyển trạng thái, độ phân giải lưới và phần kiểm định **chưa trích xuất được** — PDF nén ảnh. **Đây là bài phải tự mở.**

| Công trình khác | Nguồn |
|---|---|
| ⭐ Jjumba & Dragićević (2015), *"Integrating GIS-Based Geo-Atom Theory and Voxel Automata to Simulate the Dispersal of Airborne Pollutants"*, **Transactions in GIS** — **tiền lệ gần nhất với đề tài này** ("voxel automata" + GIS, đăng trên tạp chí GIS) | ⚠️ [DOI 10.1111/tgis.12113](https://doi.org/10.1111/tgis.12113) (Wiley 403 — lấy qua thư viện trường) |
| *Air quality simulation through cellular automata*, Environmental Software (1992) | ⚠️ [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/0266983892900102) |
| *Cellular automata simulation of dispersion of pollutants*, Computational Materials Science | ⚠️ [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0927025600000975) |
| *Analysis of Atmospheric Quality based on Cellular Automata Simulation*, ICIIT 2020 — dùng *"quy tắc trọng lực, khuếch tán và gió"* | ⚠️ [DOI 10.1145/3385209.3385213](https://dl.acm.org/doi/10.1145/3385209.3385213) |
| Sonnenschein et al. (2024), *Hybrid Cellular Automata-Based Air Pollution Model for Traffic Scenario Microsimulations* — lai LUR + phát thải trên đường + CA ngoài đường | ✅ tải được [DOI 10.2139/ssrn.4933580](https://doi.org/10.2139/ssrn.4933580) |

> 📐 **Nhận định quan trọng — nên nói thẳng trong seminar:** một CA bảo toàn khối lượng, chuyển một phần khối lượng sang các ô lân cận theo trọng số gió cộng một phần đẳng hướng, **là tương đương về mặt đại số với một sơ đồ thể tích hữu hạn upwind hiện của phương trình tải–khuếch tán** (§6.4). Khác biệt chủ yếu là cách trình bày. Đây là một **insight**, không phải điểm yếu — và nêu ra nó chứng tỏ nhóm hiểu bản chất. Hệ quả thực dụng: **nên đóng khung công việc là "sơ đồ thể tích hữu hạn" thay vì "cellular automata"** — cùng một đoạn code, nhưng có thêm phân tích ổn định viết ra được và tránh được câu hỏi "sao không giải thẳng phương trình tải–khuếch tán?".

---

## 7. TẦNG T4 — CFD (RANS, LES, Lattice Boltzmann)

### 7.1 RANS (k-ε, k-ω SST) cho quy mô vi mô đô thị

**Phương trình:** Navier–Stokes trung bình Reynolds, không nén, với giả thiết độ nhớt xoáy Boussinesq:
```
∂ū_i/∂x_i = 0
ū_j·∂ū_i/∂x_j = −(1/ρ)·∂p̄/∂x_i + ∂/∂x_j[ (ν + ν_t)(∂ū_i/∂x_j + ∂ū_j/∂x_i) ] + f_i
```
đóng kín bằng 2 phương trình vận chuyển. Với **k-ω SST**: ⚠️ [Menter (1994), *AIAA Journal* 32(8), 1598–1605, DOI 10.2514/3.12149](https://doi.org/10.2514/3.12149) — mô hình *"dùng mô hình k-ω gốc của Wilcox ở vùng trong của lớp biên và chuyển sang k-ε tiêu chuẩn ở vùng ngoài và trong dòng cắt tự do"* ✅ (qua [NASA ADS](https://ui.adsabs.harvard.edu/abs/1994AIAAJ..32.1598M/abstract)) — chính sự pha trộn này khiến SST tốt hơn k-ε chuẩn cho dòng tách sau vật cản tù như toà nhà.

⭐ **Cầu nối khái niệm quan trọng:** sau khi có trường vận tốc hội tụ từ `simpleFoam`, phát tán chất ô nhiễm được giải bằng **đúng phương trình tải–khuếch tán ở §6.4**, với `K = ν_t/Sc_t` (số Schmidt rối thường 0,7–1,0), bằng `scalarTransportFoam` ✅. Nghĩa là: **bộ giải voxel của nhóm và CFD giải cùng một phương trình vận chuyển — chỉ khác nhau ở chỗ trường gió từ đâu ra.** Đây là một luận điểm rất mạnh cho seminar.

**Hướng dẫn thực hành chuẩn:**
- **COST Action 732** — *Best Practice Guideline for the CFD Simulation of Flows in the Urban Environment* (Franke, Hellsten, Schlünzen & Carissimo, 05/2007) ⚠️ ([PDF](https://theairshed.com/pdf/COST%20732%20Best%20Practice%20Guideline%20May%202007.pdf) — **PDF nén ảnh, không trích xuất được**). Bài tóm tắt: ⚠️ [Franke et al. 2011, DOI 10.1504/IJEP.2011.038443](https://doi.org/10.1504/IJEP.2011.038443), mục tiêu *"phát triển một quy trình đảm bảo chất lượng mạch lạc và có cấu trúc cho các mô hình khí tượng vi mô áp dụng cho mô phỏng dòng chảy và phát tán ở khu đô thị"*.
  > 🔴 **Các quy tắc định lượng cụ thể** (khoảng cách biên theo bội số chiều cao nhà H, quy tắc blockage ratio ≤ 3%, "ít nhất 10 ô mỗi cạnh nhà", "10 ô giữa hai nhà") **nằm trong Chương 4 của tài liệu đó nhưng chưa xác thực được.** Phải tự tải và đọc.
- **AIJ guidelines** — ⚠️ [Tominaga et al. (2008), *JWEIA* 96(10–11), 1749–1761, DOI 10.1016/j.jweia.2008.02.058](https://doi.org/10.1016/j.jweia.2008.02.058) (DOI xác nhận qua Crossref ✅; Elsevier chặn nội dung). Dựa trên thí nghiệm hầm gió, đo hiện trường và tính toán bằng nhiều code CFD; tập trung vào **RANS dừng**. Có bản đồng hành mới cho LES ⚠️ ([JWEIA 2025](https://www.sciencedirect.com/science/article/pii/S0167610525003174)).

**Chi phí thực tế đã báo cáo:**

| Ca | Số ô | Thời gian | Nguồn |
|---|---|---|---|
| Parade Square, Warsaw; SST k-ω RANS + scalar dispersion; miền 958 × 758 × 300 m | **> 2 triệu ô** | *"trong vài phút"* trên máy song song | ⚠️ [Elfverson & Lejon 2021, *Atmosphere* 12(9):1124, DOI 10.3390/atmos12091124](https://doi.org/10.3390/atmos12091124) (MDPI 403 — snippet) |
| "Twin Building", mở rộng trên >1000 lõi CPU | 26,17 triệu ô | cải thiện ~47×, xuống **46 giây** | ⚠️ [IEEE CONECCT 2024](https://ieeexplore.ieee.org/iel8/10676995/10677018/10677170.pdf) (snippet) |
| OpenFOAM song song, 1040 lõi Xeon Gold 6230 | ~16,2 triệu ô | **~155 giờ** | ⚠️ cùng nguồn (**cấu hình khác — không được gộp hai con số này**) |
| OpenFOAM RANS trên Michelstadt, Sc_t = 0,7 tốt nhất (L₂ = 0,28–0,29 đẳng hướng) | 1,73 → 27,52 triệu ô, 4 loại lưới | — | ✅ [Rakai & Kristóf 2013, PMC3763361](https://pmc.ncbi.nlm.nih.gov/articles/PMC3763361/) |

> ⚠️ **Điểm đau đã được ghi nhận:** trong nghiên cứu Michelstadt, kỹ năng mô hình phụ thuộc vào một hằng số điều chỉnh *"mà giá trị tối ưu phụ thuộc từng ca và không biết trước được"* ✅. Đây là nhược điểm học thuật thực chất của RANS cho phát tán.

**Kết luận T4-RANS cho nhóm:** 📐 Khó khả thi trong một học kỳ cho 2 sinh viên. `snappyHexMesh` trên hình học thành phố thật là thật sự khó — dự kiến 4–6 tuần chỉ riêng chia lưới và hội tụ, trước khi chạm tới phát tán. **Nếu làm, hãy dùng hình học lý tưởng hoá** (mảng MUST/Michelstadt, hoặc một khối lập phương) và coi nó là **dữ liệu kiểm chứng cho mô hình voxel**, không phải sản phẩm chính.

### 7.2 LES — PALM / PALM-4U

✅ ([Maronga et al. 2020, GMD 13, 1335–1372, DOI 10.5194/gmd-13-1335-2020](https://doi.org/10.5194/gmd-13-1335-2020) · [palm-model.org](https://palm-model.org/))

- Giải *"xấp xỉ không nén của phương trình Navier–Stokes, ở dạng xấp xỉ Boussinesq"* hoặc dạng anelastic; biến dự báo: 3 thành phần vận tốc, nhiệt độ thế, TKE dưới lưới, tỉ hỗn hợp hơi nước, các chất vô hướng thụ động ✅.
- ⭐ **Rời rạc hoá: sai phân hữu hạn trên lưới so le Arakawa C**, bước thời gian Runge–Kutta, bộ giải Poisson dựa trên **FFT** cho áp suất ✅. 📐 Lưới C này **về cấu trúc giống hệt lưới voxel của nhóm** — một lập luận tốt cho báo cáo.
- Độ phân giải: *"siêu máy tính ngày nay cho phép chạy miền lớn ở bước lưới mịn 1–10 m"* ✅.
- **Ca tiêu biểu:** LES phân giải toà nhà cho **toàn Berlin — ~1700 km² ở bước lưới 10 m, với một miền lồng 1 km² ở 1 m**, suốt một chu kỳ ngày đêm trong đợt nắng nóng ✅ ([Maronga et al. 2018, ICUC10, DLR elib](https://elib.dlr.de/121678/)).
- ⚠️ **Chi phí ca Berlin không công bố** trong các nguồn đọc được. Điều *có* nguồn: lồng lưới *"có thể giảm tới 80% thời gian CPU so với các lần chạy tham chiếu độ phân giải mịn, trong khi chi phí phụ trội từ thao tác lồng dưới 16% với cách ghép hai chiều"* ✅ ([Hellsten et al. 2021, GMD 14, 3185](https://gmd.copernicus.org/articles/14/3185/2021/)).
- **Giấy phép: GPLv3** ✅ ([PALM Trac](https://palm.muk.uni-hannover.de/trac)). PALM-4U là dịch vụ khí hậu đô thị vận hành, có tại DWD ✅ ([DWD](https://www.dwd.de/EN/ourservices/palm4u_en/palm4u_en.html)).

**Chi phí LES thực đo (số liệu rất thuyết phục cho slide so sánh):**

| Ca LES | Chi phí | Nguồn |
|---|---|---|
| GPU LES của Michel-Stadt, ca 1 | **404,9 GPU-giờ** | ✅ [arXiv:2502.13672](https://arxiv.org/abs/2502.13672) |
| GPU LES của Michel-Stadt, ca 2 | **4.744 GPU-giờ = 6,7 ngày trên 32 GPU** | ✅ cùng nguồn |
| Chuỗi mô hình vùng + mạng phố cho Paris, 2 tháng mô phỏng | **11.520 giờ-CPU** (vùng) + **7.680** (quy mô phố) | ✅ [ACP 25, 3363, 2025](https://acp.copernicus.org/articles/25/3363/2025/) |

**Kết luận:** 📐 **Không khả thi.** PALM cần Fortran, MPI, NetCDF, FFTW và thực tế là một suất HPC. Chỉ riêng việc dựng static driver (nhà, bề mặt đất, thực vật) cho một địa điểm thật đã là công việc nhiều tuần. **Trích dẫn, đừng chạy.**

### 7.3 Lattice Boltzmann (LBM)

**Phương trình** (📐 dạng sách giáo khoa; ⚠️ **không trích xuất được từ nguồn chính thức nào trong quá trình research — phải kiểm chứng lại với tài liệu OpenLB hoặc Palabos**):
```
f_i(x + c_i·Δt, t + Δt) − f_i(x, t) = Ω_i,    Ω_i = −(Δt/τ)·(f_i − f_i^eq)
f_i^eq = w_i·ρ·[1 + (c_i·u)/c_s² + (c_i·u)²/(2c_s⁴) − (u·u)/(2c_s²)]
ρ = Σ f_i,   ρu = Σ f_i c_i,   ν = c_s²(τ − Δt/2)
```
Bộ vận tốc D3Q19 / D3Q27.

📐 **Vì sao LBM đáng quan tâm với đề tài voxel:** LBM chạy **tự nhiên trên lưới Cartesian đều** — tức là một lưới voxel — với toà nhà biểu diễn bằng **bounce-back tại voxel rắn**. Không cần chia lưới body-fitted. Về mặt khái niệm, đây là phương pháp "CFD thật" gần mô hình voxel nhất.

Bằng chứng đã có nguồn:
- Phát tán trong hẻm phố bằng LBM-LES: ⚠️ [Merlier, Jacob & Sagaut 2018, *Atmos. Environ.* 195, 89–103, DOI 10.1016/j.atmosenv.2018.09.040](https://doi.org/10.1016/j.atmosenv.2018.09.040)
- Review: ⚠️ [*Atmosphere* 12(7), 833](https://www.mdpi.com/2073-4433/12/7/833) (MDPI 403)
- Quy mô HPC đạt được: **tới 18 tỉ ô trên 128 node** siêu máy tính HoreKa với OpenLB ✅ ([arXiv:2506.21804](https://arxiv.org/abs/2506.21804))
- LBM đô thị gần thời gian thực: framework LBM-LES tăng tốc GPU *"tái dựng trường gió ba chiều ở độ phân giải 5 m trên miền quy mô kilômét trong vài phút"*, kiểm định với Doppler lidar đa điểm ở Quảng Châu ✅ ([arXiv:2607.04516](https://arxiv.org/abs/2607.04516))
- Chi phí một kịch bản LBM-LES phát tán đô thị: **~25 phút/kịch bản** ✅ ([Li & Li 2026, *Sensors* 26(8):2367, PMC13119786](https://pmc.ncbi.nlm.nih.gov/articles/PMC13119786/))

**Công cụ:** OpenLB (C++), Palabos (C++, AGPL), FluidX3D (OpenCL, GPU), PowerFLOW (thương mại, không lấy được). ⚠️ *Giấy phép của 3 cái đầu nêu theo hiểu biết chung, chưa xác thực LICENSE file.*

📐 **Khả thi: THẤP–TRUNG BÌNH.** Tự viết bộ giải D3Q19 BGK với bounce-back thực ra là một bài tập sinh viên kinh điển và vừa sức (~300 dòng), và rất hợp chủ đề voxel. **Nhưng** làm nó ổn định ở số Reynolds khí quyển đòi hỏi toán tử va chạm LES/regularised — đó là bước ở mức nghiên cứu. **Coi là mục tiêu mở rộng, không phải sản phẩm chính.**

---

## 8. TẦNG T5 — Mô hình vận chuyển hoá học Eulerian (CTM)

### 8.1 CMAQ (US EPA)

- **Độ phân giải đã thử nghiệm:** 12 km (chuẩn toàn nước Mỹ), 4 km, 2 km và **1 km** (Baltimore–Washington) ✅ ([EPA](https://www.epa.gov/cmaq/evaluation-cmaq-applications-neighborhood-scales)).
- ⭐ **Câu nên trích nguyên văn trong seminar — lý do vì sao CTM không dùng được ở quy mô vi mô:**
  > *"Các mô hình chất lượng không khí Eulerian pha loãng tức thời phát thải điểm ra toàn bộ thể tích của ô lưới."* ✅
  Nghĩa là: một ô 1 km chứa cả hẻm phố, mái nhà và công viên sẽ trả về **một con số duy nhất**. Không thể phân giải toà nhà — đây là **giới hạn cấu trúc, không phải thiết lập độ phân giải**.
- Mã nguồn mở trên GitHub ✅ ([USEPA/CMAQ](https://github.com/USEPA/CMAQ)).
- Đầu vào: khí tượng WRF qua MCIP, phát thải xử lý bằng SMOKE, điều kiện biên từ miền lớn hơn, lớp phủ.
- 📐 **Khả thi: RẤT THẤP.** Cần một lần chạy WRF, xử lý phát thải SMOKE, suất HPC, toolchain Fortran. **Đừng thử.**

### 8.2 CAMx (Ramboll)

Mô hình lưới quang hoá "one-atmosphere" *"trên các thang không gian từ khu phố tới lục địa"*, giải *"phương trình liên tục chất ô nhiễm cho từng loài hoá học trên một hệ lưới ba chiều lồng nhau"* ✅ ([Ramboll](https://www.ramboll.com/en-us/products/government-and-public/camx)). Miễn phí, mã nguồn mở. ⚠️ **"Khu phố" ở đây nghĩa là ô ~1 km, không phải toà nhà.** ⚠️ Không đọc được phương trình cụ thể trong [User's Guide v7.20](https://www.camx.com/Files/CAMxUsersGuide_v7.20.pdf).

### 8.3 WRF-Chem

Hoá học dùng *cùng sơ đồ vận chuyển (bảo toàn khối lượng và vô hướng), cùng lưới, cùng vật lý cho vận chuyển dưới lưới và cùng bước thời gian* với khí tượng ✅ ([Grell et al. 2005, PDF NCAR](https://www2.mmm.ucar.edu/people/skamarock/grell_et_al_2005.pdf) · [DOI](https://doi.org/10.1016/j.atmosenv.2005.04.027)).

> ⚠️ **Trạng thái quan trọng:** NOAA/NCAR nêu rõ *"trước những phát triển mô hình mới và do hạn chế nguồn lực, WRF-Chem không còn được phát triển tiếp."* ✅ ([NCAR/ACOM](https://www2.acom.ucar.edu/wrf-chem)). **Cần nói điều này nếu đưa WRF-Chem vào slide.**

### 8.4 ⭐ EPISODE v10.0 — kiến trúc lai đáng học nhất

✅ ([Hamer et al. 2020, GMD 13, 4323, DOI 10.5194/gmd-13-4323-2020](https://gmd.copernicus.org/articles/13/4323/2020/))

> *"một mô hình lưới 3D Eulerian với các mô hình phát tán dưới lưới nhúng bên trong, bao gồm một mô hình chùm khói Gaussian cho phát tán ô nhiễm từ nguồn đường (đường giao thông) và nguồn điểm"*

Thông số: lớp sigma bám địa hình với **lớp thấp nhất 19–24 m**, 6–14 lớp trong 500 m đầu, lên tới 4000 m; phương pháp khuếch tán xoáy đứng đô thị tính tới *"xáo trộn rối nền do độ nhám đô thị và nhiệt nhân tạo"*; tới 35.000 điểm receptor ✅.

📐 **Đây chính xác là kiểu thiết kế "lưới 3D thô + Gaussian giải tích dưới lưới" mà một đồ án voxel nên học theo.**

### 8.5 CAIRDIO v1.0 — bằng chứng mạnh nhất về ảnh hưởng của ĐỘ PHÂN GIẢI

✅ ([GMD 14, 1469, 2021, DOI 10.5194/gmd-14-1469-2021](https://gmd.copernicus.org/articles/14/1469/2021/)) — **open access**

CAIRDIO (City-scale AIR dispersion model with DIffuse Obstacles) được xây dựng đúng để trả lời câu hỏi "độ phân giải nào là đủ". Nó biểu diễn toà nhà bằng **trường tỉ lệ thể tích (χ) và tỉ lệ diện tích (η)** thay vì lưới bám biên, và đã được chạy ở **5, 10, 20, 40, 80 m** đối chiếu dữ liệu hầm gió:

| Độ phân giải ngang | NMSE | FB | FAC2 |
|---|---|---|---|
| **5 m (tham chiếu)** | **0,10** | 0,12 | **0,84** |
| 10 m | 0,25 | 0,17 | — |
| **20 m** | **1,35** | 0,65 | — |
| 40 m | "độ tin cậy không quá nhạy" | — | — |
| 80 m | — | −0,57 | 0,32 (vừa đủ đạt) |

> ⭐ **Cách đọc bảng này (rất đáng đưa vào seminar):** so với tiêu chí chấp nhận đô thị mà chính bài đó trích (NMSE < 6, |FB| < 0,67, FAC2 > 0,3), **mọi độ phân giải từ 5 m đến 80 m đều "đạt" về mặt kỹ thuật — nhưng NMSE xấu đi hơn một bậc độ lớn khi đi từ 5 m lên 20 m.** Kết luận kép: (1) tiêu chí chấp nhận là bộ lọc yếu; (2) **~5–10 m là ngưỡng mà mô hình voxel bắt đầu mất kỹ năng nhanh chóng**. Đây là căn cứ bằng văn bản để chọn độ phân giải của đồ án.

CAIRDIO viết bằng **Python với NumPy vector hoá và MPI**, dùng bộ giải áp suất geometric multigrid, mở rộng tốt tới 400 lõi ✅. 📐 Tức là một mô hình peer-reviewed, viết bằng Python, dùng biểu diễn toà nhà kiểu "phân số thể tích trong voxel" — **một tiền lệ cực tốt để trích dẫn**.

---

## 9. TẦNG T6 — Mô hình thay thế bằng học máy (ML surrogate)

| Cách tiếp cận | Hiệu năng báo cáo | Nguồn |
|---|---|---|
| **GNN đa mục tiêu** cho phát tán chất rò rỉ dạng quá độ trong môi trường đô thị | *"nhanh hơn mô phỏng CFD 1–2 bậc độ lớn"*, **R² = 0,92**, giảm 70% bộ nhớ GPU | ⚠️ [PubMed 39153302](https://pubmed.ncbi.nlm.nih.gov/39153302/) (snippet) |
| **cGAN dẫn hướng bởi hình thái**, huấn luyện trên LBM | **0,07–0,08 s**, tức nhanh hơn CFD *"khoảng 18.000 lần"*, đạt **FAC2 = 0,925, FB = −0,114** | ✅ [Li & Li 2026, *Sensors* 26(8):2367](https://pmc.ncbi.nlm.nih.gov/articles/PMC13119786/) |
| **FastFlow** (CNN trên raster bố cục đô thị → gió mực người đi bộ) | *"sai số kiểm thử dưới 0,1 m/s cho các bố cục đô thị chưa từng thấy"* | ✅ [arXiv:2211.12035](https://arxiv.org/abs/2211.12035) |
| **UrbanFlow-3K** — bộ dữ liệu 3000 mô phỏng LBM bố cục nhà ngẫu nhiên | Kho huấn luyện sẵn có | ✅ [arXiv:2603.16554](https://arxiv.org/html/2603.16554) |
| CFD-GNN hai giai đoạn cho dòng khí và phát tán đô thị trạng thái dừng | — | ⚠️ [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S2210670724004323) |

> 📐 **Điểm mà giảng viên chắc chắn sẽ hỏi:** mọi surrogate đều cần **một kho dữ liệu CFD để huấn luyện**. Nếu không chạy được CFD thì không huấn luyện được surrogate — **trừ khi** dùng bộ dữ liệu đã công bố như UrbanFlow-3K. **Khả thi: THẤP nếu làm từ đầu, TRUNG BÌNH nếu dùng dữ liệu có sẵn.** Một 3D CNN/U-Net ánh xạ (voxel chiếm chỗ của nhà + hướng gió vào) → (voxel vận tốc) là thực sự làm được bằng PyTorch trong vài tuần *nếu có dữ liệu*.

### 9.1 Nội suy dữ liệu cảm biến vào không gian 3D (và vì sao nó KHÔNG thay được mô hình)

- Data fusion cho bản đồ chất lượng không khí từ cảm biến giá rẻ: phần dư sau hiệu chỉnh hồi quy được nội suy bằng **ordinary kriging với mô hình Gaussian, tính tham số kriging cho từng giờ** ⚠️ ([Environment International](https://www.sciencedirect.com/science/article/pii/S0160412020319206), snippet).
- Kết hợp cảm biến giá rẻ với mô hình phát tán để có độ phân giải cao ⚠️ ([Environment International 2026](https://www.sciencedirect.com/science/article/pii/S0160412026001157)).
- Gaussian Process thời-không với xấp xỉ Vecchia ✅ ([arXiv:2511.22500](https://arxiv.org/pdf/2511.22500)); so sánh mô hình bản đồ hoá từ cảm biến cố định + di động ✅ ([arXiv:2511.22550](https://arxiv.org/pdf/2511.22550)).

> ### 🔴 Kết luận phương pháp luận cần nói thẳng trong seminar
> **Hầu như toàn bộ công việc nội suy cảm biến trong thực tế là 2-D (bản đồ mặt đất).** Nội suy 3-D thể tích thực sự cho chất lượng không khí đô thị là **hiếm**, vì gần như không có phép đo theo phương đứng. **Không tìm được bài báo nào thực hiện nội suy 3-D thể tích đầy đủ cho một mạng cảm biến đô thị.**
>
> Hệ quả: **nội suy 3–10 cảm biến mặt đất lên lưới voxel KHÔNG tạo ra trường phát tán — nó tạo ra những "đốm" trơn quanh mỗi cảm biến.** Chính **mô phỏng phát tán** (Gaussian, Lagrange hay CFD) mới là cơ chế đặt chất ô nhiễm vào đúng nơi mà gió và toà nhà đưa nó tới. **Hãy đóng khung nội suy là baseline cần vượt qua và là công cụ đồng hoá/kiểm định tại vị trí cảm biến — không phải là mô hình.**

---

## 10. BẢNG SO SÁNH TỔNG HỢP VÀ PHÂN TÍCH TRADE-OFF

### 10.1 Bảng so sánh chính

| | **T0 Box** | **T1 Gaussian** | **T2 Canyon** | **T3 Röckle+voxel** ⭐ | **T4 CFD RANS** | **T4 LES/LBM** | **T5 CTM** | **T6 ML** |
|---|---|---|---|---|---|---|---|---|
| Vật lý được giải | cân bằng khối lượng | nghiệm giải tích khuếch tán | hộp + chùm khói | bảo toàn khối lượng + tải-khuếch tán | RANS + vận chuyển | NS lọc / Boltzmann | hoá học-vận chuyển vùng | học từ dữ liệu |
| Phân giải toà nhà | ❌ | ❌ (chỉ downwash) | 🟡 tham số hoá | ✅ **hình học** | ✅ | ✅ | ❌ | 🟡 |
| Xoáy hẻm phố | ❌ | ❌ | ✅ | 🟡 tham số Röckle | ✅ | ✅ | ❌ | 🟡 |
| Rối do xe cộ (lặng gió) | ❌ | ❌ | ✅ **OSPM** | ❌ (phải thêm tay) | 🟡 | 🟡 | ❌ | 🟡 |
| Trường 3D theo z | ✅ | ✅ | 🟡 1 giá trị/phố | ✅ **native** | ✅ | ✅ | ✅ nhưng thô | ✅ |
| Độ phân giải điển hình | thành phố | 10–100 m | đoạn phố | **1–10 m** | 0,5–5 m | < 1 m | 1–12 km | tuỳ train |
| Chi phí | tức thì | giây | giây | **giây → phút** | phút → giờ | **giờ → ngày → HPC** | HPC | ms (sau train) |
| Bằng chứng chi phí | — | 1 M điểm ~3 phút ✅ | — | 21 M ô: 11–12 s/bước ✅; URock 0,5–3 M ô: 2–10 phút ✅ | 2 M ô "vài phút" ⚠️ | 4.744 GPU-giờ ✅ | 11.520 CPU-giờ (2 tháng) ✅ | 0,07 s ✅ |
| Độ chính xác đô thị (FAC2) | — | thường < 0,5 ⚠️ | SIRANE 0,73–0,90 ✅ | QES-Plume **0,59** ✅ | tới ~0,95 ca tốt ⚠️ | cao nhất | — | cGAN 0,925 ✅ |
| Mã nguồn mở? | (tự viết) | ✅ AERMOD public domain | 🟡 MUNICH GPL; OSPM/SIRANE/ADMS không | ✅ **URock CC-BY, QES GPL, GRAL GPL, AUSTAL GPL** | ✅ OpenFOAM GPL | ✅ PALM GPL, OpenLB | ✅ CMAQ, CAMx | tự viết |
| **Khả thi cho 2 SV / 1 học kỳ** | **CAO** | **CAO** | **CAO** | **CAO–TB** | **THẤP** | **RẤT THẤP** | **RẤT THẤP** | **THẤP–TB** |

### 10.2 Bằng chứng so sánh trực tiếp giữa các họ

> 🔴 **Phải nói thẳng: KHÔNG tìm được một nghiên cứu đối chứng nào đặt Gaussian, Röckle-chẩn đoán, Lagrange và CFD trên CÙNG một ca và báo cáo FAC2 cho từng loại.** Ba ứng viên hiển nhiên đều bị paywall:
> - ⚠️ FAIRMODE intercomparison tại Antwerp, [*Sci. Total Environ.* 2024](https://www.sciencedirect.com/science/article/pii/S0048969724019041) — kết luận (snippet): *"các mô hình có tính tới hình học đô thị phức tạp (CFD, Lagrange và AI) dường như cho ước lượng tốt hơn về phân bố không gian nồng độ NO₂ trung bình trong canopy đô thị so với các cách tiếp cận đơn giản hơn"*
> - ⚠️ Antonioni et al. (2012), [*Atmos. Environ.* 47, 365–372](https://www.sciencedirect.com/science/article/abs/pii/S1352231011011459) — CFD (Fluidyn-PANACHE) đạt **95% trong hệ số 2** ở nồng độ cực đại theo đường lấy mẫu (snippet)
> - ⚠️ UDINEE JU2003 multi-model, [DOI 10.1007/s10546-019-00433-8](https://doi.org/10.1007/s10546-019-00433-8)
> - ⚠️ *Evaluation of fast atmospheric dispersion models in a regular street network*, [DOI 10.1007/s10652-018-9587-7](https://doi.org/10.1007/s10652-018-9587-7)

📐 **Tổng hợp của nhóm (trình bày là NHẬN ĐỊNH RIÊNG, không phải trích dẫn):** các điểm dữ liệu rời rạc đã xác thực cho thấy một **thang ba bậc**:

| Bậc | Độ chính xác | Chi phí |
|---|---|---|
| **Gaussian** | FAC2 thường < 0,5 trong khu xây dựng dày | giây |
| **Röckle + Lagrange** | FAC2 ~ 0,5–0,6 (QES-Plume: **0,59** ✅) | giây → phút |
| **CFD** | FAC2 tới ~0,95 ở ca tốt nhất | giờ → ngày |
Và một nhận định có nguồn từ chính văn liệu Lagrange: *"cách tiếp cận mô hình hoá ngẫu nhiên Lagrange có thể là một thoả hiệp giữa các mô hình Gaussian đơn giản và các mô hình CFD tiên tiến"* ⚠️ (snippet từ [ScienceDirect S0167610519305768](https://www.sciencedirect.com/science/article/abs/pii/S0167610519305768)).

### 10.3 Ba trade-off cốt lõi để nói trong seminar

**Trade-off 1 — Độ chính xác đổi lấy chi phí là PHI TUYẾN.**
Đi từ Gaussian lên Röckle-chẩn đoán: chi phí tăng ~100×, FAC2 tăng từ ~0,4 lên ~0,6. Đi tiếp lên LES: chi phí tăng thêm ~1000× (404–4744 GPU-giờ ✅), FAC2 tăng lên ~0,8–0,95. **Bậc thang thứ hai đắt hơn bậc thứ nhất rất nhiều nhưng lợi ích tăng thêm ít hơn.** Với đồ án sinh viên, **bậc thang thứ nhất là nơi tỉ lệ lợi ích/chi phí cao nhất.**

**Trade-off 2 — Độ phân giải đổi lấy bộ nhớ là BẬC BA.**
Giảm một nửa kích thước ô → **nhân 8 lần bộ nhớ và ~16 lần thời gian** (8× số ô × 2× số bước do CFL). Xem bảng bộ nhớ ở §11.2. Kết hợp với bảng CAIRDIO (§8.5): **5–10 m là điểm ngọt** — đủ mịn để không mất kỹ năng nhanh, đủ thô để chạy trên laptop.

**Trade-off 3 — Vật lý đổi lấy tính minh bạch và khả năng bảo vệ.**
Chạy một mô hình đóng gói (GRAL, AUSTAL) cho kết quả vật lý tốt hơn nhưng nhóm **không kiểm soát và không giải thích được nội bộ**. Tự viết bộ giải voxel cho kết quả vật lý kém hơn nhưng nhóm **giải thích được từng dòng, viết được phân tích ổn định, và đó mới đúng là "kỹ thuật GIS 3D" mà đề tài yêu cầu**. 📐 Với một đồ án môn học, trục thứ hai quan trọng hơn trục thứ nhất — nhưng lý tưởng là **làm cả hai và so sánh**.

---

# PHẦN II — KỸ THUẬT GIS 3D

## 11. Mô hình dữ liệu voxel / 3D array

### 11.1 Voxel là gì, và khác gì các mô hình 3D GIS khác

**Định nghĩa.** Lưới voxel là một phép rời rạc hoá đều không gian ba chiều. OpenVDB định nghĩa đối tượng của nó là *"dữ liệu thể tích thưa, biến đổi theo thời gian, **được rời rạc hoá trên các lưới ba chiều**"* ✅ ([openvdb.org/about](https://www.openvdb.org/about/)). Trong hệ VTK/ParaView, cấu trúc tương đương là **ImageData** — *"lưới đều có cấu trúc"* với khoảng cách hằng theo cả ba trục, ghi ra `.vti` ✅ ([VTK file formats](https://examples.vtk.org/site/VTKFileFormats/)).

**Vì sao dùng voxel trong GIS** — phát biểu rõ nhất từ lĩnh vực GIS ✅ ([Gorte, Zlatanova, Pilouk, Diakité & Barton 2024, *3D Data Integration in the Voxel Domain*, ISPRS Annals X-4-2024, 133–140](https://isprs-annals.copernicus.org/articles/X-4-2024/133/2024/)): các mô hình 3D dạng vector có *"tính đa dạng hình học đáng kể, làm phức tạp các phép toán tính toán cần thiết để kiểm tra và xác nhận mô hình"*; nhóm tác giả đề xuất **voxel hoá như một cơ chế chuẩn hoá** — chuyển các bộ dữ liệu 3D không đồng nhất về một biểu diễn rời rạc thống nhất, rồi thực hiện overlay **trong miền voxel**. Dữ liệu có cấu trúc voxel *"thoả mãn hầu hết các yêu cầu về tính hợp lệ và toàn vẹn"* ✅.

📐 **Bảng so sánh (tổng hợp của nhóm, dựa trên các định nghĩa đã dẫn — KHÔNG phải trích dẫn):**

| Mô hình | Lưu gì | Bản chất chiều |
|---|---|---|
| Raster 2.5D (DEM/DSM) | một z cho mỗi ô (x,y) | một **hàm** z = f(x,y); không biểu diễn được phần nhô ra, không biểu diễn được trường phía trên mặt đất |
| TIN | mặt tam giác hoá bất quy tắc | mặt 2.5D, độ phân giải thích nghi |
| B-rep solid (CityGML/CityJSON Solid) | các mặt biên của một khối kín | 3D nhưng **chỉ biên**; phần bên trong là ngầm định, không được lấy mẫu |
| Point cloud | mẫu 3D bất quy tắc, không topology | mẫu 3D, không lấp đầy không gian |
| **Voxel / 3D array** | một giá trị tại **mọi** ô của một lưới 3D đều | **trường 3D**: chiếm chỗ, nồng độ, gió — được định nghĩa ở mọi điểm trong miền |

⭐ **Luận điểm cho đề tài:** nồng độ chất ô nhiễm là một **trường vô hướng thể tích**, và **chỉ mô hình voxel/3D array mới lưu một giá trị tại mọi điểm trong khối không khí**, kể cả phía trên mái và bên trong hẻm phố. CityJSON xác nhận bản chất B-rep của mô hình thành phố: các nguyên thuỷ là `MultiSurface`, `CompositeSurface`, `Solid`, `MultiSolid`, `CompositeSolid` — *"các nguyên thuỷ tuyến tính và phẳng nhúng trong không gian 3D, không cho phép đường cong hay mặt tham số"* ✅ ([CityJSON 2.0.1](https://www.cityjson.org/specs/2.0.1/)).

**Hai tham chiếu voxel-GIS khác đáng đưa vào literature review:**
- ✅ Aleksandrov, Zlatanova, Kimmel, Barton & Gorte (2019), *Voxel-Based Visibility Analysis for Safety Assessment of Urban Environments* — voxel hoá khối đô thị và ghi *"số lần mỗi voxel được quan sát"*, phân loại thành các vùng ([DOI 10.5194/isprs-annals-IV-4-W8-11-2019](https://isprs-annals.copernicus.org/articles/IV-4-W8/11/2019/)).
- ⚠️ *Spatial indices for measuring three-dimensional patterns in a voxel-based space*, J. Geogr. Syst. ([DOI 10.1007/s10109-016-0231-0](https://link.springer.com/article/10.1007/s10109-016-0231-0)) — Springer chuyển hướng xác thực.
- ⚠️ *Voxelization algorithms for geospatial applications*, MethodsX ([DOI 10.1016/j.mex.2016.01.001](https://doi.org/10.1016/j.mex.2016.01.001)) — 403.
- ⭐ ✅ Ridzuan, Wickramathilaka, Ujang & Azri (2024), *3D Voxelisation for Enhanced Environmental Modelling Applications*, **Pollution 10(1), 151–167** ([DOI 10.22059/poll.2023.360562.1942](https://doi.org/10.22059/poll.2023.360562.1942)) — trực tiếp đúng chủ đề: voxel hoá cho tiếng ồn giao thông (voxel + kriging 3D) và cho ô nhiễm không khí, thay thế *"các thủ tục mô phỏng gió ngẫu nhiên"* bằng mô hình dựa trên voxel. **Dùng LoD1 cho tiếng ồn và LoD2 cho gió** vì độ phức tạp toà nhà quyết định kích thước voxel cần thiết — **tiền lệ cụ thể để biện minh lựa chọn LoD/kích thước voxel của nhóm.**

### 11.2 ⭐ Bài toán bộ nhớ — con số quyết định tính khả thi

📐 **Toàn bộ mục này là tính toán của nhóm, không phải trích dẫn.** Cơ sở: mảng kiểu Zarr/NumPy là *"mảng N chiều có chunk, có nén"* với dtype cố định mỗi phần tử ✅ ([Zarr docs](https://zarr.readthedocs.io/en/stable/)).

```
bytes = N_x · N_y · N_z · itemsize,   với N_i = kích_thước_i / Δ
```
Vì cả ba trục cùng co lại: **giảm một nửa kích thước ô → nhân 8 lần bộ nhớ.**

**Ví dụ 1 — 1 km × 1 km × 200 m (một khu phố):**

| Δ | N_x × N_y × N_z | Số voxel | float32 (4 B) | float64 (8 B) |
|---|---|---|---|---|
| 20 m | 50 × 50 × 10 | 25.000 | 0,10 MB | 0,20 MB |
| 10 m | 100 × 100 × 20 | 200.000 | 0,80 MB | 1,6 MB |
| **5 m** | **200 × 200 × 40** | **1.600.000** | **6,4 MB** | 12,8 MB |
| 2 m | 500 × 500 × 100 | 25.000.000 | 100 MB | 200 MB |
| 1 m | 1000 × 1000 × 200 | 200.000.000 | 800 MB | 1,6 GB |

**Ví dụ 2 — 10 km × 10 km × 500 m (một quận):**

| Δ | Số voxel | float32 |
|---|---|---|
| 20 m | 6,25 M | 25 MB |
| 10 m | 50 M | 200 MB |
| 5 m | 400 M | 1,6 GB |
| 2 m | 6,25 G | **25 GB** |

**Các hệ số nhân sẽ cắn bạn:**
- **Thời gian.** 24 ảnh chụp theo giờ × các số trên. 5 m trên 10 km² cho một ngày = **38,4 GB float32**.
- **Số biến.** Nồng độ + u,v,w + nhiệt độ = 5 trường ⇒ **×5**.
- **Bản sao tạm.** Mọi biểu thức NumPy kiểu `c2 = c*k + b` đều cấp phát một mảng tạm đầy đủ; RAM đỉnh thường **gấp 2–3 lần** mảng gốc.

📐 **Hệ quả thực tiễn:** với một quận của một thành phố Việt Nam, lưới **5–10 m ngang / 2–5 m đứng trên ~1–4 km²** nằm gọn trong RAM một máy nếu dùng `float32`. Ở 1 m cho cả một quận thì phải chuyển sang chunking (Zarr/dask) chứ không dùng được mảng NumPy dày đặc. **Dùng `float32`, không dùng `float64` trừ khi biện minh được — đó là khoản tiết kiệm 2× miễn phí.**

### 11.3 Cấu trúc thưa và phân cấp — khi nào cần

| Cấu trúc | Nội dung đã xác thực | Khi nào thắng |
|---|---|---|
| **Octree (3D Tiles Implicit Tiling)** | *"Chia mỗi tile thành 8 tile nhỏ hơn, mỗi chiều bị chia đôi"*, tile định địa chỉ bằng `(level, x, y, z)`, `geometricError` của con bằng **một nửa** của cha; độ thưa xử lý bằng **availability bitstream** đánh chỉ mục theo thứ tự **Morton Z** để *"nén tốt hơn"* ✅ ([đặc tả CesiumGS](https://github.com/CesiumGS/3d-tiles/tree/main/specification/ImplicitTiling)) | **Phân phối và render**, không phải tính toán |
| **OpenVDB** | *"cấu trúc tăng tốc ba chiều giống B-tree"*: RootNode → InternalNodes → LeafNodes; cấu hình chuẩn (5,4,3) cho **LeafNode 8×8×8**, node cấp 1 là 16³, cấp 2 là 32³. Ba cơ chế thưa: **tile values** (cả khối 8³ lưu thành một hằng số), **background value** (vùng chưa khởi tạo tốn 0 byte), **active/inactive** để lặp bỏ qua khoảng trống; `prune()` *"thay bằng tile values những node bao trùm các voxel cùng giá trị và cùng trạng thái active"* ✅ ([OpenVDB overview](https://www.openvdb.org/documentation/doxygen/overview.html)) | **Mặt nạ hình học** (toà nhà, địa hình) — khối nhà đặc là một ca thắng kinh điển của tile value |
| **Zarr / dask** | Zarr: *"mảng N chiều có chunk, có nén"*, lưu trữ linh hoạt trên local/cloud/in-memory ✅. Dask Array: *"cài đặt một tập con của giao diện NumPy ndarray bằng **thuật toán theo khối**, cắt mảng lớn thành nhiều mảng nhỏ"*, cho phép *"tính trên mảng lớn hơn bộ nhớ, dùng toàn bộ số lõi"* ✅ ([Dask Array](https://docs.dask.org/en/stable/array.html)) | Trường lớn hơn RAM hoặc nằm trên object storage |
| **NumPy dày đặc** | — | Miền vừa RAM, muốn đơn giản, và **mọi ô đều có ý nghĩa** (trường nồng độ thường *là* dày đặc) |
| RLE / `scipy.sparse` | ❌ **KHÔNG có nguồn** khuyến nghị cho trường địa không gian 3D. `scipy.sparse` hướng ma trận 2D. **Không tuyên bố điều này** | — |

Tài liệu gốc OpenVDB: *"thư viện C++ từng đoạt giải Academy Award… để thao tác hiệu quả dữ liệu thể tích thưa, biến đổi theo thời gian, rời rạc trên lưới ba chiều"*, tạo tại DreamWorks bởi Museth, Cucka, Aldén và Hill, mở mã 2012, nay thuộc Academy Software Foundation ✅. Bài báo tham chiếu: ⚠️ [Museth, *VDB: High-Resolution Sparse Volumes with Dynamic Topology*, ACM TOG, DOI 10.1145/2487228.2487235](https://dl.acm.org/doi/10.1145/2487228.2487235) (ACM 403).

### 11.4 Định dạng file cho trường 3D

| Định dạng | Phát biểu đã xác thực | GIS đọc được? |
|---|---|---|
| ⭐ **netCDF + CF conventions** | Mục đích là bộ dữ liệu **tự mô tả** — *"mỗi giá trị có thể định vị trong không gian (tương đối với toạ độ Trái Đất) và thời gian"*. Công nhận **toạ độ đứng dạng chiều, không thứ nguyên và tham số**, ánh xạ qua `standard_name` + `formula_terms` ✅ ([cfconventions.org](https://cfconventions.org/cf-conventions/cf-conventions.html)) | ✅ **lựa chọn mạnh nhất** — ArcGIS Pro voxel layer bắt buộc |
| **HDF5** | *"bộ dữ liệu n chiều, mỗi phần tử có thể tự nó là một đối tượng phức hợp"*; *"không giới hạn số lượng hay kích thước đối tượng dữ liệu"* ✅ ([HDF Group](https://www.hdfgroup.org/solutions/hdf5/)) | Gián tiếp (netCDF-4 xây trên HDF5) ✅ |
| **Zarr** | **Zarr V2.0 là OGC Community Standard, phê duyệt 06/2022, OGC Doc 21-050r1**, định nghĩa *"lưu trữ mảng đa chiều (còn gọi là data cube, mảng N chiều, tensor)"* qua metadata JSON + chunk nhị phân nén, trên filesystem hoặc object store kiểu S3 ✅ ([OGC](https://www.ogc.org/standards/zarr-storage-specification/)) | ✅ ngày càng tốt |
| **GeoZarr** | Đã có **OGC Standards Working Group** để định nghĩa *"một encoding Zarr cho dữ liệu lưới địa không gian"*. **Trạng thái: đang phát triển, CHƯA phải chuẩn OGC đã phê chuẩn** ✅ ([thông báo OGC](https://www.ogc.org/announcement/ogc-forms-new-geozarr-standards-working-group-to-establish-a-zarr-encoding-for-geospatial-data/)) | đang hình thành |
| **CoverageJSON** | **OGC Community Standard v1.0, phê duyệt 12/12/2022, xuất bản 22/08/2023.** Kiểu miền gồm **Grid với trục x, y, z và t**, cùng VerticalProfile, Point, Trajectory, Section… Thiết kế *"để hỗ trợ phát triển các website trực quan tương tác hiển thị và thao tác dữ liệu môi trường trong trình duyệt"* ✅ ([OGC 21-069r2](https://docs.ogc.org/cs/21-069r2/21-069r2.html)) | ✅ (web-native) |
| **VTK XML** | `.vti` ImageData = lưới đều có cấu trúc; `.vtr` rectilinear; `.vts` curvilinear; `.vtu` unstructured. **`.vti` là container đúng cho lưới voxel đều** ✅ | ❌ QGIS/ArcGIS; ✅ ParaView/PyVista |
| **OpenVDB `.vdb`** | Lưới phân cấp thưa, xem §11.3 ✅ | ❌ không có reader GIS |
| **ESRI voxel layer** | Voxel layer *"dựa trên dữ liệu thể tích lưu trong **file netCDF**"*. Chỉ chấp nhận **netCDF tuân thủ CF, không có biến phụ trợ**; khối phải **lưới đều**, thứ tự chiều **x,y,z,t hoặc t,z,y,x**; hệ toạ độ đứng phải có thuộc tính `positive` ✅ ([Esri](https://pro.arcgis.com/en/pro-app/latest/help/mapping/layer-properties/supported-voxel-formats.htm)) | ✅ chỉ ArcGIS Pro |

📐 **GeoTIFF nhiều band KHÔNG phải trường 3D thực sự:** nó không có biến toạ độ đứng, không có thuộc tính `positive`, không có ngữ nghĩa toạ độ đứng CF — chỉ số band chỉ là một số nguyên. Đó là **một chồng lớp 2D**, không phải trường 3D có tham chiếu địa lý. Dùng netCDF/Zarr cho trường; chỉ xuất GeoTIFF cho từng lát cắt ngang.

⭐ **Khuyến nghị định dạng:** tính bằng NumPy/xarray → **lưu trữ ở netCDF-4 tuân thủ CF** (chạy được ở ArcGIS Pro, Panoply, QGIS mesh, Python) → mirror sang **Zarr** nếu lên cloud/dask → xuất **`.vti`** cho ParaView/PyVista → **CoverageJSON hoặc 3D Tiles** cho web viewer.

### 11.5 Ngăn xếp Python

| Thư viện | Đóng góp đã xác thực | Link |
|---|---|---|
| **NumPy** | Nguyên thuỷ mảng 3D dày đặc | — |
| **xarray** ⭐ | Thêm *"nhãn dưới dạng chiều, toạ độ và thuộc tính"*, cho phép `x.sum('time')`, chọn theo nhãn, broadcast theo tên, groupby, align. Mô hình dữ liệu *"vay mượn từ định dạng netCDF, cũng cung cấp cho xarray một định dạng tuần tự hoá tự nhiên và khả chuyển"* ✅ | [docs](https://docs.xarray.dev/en/stable/getting-started-guide/why-xarray.html) |
| **xarray + dask** | *"Thao tác xarray trên mảng dask là **lười biếng**… được xếp hàng thành các task trong đồ thị Dask"*; `chunks={"time": 10}`, `xr.open_mfdataset('*.nc', parallel=True)` ✅ | [dask guide](https://docs.xarray.dev/en/stable/user-guide/dask.html) |
| **rioxarray** | *"phần mở rộng rasterio cho xarray"*: accessor `rio`, quản lý CRS, reproject, clip, xuất raster. Apache-2.0 ✅ | [readme](https://corteva.github.io/rioxarray/stable/readme.html) |
| **scipy.ndimage** ⭐ | *"các hàm xử lý ảnh **đa chiều**"* — filters, interpolation, measurements, morphology. Chạy trên mảng N-D kể cả 3D: `gaussian_filter`, `binary_dilation`, `binary_fill_holes`, `distance_transform_edt`, `label`, `zoom` ✅ | [docs](https://docs.scipy.org/doc/scipy/reference/ndimage.html) |
| **scipy.interpolate.RBFInterpolator** | *"Nội suy hàm cơ sở bán kính trong N ≥ 1 chiều."* Kernel: linear, thin_plate_spline (mặc định), cubic, quintic, multiquadric… `smoothing=0` ⇒ *"nội suy khớp hoàn hảo dữ liệu"*; `neighbors=k` cần thiết khi trên ~1000 điểm ✅ | [docs](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.RBFInterpolator.html) |
| **netCDF4** | Giao diện Python cho thư viện netCDF C; groups, nhiều chiều unlimited, nén zlib/szip, chunksize HDF5 tuỳ chiều ✅ | [docs](https://unidata.github.io/netcdf4-python/) |
| **scikit-image** | `marching_cubes` — xem §12 ✅ | [docs](https://scikit-image.org/docs/stable/api/skimage.measure.html) |
| **PyVista / VTK** | Mô hình dữ liệu VTK và `.vti`; có ví dụ *"Voxelize a Surface Mesh"*. ⚠️ **Trang API `voxelize` không render được trên 4 URL đã thử** — chữ ký hàm, tham số `density`/`check_surface` chưa xác thực. Kiểm tra cục bộ bằng `help(pv.DataSetFilters.voxelize)` | [docs](https://docs.pyvista.org/api/core/_autosummary/pyvista.datasetfilters.voxelize) |
| **pyopenvdb** | Module Python của OpenVDB, phơi *"hầu hết chức năng của lớp Grid trong C++"*: I/O `.vdb`, metadata, đọc/ghi voxel, lặp, `copyFromArray`/`copyToArray` để interop với NumPy ✅ | [docs](https://www.openvdb.org/documentation/doxygen/python.html) |
| **PyKrige** | `OrdinaryKriging3D`, `UniversalKriging3D` (hỗ trợ *"số hạng drift tuyến tính theo vùng trong cả ba chiều không gian"*) ✅ | [docs](https://geostat-framework.readthedocs.io/projects/pykrige/en/stable/) |
| **GSTools** | *"ước lượng và khớp variogram (tự động)"*, variogram có hướng, kriging simple/ordinary/universal/external-drift, trường có điều kiện; có ví dụ 3D sinh *"trường có cấu trúc kích thước 100×100×100"* với length scale bất đẳng hướng ✅ | [docs](https://geostat-framework.readthedocs.io/projects/gstools/en/stable/) |

---

## 12. Dựng "thành phố voxel" — phần hình học

### 12.1 Voxel hoá mô hình 3D thành phố

| Công cụ | Điều đã xác thực | Cảnh báo |
|---|---|---|
| **trimesh** | `trimesh.voxel.creation.voxelize()` với `method` nhận **`'subdivide'`, `'ray'`, `'binvox'`**. `local_voxelize()` *"voxel hoá một mesh trong vùng một khối lập phương quanh một điểm"* — *"giảm chi phí bộ nhớ so với voxel hoá toàn cục"* ✅ ([docs](https://trimesh.org/trimesh.voxel.creation.html)) | `'ray'` cho khối đặc |
| **Open3D** | `VoxelGrid.create_from_triangle_mesh()`: *"Mọi voxel bị tam giác cắt qua được đặt bằng `1`, các voxel khác bằng `0`"* — tức là **vỏ mặt, KHÔNG phải khối đặc**. Có `carve_depth_map`/`carve_silhouette` để *"tạo lưới voxel đã lấp đầy biểu diễn phần bên trong vật thể"* ✅ ([tutorial](https://www.open3d.org/docs/release/tutorial/geometry/voxelization.html)) | 🔴 **Hệ quả then chốt cho phát tán:** vỏ rỗng nghĩa là **không khí chui qua tường được**. Phải lấp bằng `scipy.ndimage.binary_fill_holes`, hoặc dùng `'ray'` của trimesh, hoặc bỏ mesh hẳn và dùng cách raster-extrude dưới đây |
| ⭐ **rasterio + NumPy (extrude LoD1)** | 📐 **Cách nhóm nên dùng**: raster hoá polygon footprint thành raster chiều cao 2D `H[y,x]` ở bước lưới Δ, rồi broadcast với vector trục z: `solid = Z[:,None,None] < H[None,:,:]`. Một biểu thức NumPy, tái lập chính xác, tránh mọi vấn đề watertight của mesh. Bằng chứng đây là ngữ nghĩa extrude chuẩn: 3DBAG tạo LoD1.2/1.3 bằng *"lấy polygon 2D và extrude mỗi cái tới một trong các giá trị chiều cao của nó"*, dùng *"chiều cao mái phân vị 70"* ✅ ([3DBAG](https://docs.3dbag.nl/en/schema/layers/)) | Đơn giản và bền nhất |
| **PyVista** | Có ví dụ "Voxelize a Surface Mesh" ✅ | ⚠️ chi tiết API chưa xác thực |
| ⭐ **VoxCity** | *"biến dữ liệu địa không gian mở thành một mô hình voxel 3D sẵn sàng mô phỏng của bất kỳ nơi nào trên Trái Đất — trong vài dòng Python"*. Tích hợp nhà (OSM, Microsoft, Open Buildings 2.5D, EUBUCCO, UT-GLOBUS, Overture), bản đồ chiều cao tán cây, lớp phủ (ESA WorldCover, ESRI, Dynamic World, OSM) và địa hình (FABDEM, DeltaDTM, USGS 3DEP) thành **một mô hình voxel tích hợp** với 14 lớp phủ ✅ ([GitHub](https://github.com/kunifujiwara/VoxCity) · [Fujiwara et al., *Comput. Environ. Urban Syst.* 123, 102366](https://doi.org/10.1016/j.compenvurbsys.2025.102366) · [arXiv:2504.13934](https://arxiv.org/pdf/2504.13934)) | ⚠️ Các mô phỏng được tài liệu hoá là **bức xạ/tầm nhìn, KHÔNG phải phát tán** — nhóm phải tự cung cấp mô hình vận chuyển |

**Tiền lệ trực tiếp nhất:** ⚠️ *A Pilot Study on a GPU-Accelerated Voxel Simulation Framework for 3D Indoor and Urban-Scale Gas Dispersion and Aerosol Transport*, **ISPRS IJGI 15(9):405** ([DOI 10.3390/ijgi15090405](https://www.mdpi.com/2220-9964/15/9/405)) — biểu diễn voxel có cấu trúc suy ra từ BIM/LiDAR/GIS, mô phỏng lấy cảm hứng CFD ở độ phân giải dưới mét đến mét. **MDPI trả 403; tiêu đề/DOI từ chỉ mục tìm kiếm, nội dung CHƯA xác thực. Đây gần như chắc chắn là công trình gần đề tài nhất và rất mới — nhóm phải tự lấy về.**

### 12.2 CityGML / CityJSON và mức chi tiết (LoD) nào là đủ

**CityGML 3.0 là bản hiện hành** ✅ ([OGC](https://www.ogc.org/standards/citygml/)); khác với 1.0/2.0 vốn chuẩn hoá một định dạng trao đổi GML, bản 3.0 *"chuẩn hoá mô hình thông tin nền tảng"*, có thể cài đặt bằng GML, JSON hoặc lược đồ CSDL. Văn bản quy chuẩn: [Part 1 Conceptual Model (20-010)](https://docs.ogc.org/is/20-010/20-010.html) · [Part 2 GML Encoding (21-006r2)](https://docs.ogc.org/is/21-006r2/21-006r2.html) · [Users Guide (20-066)](https://docs.ogc.org/guides/20-066.html) · [CityGML 2.0 (12-019)](https://docs.ogc.org/is/12-019/12-019/pdf).

**LoD trong 3.0** ✅ (Users Guide): định nghĩa **LoD 0–3** và cho phép *"nhiều mức chi tiết đồng thời"*:
- **LoD0** — tổng quan toàn thành phố / địa hình
- ⭐ **LoD1** — *"biểu diễn toà nhà đơn giản hoá thành các khối chữ nhật xác định bởi footprint và chiều cao"*
- **LoD2** — thêm cấu trúc mái phân biệt và texture tường
- **LoD3** — thêm chi tiết kiến trúc: cửa sổ, cửa đi, texture bề mặt mịn

⚠️ **Không có nguồn nào giải thích vì sao LoD4 bị bỏ** — đừng khẳng định lý do.

**CityJSON** — *"định dạng trao đổi dữ liệu cho mô hình 3D số của thành phố và cảnh quan"*, JSON thay vì GML, *"tỉ lệ nén file khoảng 6:1"*; **v2.0 cài đặt một phần mô hình dữ liệu OGC CityGML v3.0** ✅ ([specs](https://www.cityjson.org/specs/2.0.1/)).

**LoD nào cần cho phát tán?** Câu trả lời peer-reviewed: ✅ García-Sánchez, Vitalis, Paden & Stoter (2021), *The impact of level of detail in 3D city models for CFD-based wind flow simulations*, ISPRS Archives XLVI-4/W4-2021, 67–72 ([DOI 10.5194/isprs-archives-XLVI-4-W4-2021-67-2021](https://isprs-archives.copernicus.org/articles/XLVI-4-W4-2021/67/2021/)) — *"khác biệt về hình học và tính chất bề mặt ảnh hưởng tới điều kiện gió cục bộ"*, thử nghiệm tại lối đi khuôn viên TU Delft, kết luận rằng hình học đơn giản hoá quá mức trong CFD biểu diễn sai hành vi gió đô thị. ⚠️ Trang abstract không cho các chênh lệch số theo từng LoD; bảng so sánh nằm trong PDF.

📐 **Nhận định của nhóm:** với mô hình **voxel ở ô 5–10 m**, **LoD1 (footprint + chiều cao) là lựa chọn nhất quán**, vì kích thước voxel **lớn hơn** khác biệt hình học giữa mái LoD1 và LoD2 — một mái dốc đơn giản là không sống sót qua phép rời rạc 5 m. LoD2 chỉ bắt đầu có giá trị khi Δ ≤ 1–2 m. **Dùng bài García-Sánchez để nêu rõ hạn chế này thay vì lờ đi** — và đối chiếu với Ridzuan et al. 2024 (§11.1) vốn dùng LoD1 cho tiếng ồn, LoD2 cho gió.

### 12.3 Lấy chiều cao toà nhà ở đâu (và cạm bẫy cho Việt Nam)

| Nguồn | Sự thật đã xác thực | Việt Nam? |
|---|---|---|
| **OSM `building:levels`** | *"số tầng trên mặt đất trong mặt đứng toà nhà (không tính tầng mái và tầng hầm)"*. Khác với `height` (mét) — *"height bao gồm mái, building:levels thì không"*. Quy đổi thông dụng: *"kích thước thường là **3 mét** cho mỗi tầng"* ✅ ([OSM wiki](https://wiki.openstreetmap.org/wiki/Key%3Abuilding%3Alevels)) | ⚠️ Mật độ gắn thẻ ở Hà Nội/TP.HCM **CHƯA xác thực** (API taginfo bị reset kết nối). **Tự chạy truy vấn Overpass đếm `building` vs `building["building:levels"]` trong bbox Hà Nội — đây là việc tuần 1** |
| **Google Open Buildings v3** | 1,8 tỉ công trình (05/2023) trên 58 triệu km²; thuộc tính = polygon (WKT), **điểm tin cậy**, Plus Code, diện tích. **"không bao gồm chiều cao toà nhà"**, loại hay địa chỉ. Song giấy phép **CC BY 4.0 hoặc ODbL 1.0** (tự chọn) ✅ ([trang Google](https://sites.research.google/gr/open-buildings/)) | ✅ Phủ Đông Nam Á, **có Việt Nam** — nhưng **không có chiều cao** |
| ⭐ **Google Open Buildings 2.5D Temporal** | Cung cấp **building presence, fractional building counts VÀ building height**. Raster 0,5 m nhưng **độ phân giải hiệu dụng 4 m**, dẫn xuất từ **Sentinel-2**. Hằng năm **2016–2023**, ảnh chụp ~30/6 mỗi năm. Chiều cao **tương đối so với mặt đất, chặn trần 100 m**. CC BY 4.0 / ODbL 1.0; truy cập qua Earth Engine ImageCollection hoặc Google Cloud Storage ✅ ([trang temporal](https://sites.research.google/gr/open-buildings/temporal/) · [GEE catalog](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1)) | ✅ **Việt Nam được liệt kê tường minh** (cùng Thái Lan, Campuchia, Lào, Indonesia, Philippines, Malaysia, Brunei, Singapore). 🔴 **MAE chiều cao 1,5 m — NHƯNG "đánh giá này chỉ giới hạn ở Bắc Mỹ, châu Âu và Nhật Bản — không phải ở Global South nơi bộ dữ liệu được triển khai"** ✅. **Phải trích nguyên văn cảnh báo này** |
| **Microsoft GlobalMLBuildingFootprints** | 1,4 tỉ công trình từ ảnh Bing 2014–2024; **~174 triệu footprint có thuộc tính chiều cao (mét), `-1` khi không ước lượng được**. Giấy phép **CDLA Permissive 2.0** ✅ ([GitHub](https://github.com/microsoft/GlobalMLBuildingFootprints)) | ⚠️ Vùng phủ **chiều cao** được nêu là Bắc Mỹ, Tây Âu và một số vùng chọn lọc (Bỉ, Hà Lan, Đức, Mỹ, Na Uy). **Việt Nam không nằm trong danh sách có chiều cao** — có lẽ không, nhưng chưa xác nhận dứt khoát |
| **Overture Maps buildings** | Hai kiểu feature: `building` và `building_part`; có thuộc tính **height** và số tầng; loại bỏ công trình cao ≥ 900 m. Ưu tiên nguồn: OSM > Esri Community Maps > dữ liệu chính phủ > roofprint ML. Giấy phép **ODbL** ✅ ([docs](https://docs.overturemaps.org/guides/buildings/)) | 🔴 **Hạn chế do chính Overture nêu: "nhiều toà nhà đến từ nguồn ML với độ chính xác thấp hơn, đặc biệt ảnh hưởng tới vùng phủ ở Global South."** Chiều cao là **kế thừa** — sẽ thưa ở Việt Nam |
| **GlobalBuildingAtlas (2025)** | ~2,75 tỉ công trình; *"bộ dữ liệu mở đầu tiên cung cấp dữ liệu toà nhà chất lượng cao, nhất quán và đầy đủ ở dạng 2D và 3D ở cấp từng toà nhà trên quy mô toàn cầu"*. Thành phần: `GBA.Polygon`, **`GBA.Height` ở độ phân giải 3 m**, `GBA.LoD1`. **RMSE chiều cao 1,5–8,9 m tuỳ châu lục**; 97% công trình có dự báo chiều cao ✅ ([Zhu et al. 2025, ESSD 17, 6647–6668](https://essd.copernicus.org/articles/17/6647/2025/)) | ✅ Toàn cầu. **Trích bảng RMSE theo châu lục cho châu Á** |

⭐ **Chiến lược cho Việt Nam (📐 của nhóm):** dùng **footprint OSM** (hình học thường tốt hơn ML ở trung tâm các đô thị Việt Nam) + **chiều cao từ Google Open Buildings 2.5D Temporal** (nguồn chiều cao duy nhất đã xác thực có phủ Việt Nam), ghép theo không gian, dùng `building:levels × ~3 m` ở nơi có gắn thẻ để **đối chứng chéo** với chiều cao ML. **Kèm một phân tích độ nhạy theo trường chiều cao** và **trích nguyên văn** hai cảnh báo (Google về Global South, Overture về độ chính xác Global South). 🔴 Nhà ống Việt Nam — hẹp, cao, san sát — là ca khó cho một sản phẩm suy từ Sentinel-2 ở độ phân giải hiệu dụng 4 m. **Nói thẳng điều này trong phần hạn chế.**

### 12.4 Địa hình (DEM)

| DEM | Sự thật đã xác thực |
|---|---|
| **Copernicus DEM GLO-30** | Là một **DSM** — *"biểu diễn bề mặt Trái Đất bao gồm nhà cửa, hạ tầng và thảm thực vật"*. 30 m, toàn cầu (~149 triệu km²), từ TanDEM-X 2011–2015. **Độ chính xác đứng: < 4 m tuyệt đối (90% LE); tương đối < 2 m với độ dốc ≤ 20%, < 4 m với dốc > 20%.** Giấy phép miễn phí, bắt buộc ghi nguồn DLR/Airbus/Copernicus. Truy cập qua Copernicus Browser, API, OData, object storage S3 ✅ ([COP-DEM](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) · [DOI 10.5270/ESA-c5d3d65](https://doi.org/10.5270/ESA-c5d3d65)) |
| **ALOS AW3D30 (JAXA)** | *"DSM toàn cầu với độ phân giải ngang xấp xỉ 30 mét"* (1 arcsec), gần toàn cầu tới ~82° vĩ; 23.993 tile 1°×1°; **Version 4.1** hiện hành. *"Có thể dùng miễn phí cho mọi mục đích thương mại và phi thương mại"*, cần đăng ký ✅ ([JAXA](https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/aw3d30_e.htm)) |
| **SRTM 30 m** | ⚠️ **KHÔNG xác thực được** — cả `lpdaac.usgs.gov` và trang chuyển hướng NASA Earthdata đều trả 403/301. Đường dễ nhất là Earth Engine (`USGS/SRTMGL1_003`). 📐 **Với đồ án phát tán, Copernicus GLO-30 thay thế SRTM tốt hơn** — mới hơn, độ chính xác đứng tốt hơn, không có void |

> ### 🔴 CẠM BẪY LỚN NHẤT TRONG PHẦN HÌNH HỌC
> **GLO-30 và AW3D30 đều là DSM — chúng ĐÃ chứa nhà cửa và cây cối** (bị làm nhoè ở 30 m). **Nếu extrude toà nhà lên trên một DSM, nhóm sẽ đếm nhà HAI LẦN.** Với công việc canopy đô thị, phải dùng một mô hình **bare-earth (DTM)** cộng lớp toà nhà riêng, hoặc chấp nhận DSM như một bề mặt gộp thô.
> Bằng chứng gián tiếp: đây chính là lý do VoxCity chọn nguồn địa hình là **FABDEM / DeltaDTM / DTM quốc gia** chứ không phải SRTM/COP-DEM ✅ ([VoxCity](https://github.com/kunifujiwara/VoxCity)).

---

## 13. Phân tích không gian 3D trên voxel

Đây là phần đáp ứng yêu cầu **"phân tích không gian"** của đề tài. Lưu ý: một số phép toán **không có định nghĩa chuẩn trong tài liệu GIS** — nhóm phải tự định nghĩa và nói rõ là tự định nghĩa.

### 13.1 Nội suy 3D từ dữ liệu cảm biến thưa

| Phương pháp | Khả năng đã xác thực | Nguồn |
|---|---|---|
| **Kriging 3D ordinary/universal** | PyKrige có `OrdinaryKriging3D` và `UniversalKriging3D` (hỗ trợ *"số hạng drift tuyến tính theo vùng trong cả ba chiều không gian"*) | ✅ [PyKrige](https://geostat-framework.readthedocs.io/projects/pykrige/en/stable/) |
| **Địa thống kê N-D dựa trên variogram** | GSTools: ước lượng và khớp variogram (tự động), variogram có hướng, kriging simple/ordinary/universal/external-drift, sinh trường có điều kiện; ví dụ 3D 100×100×100 với length scale bất đẳng hướng | ✅ [GSTools](https://geostat-framework.readthedocs.io/projects/gstools/en/stable/) |
| **RBF** | `scipy.interpolate.RBFInterpolator`, *"N ≥ 1 chiều"*, 8 kernel, `smoothing` (0 ⇒ nội suy chính xác), `neighbors=k` để tính cục bộ | ✅ [SciPy](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.RBFInterpolator.html) |
| **Empirical Bayesian Kriging 3D** (thương mại) | ArcGIS Geostatistical Analyst có công cụ **EBK 3D**; `GA Layer 3D To NetCDF` *"xuất một hoặc nhiều lớp địa thống kê 3D tạo bởi công cụ Empirical Bayesian Kriging 3D sang định dạng netCDF"*, và kết quả *"hiển thị dưới dạng voxel layer trong local scene"* | ✅ [Esri](https://doc.esri.com/en/arcgis-pro/latest/tool-reference/geostatistical-analyst/ga-layer-3d-to-netcdf.html) |
| **IDW 3D** | ❌ **KHÔNG có thư viện nào tài liệu hoá IDW 3D.** IDW là số học N chiều tầm thường — **tự cài bằng `scipy.spatial.cKDTree` + trọng số nghịch đảo khoảng cách, và nói rõ là tự cài** | — |

**Ràng buộc đã xác thực, cần nêu trong phần hạn chế:**
- RBF với `smoothing=0`: *"nội suy khớp hoàn hảo dữ liệu"* ✅ — tức là **tái tạo chính xác cả nhiễu của cảm biến giá rẻ**, điều này sai về mặt phương pháp. Phải dùng smoothing khác 0.
- 📐 Kriging cần một variogram. **Không thể khớp tin cậy một variogram 3D — huống hồ variogram bất đẳng hướng có tầm đứng riêng — từ vài cảm biến.** Trường ô nhiễm đô thị bất đẳng hướng rất mạnh theo phương đứng. Với < 30 điểm, variogram khớp được về cơ bản là không bị ràng buộc.
- ⚠️ Phê phán IDW cho mô hình hoá ô nhiễm (tính tuỳ tiện của số mũ khoảng cách, vấn đề trạm ở khoảng cách 0): [*Atmos. Environ.*, S009830041200372X](https://www.sciencedirect.com/science/article/abs/pii/S009830041200372X) (snippet).
- ⚠️ Biểu diễn 3D ẩn cho bản đồ ô nhiễm độ phân giải cao thích ứng: [npj Clim. Atmos. Sci., DOI 10.1038/s41612-025-01044-6](https://www.nature.com/articles/s41612-025-01044-6) (Nature chuyển hướng xác thực).

> ⭐ **Nhắc lại kết luận ở §9.1 vì nó quan trọng:** nội suy là **baseline và công cụ kiểm định**, không phải mô hình. Xem phần khung cảnh ở đó.

### 13.2 Các phép toán phân tích trên voxel

| Phép toán | Công cụ / phát biểu đã xác thực | Trạng thái |
|---|---|---|
| ⭐ **Trích bề mặt đẳng trị (marching cubes)** | `skimage.measure.marching_cubes(volume, level=None, *, spacing=(1.,1.,1.), gradient_direction='descent', step_size=1, allow_degenerate=True, method='lewiner', mask=None)`. `level` = giá trị đường bao; trả về `verts (V,3)`, `faces (F,3)`, `normals (V,3)`, `values (V,)`. Mặc định `method='lewiner'` được ưa dùng vì *"giải quyết các trường hợp nhập nhằng và đảm bảo kết quả đúng về topology"*; tài liệu ghi nhận Lorensen & Cline, SIGGRAPH 87. **`spacing` là cách làm cho bề mặt đẳng trị đúng về mét khi voxel bất đẳng hướng (vd. 10 m × 10 m × 2 m)** | ✅ [scikit-image](https://scikit-image.org/docs/stable/api/skimage.measure.html) |
| **Bề mặt đẳng trị trong GIS desktop** | Voxel layer của ArcGIS Pro hỗ trợ khám phá dữ liệu dạng **volume, slice, section, isosurface** và animation theo thời gian | ✅ [Esri](https://doc.esri.com/en/arcgis-pro/latest/help/mapping/layer-properties/what-is-a-voxel-layer-.html) |
| **Trích profile đứng** | Tự nhiên với mảng có nhãn: xarray cho phép *"thao tác dùng tên chiều thay vì chỉ số"* → `ds.sel(x=..., y=..., method='nearest')` là một dòng | ✅ [xarray](https://docs.xarray.dev/en/stable/getting-started-guide/why-xarray.html) |
| **Hình thái học / khoảng cách / thành phần liên thông 3D** | `scipy.ndimage`: `binary_dilation`, `binary_fill_holes`, `distance_transform_edt`, `label`, `gaussian_filter`, `zoom` | ✅ [SciPy](https://docs.scipy.org/doc/scipy/reference/ndimage.html) |
| **Phân tích tầm nhìn 3D kiểu viewshed** | Aleksandrov et al. 2019 voxel hoá khối đô thị và ghi *"số lần mỗi voxel được quan sát… phân loại tiếp thành các vùng khác nhau"*, vượt khỏi viewshed một điểm nhìn để tới *"kịch bản động và tính toán thời gian thực về khả năng nhìn thấy không gian"* | ✅ [DOI 10.5194/isprs-annals-IV-4-W8-11-2019](https://isprs-annals.copernicus.org/articles/IV-4-W8/11/2019/) |
| **Overlay trong miền voxel** | Gorte et al. 2024: chuyển vector → voxel, *"trộn các lớp voxel qua các phép overlay chuyên biệt"*, rồi chuyển kết quả ra point cloud / Scene Services | ✅ [DOI 10.5194/isprs-annals-X-4-2024-133-2024](https://isprs-annals.copernicus.org/articles/X-4-2024/133/2024/) |
| **Thống kê theo vùng 3D (3D zonal statistics)** | ❌ **KHÔNG tìm được tài liệu GIS hay chuẩn nào định nghĩa toán tử zonal statistics 3D.** Công cụ zonal của ArcGIS là công cụ raster 2D. **Tự cài dưới dạng tổng hợp theo mặt nạ boolean trên mảng 3D và mô tả nó là toán tử tự định nghĩa** | 📐 tự định nghĩa |
| **Thể tích vượt ngưỡng (exceedance volume)** | ❌ **KHÔNG có tài liệu tham chiếu chuẩn cho "exceedance volume" trong ngữ cảnh voxel chất lượng không khí.** Nhưng suy ra tầm thường và **nên trình bày như định nghĩa riêng của nhóm**: `V_exceed = (c > threshold).sum() × Δx·Δy·Δz`, có thể trọng số theo thời gian. **Neo NGƯỠNG vào QCVN/WHO, neo SỐ HỌC thể tích vào bước lưới voxel — đừng nhận là phương pháp có trong văn liệu** | 📐 tự định nghĩa |
| **Phơi nhiễm dân số / mặt đứng toà nhà** | Khái niệm trong văn liệu CFD là **building intake fraction** ⚠️ ([DOI 10.3390/ijerph19063524](https://dx.doi.org/10.3390/ijerph19063524), snippet). 📐 Thao tác cơ học: lấy mẫu trường nồng độ tại các voxel **kề với voxel bề mặt toà nhà** (tính bằng `scipy.ndimage.binary_dilation(solid) − solid`), rồi trọng số theo dân số từng tầng — nhưng **cách dựng này là của nhóm, không phải trích dẫn** | 📐 tự định nghĩa |

### 13.3 Danh mục phép phân tích không gian có thể đưa vào đồ án

📐 Gợi ý một bộ "sản phẩm phân tích" đủ phong phú để trả lời yêu cầu "phân tích không gian" của đề bài:

1. **Lát cắt ngang (horizontal slice)** ở z = 1,5 m (mực hô hấp người đi bộ), 6 m (tầng 2), 15 m, 30 m → chứng minh nồng độ thay đổi theo độ cao.
2. **Mặt cắt đứng (vertical section)** cắt ngang một hẻm phố → cho thấy xoáy tái tuần hoàn và chênh lệch leeward/windward.
3. **Profile đứng** tại vị trí trạm quan trắc → so sánh với CAMS EAC4 (§15.3).
4. **Bề mặt đẳng trị** tại ngưỡng QCVN 05:2023 (PM2.5 24h = 50 µg/m³) và ngưỡng WHO (15 µg/m³) → hai "bong bóng" lồng nhau, hình ảnh rất mạnh về mặt truyền thông.
5. **Thể tích vượt ngưỡng** (m³) theo giờ trong ngày → một đường cong duy nhất tóm tắt cả mô phỏng.
6. **Phơi nhiễm mặt đứng toà nhà** — nồng độ trung bình trên các voxel tiếp giáp tường, phân theo độ cao tầng.
7. **Phơi nhiễm dân số** — giao lưới voxel mực người đi bộ với raster dân số WorldPop 100 m (§15.6).
8. **Phân tích độ nhạy** — chạy lại với 3 hướng gió (gió mùa Đông Bắc, Đông Nam, lặng gió) và 2 độ phân giải (5 m, 10 m), báo cáo chênh lệch.
9. **So sánh mô hình** — cùng một miền, chạy Gaussian giải tích vs bộ giải voxel, bản đồ hiệu số.

---

## 14. Trực quan hoá 3D và phân phối trên web

### 14.1 CesiumJS + 3D Tiles

**3D Tiles** là **OGC Community Standard** *"để truyền phát và render nội dung địa không gian 3D khối lượng lớn như Photogrammetry, 3D Buildings, BIM/CAD, Instanced Features và Point Clouds"*. **Bản hiện hành 1.1 (OGC 22-025r4)** ✅ ([OGC](https://www.ogc.org/standards/3dtiles/)).

**Implicit tiling** (1.1): *"Implicit tiling định nghĩa một biểu diễn cô đọng của quadtree và octree trong 3D Tiles."* Chi tiết ở §11.3 ✅.

⭐ **Voxel trong 3D Tiles — extension `3DTILES_content_voxels`** ✅ ([nhánh `voxels` của CesiumGS](https://github.com/CesiumGS/3d-tiles/tree/voxels/extensions/3DTILES_content_voxels)):
- **Trạng thái: DRAFT**, và là extension **bắt buộc** (phải xuất hiện trong cả `extensionsUsed` và `extensionsRequired`).
- *"chỉ ra sự hiện diện của nội dung voxel"* để runtime *"cấp phát tài nguyên cần thiết trước khi tile nào được tải"*.
- `dimensions` cho kích thước lưới theo từng trục, *"các phần tử bố trí theo cơ sở liên tục theo trục thứ nhất"*; ý nghĩa trục do bounding volume quyết định: **box** → x,y,z; **region** → kinh độ, vĩ độ, độ cao; **cylinder** → bán kính, góc, độ cao.
- `padding` tuỳ chọn cho biết *"bao nhiêu hàng dữ liệu voxel theo mỗi chiều đến từ các lưới lân cận"*, *"hữu ích cho các hiệu ứng phi cục bộ như nội suy hay làm mờ"*.
- *"thường đi kèm với Implicit Tiling để biểu diễn hiệu quả các bộ dữ liệu voxel thưa khổng lồ"*; voxel *"được lưu dưới dạng glTF với extension **EXT_primitive_voxels**… thường đi kèm EXT_structural_metadata"*.

**`VoxelPrimitive` trong CesiumJS** ✅ ([API](https://cesium.com/learn/cesiumjs/ref-doc/VoxelPrimitive.html)): *"Một primitive render dữ liệu voxel từ một VoxelProvider"*, trực quan hoá bộ dữ liệu voxel 3D **thông qua ray-marching**, có thể tuỳ chỉnh step size, custom shader, clipping plane, bound động.
> 🔴 **Ghi rõ nguyên văn: "Tính năng này chưa hoàn thiện và có thể thay đổi mà không theo chính sách deprecation tiêu chuẩn của Cesium."**

**`Cesium3DTilesVoxelProvider`** ✅ ([API](https://cesium.com/learn/ion-sdk/ref-doc/Cesium3DTilesVoxelProvider.html)): tileset *"phải có metadata schema, implicit tiling, và root tile content với extension `3DTILES_content_voxels`"*. Hình dạng hỗ trợ: *"chỉ box, region và 3DTILES_bounding_volume_cylinder"*. Cũng đánh dấu experimental.

> 📐 **Đánh giá thực tế:** đường voxel trong CesiumJS là thật và có ray-marching, **nhưng nó experimental, nằm trên một nhánh extension draft, và đòi hỏi nhóm phải tự tạo tileset implicit-tiled với payload glTF voxel.** Với một đồ án có deadline, đây là **rủi ro cao**.
>
> ⭐ **Đường rủi ro thấp:** 3D Tiles cho toà nhà + **mesh bề mặt đẳng trị** (từ marching cubes, §13.2) xuất ra **glTF**, cộng với các lát cắt nồng độ 2D làm imagery. Thuyết phục về thị giác, đi theo chuẩn, không dùng extension draft.

### 14.2 deck.gl, three.js, MapLibre

**deck.gl** ✅ ([layer catalog](https://deck.gl/docs/api-reference/layers)):
- **GridCellLayer** render *"heatmap dựa trên lưới"*; **`extruded` mặc định `true`** và *"bật độ cao lưới"*; `cellSize` tính bằng mét (mặc định 1000), `elevationScale` nhân chiều cao, `getElevation` cấp chiều cao từng ô ✅ ([docs](https://deck.gl/docs/api-reference/layers/grid-cell-layer)). Tức là **thật sự 3D — cột, không phải lưới phẳng**.
- **PointCloudLayer** render *"point cloud với vị trí 3D, pháp tuyến và màu"*; `getPosition` nhận `[x,y,z]`, `getColor` nhận RGBA ✅ ([docs](https://deck.gl/docs/api-reference/layers/point-cloud-layer)).

> 📐 **deck.gl KHÔNG có layer volume rendering.** Biểu diễn trường nồng độ 3D trong deck.gl nghĩa là: (a) một GridCellLayer cho mỗi mực độ cao, có độ trong suốt; (b) một PointCloudLayer các tâm voxel tô màu theo nồng độ; hoặc (c) custom layer với shader ray-marching tự viết. **(a) và (b) là lựa chọn thực dụng cho đồ án.**

**three.js** — `Data3DTexture` là lớp cho dữ liệu texture thể tích 3D ✅ ([docs](https://threejs.org/docs/#api/en/textures/Data3DTexture)). ⚠️ Trang ví dụ `webgl2_materials_texture3d` không render được cho fetcher — tự kiểm tra tại [threejs.org/examples](https://threejs.org/examples/).

**MapLibre** — kiểu layer 3D là **`fill-extrusion`** — *"Một polygon được ép đùn (3D)"*. `fill-extrusion-height` là *"chiều cao ép đùn layer này"* tính bằng mét (mặc định 0, hỗ trợ data-driven styling); `fill-extrusion-base` là *"chiều cao ép đùn đáy của layer này"*, phải ≤ height ✅ ([style spec](https://maplibre.org/maplibre-style-spec/layers/)).

> ⭐ 📐 **Mẹo rất hữu ích:** `fill-extrusion` cộng `fill-extrusion-base` chính là nguyên thuỷ đúng để render **một lát cắt ngang (slab) của lớp voxel** (base = z_dưới, height = z_trên), tô màu theo nồng độ. **Xếp chồng vài slab có độ trong suốt là được một khung nhìn giả-thể tích đáng tin mà không cần viết shader nào** — phương án dự phòng tốt nếu Cesium voxel quá rắc rối.

### 14.3 Công cụ desktop

| Công cụ | Khả năng đã xác thực |
|---|---|
| **QGIS 3D map view** | Địa hình từ *"một phân cấp tile địa hình"*; vector 3D qua *"Enable 3D Renderer trong mục 3D View của layer properties"*; hỗ trợ point cloud và mesh, Eye Dome Lighting, ambient occlusion; animation, công cụ mặt cắt, bóng đổ, và **xuất ra định dạng 3D như OBJ để hậu xử lý trong Blender** ✅ ([QGIS docs](https://docs.qgis.org/latest/en/docs/user_manual/map_views/3d_map_view.html)). ⚠️ **Trang tài liệu đã đọc KHÔNG nhắc tới render thể tích/voxel** — coi như QGIS không có volume renderer gốc trừ khi tự kiểm chứng phiên bản đang dùng |
| **Qgis2threejs** | *"Plugin trực quan hoá bản đồ 3D và xuất web cho QGIS… chạy bằng three.js"*. Trực quan hoá DEM và dữ liệu vector 3D trong trình duyệt, sinh file để xuất bản web, và **xuất mô hình 3D dạng glTF** ⚠️ (tổng hợp từ các trang của chính plugin; readthedocs root 404 khi fetch trực tiếp) ([docs](https://qgis2threejs.readthedocs.io/en/latest/) · [repo](https://github.com/minorua/Qgis2threejs)) |
| **ArcGIS Pro voxel layer** | *"trực quan hoá thể tích 3D biểu diễn thông tin không gian và thời gian đa chiều"*. Đầu vào: **netCDF**. Khám phá: volume, slice, section, isosurface, animation thời gian; nhiều biến trong một layer ✅. 🔴 **Hạn chế: chỉ dùng trong local scene với hệ toạ độ khớp — "không khả dụng trên global scene hay bản đồ 2D"; "Voxel layer không được hỗ trợ với engine render Vulkan"; cần đủ bộ nhớ GPU** ✅ ([Esri](https://doc.esri.com/en/arcgis-pro/latest/help/mapping/layer-properties/what-is-a-voxel-layer-.html)) |
| **ArcGIS trên web** | ❌ **KHÔNG xác thực được.** Trang tham chiếu `esri-layers-VoxelLayer` trả nội dung rỗng, blog Esri 403. **Đừng khẳng định ArcGIS Maps SDK for JavaScript hỗ trợ voxel layer** |
| **ParaView** | Hỗ trợ **Volume representation**: *"Volume rendering tạo ảnh bằng cách truy vết một tia qua bộ dữ liệu và tích luỹ cường độ dựa trên hàm truyền màu và độ mờ"*. Chế độ **Smart** là mặc định, *"cố chọn chế độ volume rendering phù hợp với dữ liệu và thiết lập đồ hoạ"*; tuỳ chọn **Shade** theo gradient ✅ ([ParaView docs](https://docs.paraview.org/en/latest/UsersGuide/displayingData.html)) |
| **Blender** | ⚠️ Chỉ xác thực gián tiếp: QGIS nêu Blender là đích hậu xử lý cho OBJ export ✅. **Không kiểm tra tài liệu Blender** — không khẳng định gì về import OpenVDB hay shader thể tích |

### 14.4 Kỹ thuật volume rendering và giới hạn trình duyệt

**Cơ chế.** Volume ray casting: *"các điểm lấy mẫu cách đều được chọn"* dọc mỗi tia nhìn; vì khối hiếm khi thẳng hàng với tia, việc lấy mẫu cần nội suy, *"thường là nội suy tam tuyến (trilinear)"*; tại mỗi mẫu *"một hàm truyền lấy ra màu RGBA của vật liệu"* cộng gradient để chiếu sáng; các mẫu sau đó được hợp thành, quá trình *"tương tự việc chồng các tấm acetate trên máy chiếu overhead"* ⚠️ ([Wikipedia: Volume ray casting](https://en.wikipedia.org/wiki/Volume_ray_casting) — **nguồn cấp ba; dùng để hiểu cơ chế, KHÔNG dùng làm trích dẫn luận văn**).

⭐ **Khả năng của trình duyệt — sự thật cho phép mọi thứ.** WebGL 2.0 bổ sung `TEXTURE_3D` như một texture binding target bên cạnh `TEXTURE_2D`, `TEXTURE_2D_ARRAY`, `TEXTURE_CUBE_MAP`, cùng `texImage3D`/`texSubImage3D`/`texStorage3D`, `framebufferTextureLayer()`, multiple render targets qua `drawBuffers()`, và điều khiển LOD `TEXTURE_BASE_LEVEL`/`TEXTURE_MAX_LEVEL` ✅ ([Khronos WebGL 2.0 spec](https://registry.khronos.org/webgl/specs/latest/2.0/)).
> **Nghĩa là: ray marching một-pass qua một texture 3D thật CHỈ khả thi trên WebGL 2. WebGL 1 phải dùng thủ thuật texture atlas 2D.**

📐 **Bề mặt đẳng trị vs khối bán trong suốt** (bảng suy luận, nhưng dựa trên các cơ chế đã có nguồn):

| | Isosurface (marching cubes) | Khối bán trong suốt (ray march) |
|---|---|---|
| Kết quả | Một mesh tam giác — glTF, OBJ, 3D Tiles | Một tích phân trong không gian màn hình, không có hình học |
| Chi phí | Trích xuất CPU một lần; render rẻ, tỉ lệ theo **diện tích bề mặt** | Theo từng pixel, từng frame, tỉ lệ theo **số bước × số pixel màn hình** |
| Độ trung thực | Chỉ hiện **một** ngưỡng; cấu trúc bên trong vô hình | Hiện cả trường và gradient |
| Phân phối web | Mọi viewer 3D, mọi thiết bị | Cần WebGL 2, GPU khá, viewer hỗ trợ volume |

📐 **Giới hạn hiệu năng (suy luận, gắn cờ rõ):** các đòn bẩy có nguồn là **step size** (CesiumJS phơi ra làm núm điều chỉnh chất lượng/hiệu năng) và **kích thước texture 3D**. Một texture 3D `256³` float32 là **64 MB VRAM**; `512³` là **512 MB** — cái sau không an toàn trên di động. Giảm về `Uint8` chuẩn hoá và giữ ở mức ≤ `256³` mỗi tile. ⚠️ **Không tìm được nguồn chính thức nào nêu một giới hạn số cụ thể của trình duyệt — đừng trích một con số; hãy tự benchmark trên phần cứng đích và báo cáo số của chính nhóm.**

⭐ **Khuyến nghị trực quan hoá (📐):** trích bề mặt đẳng trị tại các ngưỡng quy chuẩn bằng `skimage.measure.marching_cubes` (nhớ truyền `spacing` cho voxel bất đẳng hướng), xuất glTF, render cùng 3D Tiles toà nhà. Sau đó thêm **một** khung nhìn khối bán trong suốt làm sản phẩm "nâng cao", để đồ án vẫn giao được nếu volume renderer trục trặc.

---

# PHẦN III — DỮ LIỆU, KIỂM ĐỊNH VÀ TIỀN LỆ

## 15. Nguồn dữ liệu (trọng tâm Việt Nam)

> **Cách đọc:** mọi mục dưới đây đã được fetch trực tiếp trang của nhà cung cấp, trừ nơi có gắn ⚠️/🔴.

### 15.1 Quan trắc chất lượng không khí

| Nguồn | Chi tiết đã xác thực | Đánh giá |
|---|---|---|
| ⭐ **OpenAQ API v3** | Base `https://api.openaq.org/v3/`; auth header `X-API-Key`, key lấy tại [explore.openaq.org](https://explore.openaq.org); **rate limit 60 req/phút, 2.000/giờ** (tier miễn phí); **giấy phép theo TỪNG NGUỒN**, mỗi location mang một object `license` với cờ `attributionRequired`, thương mại, share-alike ✅ ([quick start](https://docs.openaq.org/using-the-api/quick-start) · [rate limits](https://docs.openaq.org/using-the-api/rate-limits) · [licenses](https://docs.openaq.org/resources/licenses)) | ⭐ Điểm khởi đầu tốt nhất. Quy trình: `GET /v3/locations?coordinates=21.0285,105.8542&radius=25000` → lấy `sensors[].id` → `GET /v3/sensors/{id}/measurements/hourly`. 🔴 **Danh sách trạm Việt Nam CHƯA xác thực** (`/v3/countries` trả **401** khi không có key). **Chạy `?iso=VN` với key là VIỆC SỐ 1 của tuần 1 — đừng giả định số trạm** |
| ⭐ **US Embassy Hanoi / Consulate HCMC (AirNow)** | Cổng đúng là bản đồ EPA tại **[gispub.epa.gov/airnowembassy](https://gispub.epa.gov/airnowembassy/)** ✅, nêu rõ: máy đo **cấp tham chiếu (reference-grade)** tại đại sứ quán/lãnh sự quán Mỹ, PM2.5 ở mọi nơi cộng ozone ở 10+ điểm, NowCast AQI, và **"Tải dữ liệu lịch sử ở tab 'Archive'"**. ⚠️ Trang `airnow.gov/international/...` trả **404** — dùng URL gispub | ⭐⭐ **Đây là chuỗi kiểm định tốt nhất**, vì mạng cảm biến giá rẻ không đủ tư cách làm ground truth. ⚠️ Bản đồ render bằng JS nên chưa xác nhận trực tiếp được pin Hà Nội/TP.HCM |
| **moitruongthudo.vn** (cổng Hà Nội) | ✅ Đang hoạt động; báo cáo SO₂, CO, NO₂, O₃, TSP, PM₁₀, PM₂.₅ (µg/m³) với AQI theo giờ và biểu đồ từng chất; có trạm *46 Lưu Quang Vũ*, khu *Nhân Chính / Khuất Duy Tiến*. **Không có nút tải, không có API tài liệu hoá, không nêu kho lịch sử** | 📐 Cách khả dĩ: scrape JSON mà biểu đồ gọi, **và nói rõ trong báo cáo là đã làm vậy** |
| **CEM (cem.gov.vn)** | ✅ Vận hành mạng quan trắc quốc gia; trỏ tiếp tới **tedp.vn** (công bố AQI theo giờ), **envisoft.gov.vn**, và dự báo tại `dubao.envisoft.gov.vn:8000/airforecast/`. ⚠️ Các endpoint con chưa fetch riêng — coi là manh mối |
| **IQAir / AirVisual API** | Gói **Community** miễn phí: **5 call/phút, 500/ngày, 10.000/tháng**; phạm vi **chỉ cấp thành phố**, AQI Mỹ & Trung Quốc ✅ ([pricing](https://www.iqair.com/air-pollution-data-api)) | ⚠️ Trang không nêu có được phép công bố học thuật hay không; `iqair.com/dashboard/api` trả **404**. Chỉ cấp thành phố ⇒ **không dùng kiểm định mô hình phân giải không gian** — chỉ để sanity check |
| **PAM Air (Việt Nam, ~400 thiết bị / 63 tỉnh)** | ✅ [pamair.org](https://pamair.org/en/home/) · [mạng lưới](https://pamair.org/en/service/air-quality-monitoring-network/) · [API](https://pamair.org/en/service/api-service/) | 🔴 **Trang API mô tả tích hợp đối tác/thương mại, KHÔNG có tài liệu kỹ thuật, KHÔNG có giá, KHÔNG có đăng ký tự phục vụ** — chỉ có hotline và `contact@dlcorp.com.vn`. Coi là "gửi email hỏi sớm", không phải dữ liệu lấy được. **Nhưng đây là mạng dày nhất Việt Nam — đáng gửi 1 email trong tuần 1** |
| **PurpleAir** | ✅ [api.purpleair.com](https://api.purpleair.com/), key tại [develop.purpleair.com](https://develop.purpleair.com). **Không miễn phí vĩnh viễn**: tài khoản mới được cấp một lượng "points" miễn phí rồi phải **mua thêm** | ⚠️ Mật độ ở Việt Nam có thể rất thưa — kiểm tra bản đồ trước |
| **Sensor.Community** | ✅ API `api.sensor.community`, **archive `archive.sensor.community` (dump CSV hằng ngày — tốt nhất cho đồ án)**, map, device registry. **Giấy phép: nội dung CSDL theo Open Data Commons DbCL 1.0; firmware GPL-3.0** | ⚠️ Vùng phủ Việt Nam/châu Á **chưa xác thực** |

### 15.2 Vệ tinh — và một cạm bẫy phải tránh

| Nguồn | Chi tiết đã xác thực |
|---|---|
| **Sentinel-5P TROPOMI** | ✅ Qua [Copernicus Data Space](https://dataspace.copernicus.eu/explore-data/data-collections/sentinel-data/sentinel-5p): L2 **NO₂, SO₂, CO, aerosol index** (cùng O₃, CH₄, HCHO, mây), NRT và NTC, miễn phí, cần tài khoản. Đặc trưng nhiệm vụ: **swath 2.600 km, lấy mẫu không gian 7 × 7 km², chu kỳ 16 ngày, 14 quỹ đạo/ngày** ✅ ([SentiWiki](https://sentiwiki.copernicus.eu/web/s5p-mission)). ⚠️ Con số 5,5 × 3,5 km² sau 08/2019 hay được trích **KHÔNG xác nhận được** trên trang đã đọc |
| **Google Earth Engine (đường dễ nhất)** | ✅ [COPERNICUS/S5P/OFFL/L3_NO2](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_NO2): lưới hoá về pixel **1.113,2 m**, **28/06/2018 → nay**, tái thăm ~2 ngày, band gồm `tropospheric_NO2_column_number_density`, `absorbing_aerosol_index`, `cloud_fraction` |
| **MODIS MAIAC AOD (MCD19A2)** | ✅ **1 km, hằng ngày, Collection 6.1, Terra+Aqua gộp** ([LAADS](https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/MCD19A2)); cần Earthdata Login để tải hàng loạt |

> ### 🔴 CẠM BẪY VỆ TINH — mỗi năm đều có sinh viên mắc
> Trang GEE xác nhận sản phẩm NO₂ cung cấp **cột đứng tầng đối lưu** (phân tử trên đơn vị diện tích, mol/m²) — tức là **tích phân xuyên toàn bộ tầng đối lưu** ✅.
> **Đó KHÔNG phải nồng độ bề mặt và KHÔNG so sánh trực tiếp được với số đo µg/m³ ở mặt đất, cũng không so được với lớp bề mặt của mô hình voxel.**
> Với AOD cũng vậy — đó là đại lượng **quang học tích phân theo cột**, không phải nồng độ khối lượng. Quy đổi AOD → PM2.5 cần (a) tỉ lệ theo chiều cao lớp biên, (b) hiệu chỉnh hút ẩm theo độ ẩm tương đối, (c) giả định profile đứng của aerosol — mỗi thứ là một nguồn sai số lớn.
> **Với đồ án: dùng dữ liệu vệ tinh cho MẪU HÌNH KHÔNG GIAN và nhận diện điểm nóng, KHÔNG dùng để kiểm định tuyệt đối.** ⚠️ Về quan hệ AOD→PM2.5, tự tra "Van Donkelaar satellite-derived PM2.5" và trích bài gốc.

### 15.3 ⭐ Tái phân tích có cấu trúc đứng thật — câu hỏi then chốt của mô hình voxel

**CAMS EAC4 — CÓ, đây là 3D thật** ✅ ([ADS](https://ads.atmosphere.copernicus.eu/datasets/cams-global-reanalysis-eac4)):
- ECMWF Atmospheric Composition Reanalysis 4, **2003–2025**
- **0,75° × 0,75°, 3 giờ một lần**
- ⭐ **60 mực mô hình**, cộng mực áp suất 1000→1 hPa, cộng trường bề mặt và cột tổng
- **> 200 biến**: CO, CH₄, O₃, NOₓ, OH, và aerosol phân loài (bụi, muối biển, sulphate, black carbon, hữu cơ), cùng khí tượng
- **Giấy phép CC-BY**, cần tài khoản ADS + CDS API key

> 📐 **Kết luận cho mô hình voxel:** EAC4 cho nồng độ **trên các mực mô hình**, nên **có thể kiểm định cấu trúc đứng** — nhưng ở **0,75° (~80 km)** cả một thành phố chỉ là một hai ô lưới. **Nó kiểm định HÌNH DẠNG của profile đứng, không kiểm định cấu trúc ngang.** Vẫn đáng làm, và là một đóng góp bảo vệ được.

**CAMS European air quality reanalysis** phân giải tốt hơn nhiều — **0,1° (~10 km), hằng giờ, 2013–2025, 23 loài, và các mực độ cao tường minh: bề mặt, 50, 100, 250, 500, 750, 1000, 2000, 3000, 5000 m**, CC-BY ✅ — 🔴 **nhưng miền là 30°N–72°N, 25°W–45°E. VIỆT NAM NẰM NGOÀI. Đừng lên kế hoạch dùng.** Tuy vậy đây là **hình mẫu** của một bộ dữ liệu kiểm định 3D nên trông như thế nào, đáng một câu trong phương pháp luận.

**MERRA-2** ✅ ([GMAO](https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/)): từ 1980, phân giải **~50 km theo vĩ độ**, và là *"tái phân tích toàn cầu dài hạn đầu tiên đồng hoá quan trắc aerosol từ không gian"*. ⚠️ Bộ 3D 72 mực mô hình (`inst3_3d_aer_Nv`) **chưa xác thực** — GES DISC từ chối kết nối.

### 15.4 Khí tượng

| Nguồn | Chi tiết đã xác thực | Đánh giá |
|---|---|---|
| ⭐⭐ **Open-Meteo** | ✅ [docs](https://open-meteo.com/en/docs): **KHÔNG cần API key cho phi thương mại**; **gió tốc độ và hướng ở 10, 80, 120 và 180 m trên mặt đất**; **dữ liệu mực áp suất ở 19 mực, 1000 hPa xuống 30 hPa** — nhiệt độ, độ ẩm, tốc độ/hướng gió và **geopotential height** ở mỗi mực; **Boundary Layer Height (PBL)** là biến theo giờ có sẵn. Lịch sử: [historical API](https://open-meteo.com/en/docs/historical-weather-api) — **ERA5 (0,25°, từ 1940), ERA5-Land (0,1°, từ 1950), ECMWF IFS (9 km, từ 2017)**; có sẵn định dạng trích dẫn APA/BibTeX | ⭐⭐ **Lựa chọn thực dụng nhất.** Vì có geopotential height ở từng mực áp suất, **dựng được profile gió đứng thật, miễn phí, không đăng ký.** Nhớ trích dẫn cả Open-Meteo lẫn ERA5 |
| **ERA5 / ERA5-Land (CDS)** | ✅ **0,25° × 0,25°** khí quyển, **hằng giờ**, **1940–nay**, cập nhật hằng ngày với **độ trễ ~5 ngày**, **giấy phép CC-BY**, cần tài khoản CDS + API key ([ERA5](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels)). ERA5-Land: 0,1°, chỉ bề mặt đất, **không có boundary layer height** | ⚠️ Trang landing không liệt kê tên biến chính xác — xác nhận chuỗi biến (`10m_u_component_of_wind`, `boundary_layer_height`, `surface_sensible_heat_flux`…) ở tab Download trước khi viết script |
| **Open-Meteo Air Quality API** | ✅ [docs](https://open-meteo.com/en/docs/air-quality-api): **CAMS European 11 km + CAMS global 0,4°/~45 km 3 giờ**; PM10, PM2.5, CO, NO₂, SO₂, O₃, bụi, AOD; **tái phân tích lịch sử từ 2013**. 🔴 **Với Việt Nam nhận được sản phẩm global 45 km, KHÔNG phải European 11 km** |
| **NOAA GFS** | ✅ **0,25°, 0,5°, 1,0° tới 384 h**, GRIB2, qua [NOMADS](https://nomads.ncep.noaa.gov/) hoặc FTP ẩn danh. Không tốn phí, không đăng ký. Là dữ liệu **dự báo** — với nghiên cứu hồi cố, ERA5 tốt hơn |
| **NCHMF Việt Nam** | ✅ [nchmf.gov.vn](https://nchmf.gov.vn/) chỉ công bố **dự báo và cảnh báo** (24h, 10 ngày, tháng/mùa, vệ tinh, radar). **KHÔNG có cổng dữ liệu mở, KHÔNG có API.** 📐 **Số liệu trạm Việt Nam thường phải mua, không công bố — hãy tính vào kế hoạch dự án** |

**Suy ra cấp ổn định Pasquill từ dữ liệu thường quy:**
- ⚠️ **EPA, *Meteorological Monitoring Guidance for Regulatory Modeling Applications*, EPA-454/R-99-005, 02/2000, 171 trang** ([PDF](https://www.epa.gov/sites/default/files/2020-10/documents/mmgrma_0.pdf)) — **đã xác nhận danh tính, số hiệu, ngày và URL, nhưng hai lần đọc PDF đều thất bại**, nên chưa xác nhận được từ chính tài liệu rằng nó quy định phương pháp **SRDT (solar radiation / delta-T)**, sigma-theta hay Turner. **Tự mở và xác nhận mục trước khi trích.**
- ⚠️ **Biểu đồ Golder** — nguồn gốc: [Golder, D. (1972), *Boundary-Layer Meteorology* 3, 47–58, DOI 10.1007/BF00769106](https://doi.org/10.1007/BF00769106) (xác nhận qua Crossref ✅; Springer paywall). Đây là bài ánh xạ **cấp Pasquill ↔ chiều dài Monin-Obukhov (1/L) ↔ độ nhám z₀** — đúng cầu nối cần thiết giữa một bộ tái phân tích (cho thông lượng nhiệt và u\*) và một mô hình Gaussian dựa trên cấp Pasquill.
- **AERMET** là cài đặt tham chiếu của thang tỉ lệ lớp biên; mã nguồn và user guide 352 trang miễn phí ✅ ([SCRAM](https://www.epa.gov/scram/air-quality-dispersion-modeling-preferred-and-recommended-models)).

⭐ 📐 **Công thức nấu ăn đề xuất:** ERA5 cho trực tiếp `surface_sensible_heat_flux` và `friction_velocity` → tính `L = −u*³·ρ·c_p·T/(κ·g·H)` → tra cấp Pasquill trên biểu đồ Golder với z₀ suy từ OSM. **Chuỗi này hoàn toàn miễn phí và chặt chẽ hơn bảng tra theo độ che phủ mây.**

**Hoa gió:** `windrose` ✅ — **v1.10.0 (10/04/2026)**, **BSD-3-Clause OR CeCILL-B**, Python ≥3.10 ([PyPI](https://pypi.org/project/windrose/) · [docs](https://python-windrose.github.io/windrose/)). Từ u10/v10: `hướng = (270 − degrees(atan2(v,u))) % 360`, `tốc độ = hypot(u,v)`. 📐 **Dựng hoa gió THEO MÙA** — gió mùa Đông Bắc mùa đông và gió Đông Nam mùa hè của Hà Nội tạo hai chế độ phát tán rất khác nhau, và hoa gió cả năm sẽ giấu mất điều đó.

### 15.5 Phát thải — xe máy là câu chuyện chính

**Kiểm kê lưới toàn cầu:**

| Kiểm kê | Độ phân giải | Loài | Năm | Link |
|---|---|---|---|---|
| **EDGAR v8.1** | **0,1° × 0,1°** | CO, NOₓ, NMVOC, CH₄, NH₃, SO₂, PM10, PM2.5, BC, OC | năm 1970–2022, tháng 2000–2022 | ✅ [JRC](https://edgar.jrc.ec.europa.eu/dataset_ap81) — NetCDF + gridmap text; *"người dùng có nghĩa vụ ghi nhận nguồn dữ liệu"* |
| **HTAP v3** | 0,1° (có cả 0,5°) | SO₂, NOₓ, CO, NMVOC, NH₃, PM10, PM2.5, BC, OC | tháng & năm 2000–2018, **16 ngành** | ⚠️ [JRC](https://edgar.jrc.ec.europa.eu/dataset_htap_v3) · [Zenodo](https://zenodo.org/records/7516361) · bài báo mở ✅ [ESSD 15, 2667](https://essd.copernicus.org/articles/15/2667/2023/) |
| **CAMS-GLOB-ANT v5.3** | 0,1° | đa loài nhân sinh | 2000–2023 | ✅ [ECCAD](https://eccad.aeris-data.fr/) |
| **GAINS** | theo vùng/kịch bản | chất ô nhiễm + KNK, đường chi phí | kịch bản | ⚠️ [IIASA](https://iiasa.ac.at/models-tools-data/gains) — 403, vùng phủ Việt Nam chưa xác thực; 📐 **quá tầm cho đồ án** |

> 🔴 **Kiểm tra thực tế:** 0,1° ≈ 11 km. Vùng nội thành Hà Nội chỉ khoảng **3–5 ô**. **Một kiểm kê lưới toàn cầu KHÔNG THỂ tự nó điều khiển một mô hình phát tán quy mô đường phố hay voxel.** Nó cho bạn một **tổng số** mà kiểm kê bottom-up của bạn nên khớp tới. 📐 **Chính phép so sánh bottom-up vs EDGAR là một hình kiểm định tốt cho đồ án.**

**Hệ số phát thải giao thông:**
- ✅ **EMEP/EEA air pollutant emission inventory guidebook 2023** — [tải PDF miễn phí](https://www.eea.europa.eu/publications/emep-eea-guidebook-2023), xuất bản 02/10/2023. Giao thông đường bộ là chương **1.A.3.b**. Có cả [trình xem CSDL hệ số phát thải](https://efdb.apps.eea.europa.eu/).
- ✅ **COPERT** — *"máy tính phát thải xe tiêu chuẩn của EU"*, EEA điều phối, JRC phát triển khoa học; phủ *"xe con; xe thương mại nhẹ; xe tải nặng…; **xe hạng L (gồm xe máy điện, mô tô, quad và mini-car)**"*; > 450 loại xe; *"Phương pháp luận COPERT là một phần của EMEP/EEA guidebook"* ([copert.emisia.com](https://copert.emisia.com/utilities/copert/)). ⚠️ Trang không nêu có miễn phí hay không — Emisia cấp phép thương mại. 📐 **Với sinh viên: dùng các phương trình hệ số phát thải công bố trong guidebook, không dùng phần mềm.**
- ⚠️ **IVE model** — do US EPA phát triển riêng cho đội xe các nước đang phát triển, và **là mô hình được dùng trong văn liệu Việt Nam**. ⚠️ **Chưa xác thực được URL tải chính thức đang hoạt động.**

> ### ⭐⭐ PHÁT HIỆN GIÁ TRỊ NHẤT CHO ĐỀ TÀI NÀY
> **Tran, H., Nghiem, T.D., Vu, H.N.K., Nguyen, T.T., Nguyen, N.T.N., Ho, Q.B. (2024).** *"Emission characterisation of motorcycles and the potential of co-benefits from selected development scenarios in the urban ecosystem of Hanoi, Vietnam."* **IOP Conf. Ser.: Earth Environ. Sci. 1391(1), 012007.** ✅ **MỞ HOÀN TOÀN, CC BY 4.0** — [DOI 10.1088/1755-1315/1391/1/012007](https://doi.org/10.1088/1755-1315/1391/1/012007)
>
> **Hệ số phát thải khi chạy (running EF) của xe máy Hà Nội — đã xác thực:**
>
> | Chất | EF |
> |---|---|
> | **PM** | **0,053 g/km** |
> | CO | 4,8 g/km |
> | NOₓ | 0,13 g/km |
> | SO₂ | 0,006 g/km |
> | CH₄ | 0,24 g/km |
> | CO₂ | 72,55 g/km |
>
> EF khởi động cao hơn đáng kể (SO₂ 0,0007 g/lần tới **CO 12,24 g/lần**) — quan trọng nếu mô hình hoá nút giao ùn tắc. Bài cũng kết luận vùng phát thải thấp có thể giảm phát thải xe máy Hà Nội **12%** (chỉ giờ cao điểm) đến **35%** (24 giờ).
>
> ⭐ **Đây là hệ số đo tại chỗ, đặc thù Việt Nam, mở hoàn toàn. Dùng thay cho giá trị COPERT châu Âu cho xe hai bánh.**

**Văn liệu xe máy Việt Nam bổ sung** (⚠️ tìm qua search, chưa xác thực từng DOI): [Hanoi motorcycle fleet, *Atmos. Environ.* 2012](https://www.sciencedirect.com/science/article/abs/pii/S1352231012004293) · [Traffic emission inventory Hanoi, *Carbon Management* 6(3-4), 2015](https://www.tandfonline.com/doi/abs/10.1080/17583004.2015.1093694) · [PM2.5 composition Hanoi, *Atmos. Environ.* 2023](https://www.sciencedirect.com/science/article/pii/S1352231023000766).

**Đại lượng thay thế cho lưu lượng giao thông:**

🔴 **KHÔNG có bộ đếm lưu lượng giao thông mở, miễn phí nào cho Hà Nội hay TP.HCM được xác thực.** Các lựa chọn thực tế:
1. ⭐ **Mạng đường OSM + trọng số theo cấp đường** — `highway=motorway|trunk|primary|secondary|tertiary|residential`, cộng `lanes`, `maxspeed`, `oneway`. Miễn phí, đầy đủ, bảo vệ được như một bộ **phân bổ không gian tương đối**.
2. **TomTom Traffic API** ✅ ([docs](https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/product-information/introduction)) — có **Traffic Flow** (*"tốc độ quan trắc thời gian thực và thời gian di chuyển cho mọi đường chính… tốc độ hiện tại, tốc độ tự do và độ tin cậy"*) và Traffic Incidents. ⚠️ **Giới hạn tier miễn phí, điều khoản nghiên cứu, và hạn chế lưu/tái xuất bản dữ liệu KHÔNG được nêu trên trang này** — phải đọc [điều khoản](https://docs.tomtom.com/legal/terms-and-conditions). Tỉ số tốc độ flow/freeflow là đại lượng thay thế tốt cho mức ùn tắc **nếu điều khoản cho phép**.
3. **Google Maps traffic** — không có API lịch sử công khai; điều khoản nhìn chung cấm trích xuất và lưu trữ hàng loạt. ⚠️ 📐 **Coi như không dùng được.**
4. **Floating car data** — không có nguồn Việt Nam miễn phí; Grab, Be không công bố.

📐 **Cách tiếp cận khuyến nghị:** cấp đường OSM × cơ cấu đội xe theo văn liệu Việt Nam × hệ số phát thải xe máy ở §15.5, với một điểm đếm thủ công hoặc TomTom để hiệu chỉnh mức tuyệt đối. **Nói thẳng trong báo cáo rằng lưu lượng giao thông là bất định lớn nhất của đồ án.**

**Kiểm kê phát thải đã công bố cho Hà Nội / TP.HCM:**
- ✅ Ho, Q.B. et al. (2020), *"Traffic air emission inventory and measures to reduce air pollution in Ho Chi Minh City"*, [DOI 10.34154/2020-jue-0101-29-38](https://doi.org/10.34154/2020-jue-0101-29-38/euraass) — con số 88%/99%/79%/99%/88% ở §1.1.
- ⭐ ✅ **Hung, N.T., *Urban Air Quality Modelling and Management in Hanoi, Vietnam*, luận án tiến sĩ, Aarhus/NERI — [PDF MIỄN PHÍ, đọc được](https://www2.dmu.dk/pub/phd_hung.pdf)**. Cũ hơn, nhưng là một luận án mô hình hoá hoàn chỉnh, đọc tự do, đúng Hà Nội — **cực kỳ hữu ích làm khuôn mẫu cho đồ án**.
- ⚠️ *Air pollution emission inventory in Hanoi City, Vietnam* — bản trên [ResearchGate](https://www.researchgate.net/publication/383525091_Air_pollution_emission_inventory_in_Hanoi_City_Vietnam), venue gốc chưa xác thực.
- ⚠️ Kiểm kê BTEX cho TP.HCM ([PMC9738250](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9738250/)).
- 🔴 **Báo cáo JICA / World Bank:** **KHÔNG tìm và KHÔNG xác thực được báo cáo kiểm kê phát thải chất lượng không khí nào của JICA hay World Bank cho Hà Nội/TP.HCM.** Tự tra [World Bank OKR](https://openknowledge.worldbank.org/) và [thư viện JICA](https://libopac.jica.go.jp/). **Không bịa ra là có.**

### 15.6 Dữ liệu nền địa không gian

| Nguồn | Chi tiết đã xác thực |
|---|---|
| **Geofabrik Vietnam extract** | ✅ Kiểm tra ngày 19/09/2026: `.osm.pbf` **313 MB**, shapefile **686 MB**, GeoPackage **703 MB**; PBF cập nhật tới 2026-09-18T20:21:10Z; shape/gpkg dựng lại hằng ngày; **ảnh chụp lịch sử hằng tháng lùi về 2014** (hữu ích cho phân tích biến động). Giấy phép **ODbL 1.0** ([link](https://download.geofabrik.de/asia/vietnam.html)) |
| **Overpass API** | ✅ Endpoint chính `https://overpass-api.de/api/interpreter`. **Giới hạn: < 10.000 truy vấn/ngày và < 1 GB/ngày cho dùng thông thường; với ứng dụng chạy thường xuyên thì chia 100 (< 100 truy vấn, < 10 MB/ngày). Gặp HTTP 429/406 thì chờ 30 s. Cấm script chạy song song.** ([wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)) |
| ⚠️ **Mâu thuẫn giấy phép OSM** | Trang wiki Overpass ghi CC-BY-SA 2.0, nhưng phát biểu có thẩm quyền tại ✅ [openstreetmap.org/copyright](https://www.openstreetmap.org/copyright) là **Open Database License (ODbL)**. **Dùng phát biểu ODbL; trang wiki đã lỗi thời.** |
| **Dân số — WorldPop** | ✅ Số dân theo quốc gia **2000–2020** ở **~100 m tại xích đạo**, **CC BY 4.0** ([hub](https://hub.worldpop.org/geodata/listing?id=29)). **File Việt Nam đã xác thực tồn tại**: [data.worldpop.org/.../VNM/](https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/BSGM/VNM/) — `vnm_ppp_2020_UNadj_constrained.tif` (17 MB) và `vnm_ppp_2020_constrained.tif` (25 MB). ⭐ **Dùng bản UN-adjusted, constrained** cho phân tích phơi nhiễm |
| **Dân số — GHS-POP (JRC)** | ✅ *"phân bố dân số, biểu diễn bằng số người trên mỗi ô"*; **100 m, 1 km, 3 arc-sec, 30 arc-sec**; **1975–2030 theo khoảng 5 năm**; Mollweide và WGS84; mở và miễn phí ([datasets](https://human-settlement.emergency.copernicus.eu/datasets.php) · [download](https://human-settlement.emergency.copernicus.eu/download.php?ds=pop)). 📐 **GHS-POP tốt hơn cho phân tích phơi nhiễm dự báo/đa thời gian** (chạy tới 2030); WorldPop tốt hơn cho một năm gần đây ở độ phân giải cao |
| **Meta HRSL** | 🔴 **KHÔNG xác thực được** — mọi URL trả rỗng hoặc chuyển hướng tới trang không đọc được. 📐 Vì WorldPop và GHS-POP đều xác thực sạch, **HRSL không đáng mất công** |

---

## 16. Kiểm định mô hình — chỉ số, ngưỡng và bộ dữ liệu

### 16.1 Bộ chỉ số chuẩn

Hai tài liệu kinh điển:
1. ⚠️ **Chang, J.C. & Hanna, S.R. (2004), *"Air quality model performance evaluation"*, *Meteorol. Atmos. Phys.* 87(1–3), 167–196** — [DOI 10.1007/s00703-003-0070-7](https://doi.org/10.1007/s00703-003-0070-7). Đây là trích dẫn *chuẩn* cho họ chỉ số **FB / MG / NMSE / VG / R / FAC2**.
2. ⚠️ **Hanna, S. & Chang, J. (2012), *"Acceptance criteria for urban dispersion model evaluation"*, *Meteorol. Atmos. Phys.* 116, 133–146** — [DOI 10.1007/s00703-011-0177-1](https://doi.org/10.1007/s00703-011-0177-1). *"đề xuất các giá trị tiêu chí chấp nhận đã sửa đổi cho ứng dụng **đô thị** và kiểm chứng chúng với dữ liệu tracer từ bốn thí nghiệm hiện trường đô thị"* ✅ (từ trang liệt kê Springer). ⭐ **Đây mới là bài nhóm cần, vì ngưỡng cho địa hình trống/nông thôn được biết là quá chặt với thành phố.**

Định nghĩa chỉ số (📐 dạng chuẩn, cần đối chiếu bài gốc):
```
FB    = 2(C̄_o − C̄_p) / (C̄_o + C̄_p)                  (fractional bias, lý tưởng = 0)
NMSE  = mean[(C_o − C_p)²] / (C̄_o · C̄_p)              (normalised mean square error, lý tưởng = 0)
FAC2  = tỉ lệ số điểm thoả 0,5 ≤ C_p/C_o ≤ 2,0         (lý tưởng = 1)
MG    = exp( mean[ln C_o] − mean[ln C_p] )             (geometric mean bias, lý tưởng = 1)
R     = hệ số tương quan
```

### 16.2 🔴 CẢNH BÁO: các ngưỡng chấp nhận đang MÂU THUẪN trong văn liệu

Đây là chỗ nguy hiểm nhất trong toàn bộ tài liệu này. **Phải giải quyết bằng cách tự đọc bài gốc.**

Một nguồn peer-reviewed đã đọc được nêu **cả hai tầng ngưỡng** ✅ ([PMC8009780](https://pmc.ncbi.nlm.nih.gov/articles/PMC8009780/)):

| Chỉ số | Tầng chặt / nông thôn | Tầng nới / **đô thị** |
|---|---|---|
| \|FB\| | < 0,3 | **< 0,67** |
| NMSE | **< 3,0** | **< 6,0** |
| FAC2 | > 0,5 | **> 0,3** |
| NAD | < 0,3 | < 0,5 |
| MG | 0,7–1,3 | 0,5–1,5 |

Một nguồn thứ hai đã đọc được, bài GMD của CAIRDIO, chỉ trích tầng đô thị và ghi nguồn chính xác: *"tiêu chí chấp nhận cho một mô phỏng hợp lệ là **NMSE < 6, |FB| < 0,67, và FAC2 > 0,3**"*, quy cho *"hướng dẫn trình bày trong **Hanna and Chang (2012)**"* ✅ ([GMD 14, 1469](https://gmd.copernicus.org/articles/14/1469/2021/)).

> ### 🔴 VẤN ĐỀ
> **Có BA giá trị ngưỡng NMSE khác nhau đang lưu hành cho CÙNG một trích dẫn Chang & Hanna (2004): 1,5 / 3 / 4.** Không giải quyết được vì không đọc được bản gốc (PDF không trích xuất được, Springer chặn).
> **Hành động bắt buộc: mở [DOI 10.1007/s00703-003-0070-7](https://doi.org/10.1007/s00703-003-0070-7) và [DOI 10.1007/s00703-011-0177-1](https://doi.org/10.1007/s00703-011-0177-1) qua thư viện trường và chép bảng ngưỡng bằng chính mắt mình.** Trích sai ngưỡng từ nguồn thứ cấp là lỗi kinh điển mà giám khảo bắt được ngay.

🔴 **Chỉ số "hit rate" q của COST 732** (với độ lệch tương đối cho phép D, độ lệch tuyệt đối W, và mốc đạt q ≥ 0,66) **KHÔNG tìm được trong bất kỳ nguồn nào đọc được.** Đừng nêu các tham số đó nếu chưa có tài liệu hướng dẫn trong tay.

**COST Action 732** gồm ba tài liệu: một tài liệu bối cảnh/biện minh, **tài liệu hướng dẫn và giao thức đánh giá mô hình** (Britter & Schatzmann 2007b), và **Best Practice Guideline cho mô phỏng CFD dòng chảy trong môi trường đô thị** (Franke et al. 2007) ⚠️. Bản mirror: [PDF tại MIT Senseable](https://senseable.mit.edu/papers/pdf/20100527_Britter_Schatzmann_CostModel_ComputationalWind.pdf) và giao thức quy mô đô thị của [Di Sabatino et al.](https://senseable.mit.edu/papers/pdf/20081009_DiSabatino_etal_ModelEvaluation_AtmosphericDispersion.pdf) — ⚠️ cả hai là PDF chưa đọc được.

### 16.3 ⭐ Bộ dữ liệu kiểm định sinh viên LẤY ĐƯỢC THẬT

Điểm khởi đầu tốt nhất là trang **EWTL của Đại học Hamburg** ✅ ([data-sets](https://www.mi.uni-hamburg.de/en/arbeitsgruppen/windkanallabor/data-sets.html)) — đã đọc đầy đủ:

| Bộ dữ liệu | Nội dung | Truy cập |
|---|---|---|
| **CEDVAL** | vật cản đơn lẻ và mảng vật cản; **cả dòng chảy và phát tán** | miễn phí — [cloud link](https://cloud.uni-hamburg.de/s/LfSYD8qS2MH2wct) |
| **CEDVAL-LES** | dữ liệu kiểm định LES, tỉ lệ 1:500 / 1:300 / 1:225; Complexity 0 (3 lớp biên), Complexity 2 (mảng khối lập phương), Complexity 3 (biến thể Michelstadt) | miễn phí — [C0](https://cloud.uni-hamburg.de/s/6ELkFpdnxmoJbGL) · [C2](https://cloud.uni-hamburg.de/s/esE2o44N3R3TCts) · [C3](https://cloud.uni-hamburg.de/s/6S4JocqWpDYL3fM) |
| ⭐ **Michelstadt** (COST ES1006) | bố cục đô thị Trung Âu lý tưởng hoá; 7 kịch bản phát thải, 2 hướng gió, liên tục + puff | miễn phí, **cần ký Data Policy Agreement** — [link](https://cloud.uni-hamburg.de/s/aoP9Don4dpbMg4r) |
| ⭐ **MUST** (COST 732) | dòng chảy + phát tán trong hầm gió với độ nhám đô thị lý tưởng hoá | miễn phí — [link](https://cloud.uni-hamburg.de/s/sN5n9rN4Kit6wQY) |
| **Oklahoma City** (COST 732) | mô hình hầm gió trung tâm OKC, dựa trên Joint Urban 2003 | miễn phí — [link](https://cloud.uni-hamburg.de/s/FRqQmAzN8GgKqmd) |
| **CUTE** | tracer SF₆ hiện trường + hầm gió, trung tâm thành phố Trung Âu, nhà 25–35 m | bắt buộc Data Policy Agreement — [link](https://cloud.uni-hamburg.de/s/52yfanLaQ23oaGJ) |

Mật khẩu file nén đo đạc lấy từ `ewtl.mi@uni-hamburg.de`.

**Hình học Michel-Stadt** (hữu ích để định cỡ lưới voxel): ca BL3-3 là *"bố cục đô thị bán-lý-tưởng-hoá điển hình của khu dân cư ở các thành phố Trung Âu"* tỉ lệ 1:225, gồm *"60 khối nhà mái bằng có sân trong, chiều cao mái 0,625H (15 m), 0,75H (18 m) và H (24 m), phủ tổng diện tích 1320 m × 830 m ở tỉ lệ thực"*, với 40 profile đứng và 5 mực đo ngang ✅ ([arXiv:2502.13672](https://arxiv.org/abs/2502.13672)). Phía phát tán: 196 cảm biến fast-FID, 55.000 mẫu mỗi cái, bề rộng hẻm 18 m và 24 m ✅ ([PMC5606680](https://pmc.ncbi.nlm.nih.gov/articles/PMC5606680/)).

**Kiểm định Gaussian kinh điển (Prairie Grass).** Sáng kiến Harmonisation lưu các bộ kinh điển — Kincaid (~171 h SF₆ + SO₂), **Project Prairie Grass** (nay có cả profile nồng độ theo phương đứng), Round Hill, Bull Run, Cabauw, Green Glow/Hanford — tại ✅ [harmo.org/classic.php](https://www.harmo.org/classic.php), dữ liệu ở `www.harmo.org/jsirwin/`.

**Danh mục ADMLC** ✅ ([admlc.com/datasets](https://admlc.com/datasets/)) — điểm dừng một cửa khác, phủ DAPPLE, Joint Urban 2003, MUST, Michelstadt, Jack Rabbit, Thorney Island và kho DATEM của NOAA. Lưu ý kho JU2003 *"hiện đang offline"*.

**Tài liệu gốc chiến dịch hiện trường** ⚠️ (chưa đọc được):
- MUST: Yee, E. & Biltoft, C.A. (2004), [DOI 10.1023/B:BOUN.0000016496.83909.ee](https://doi.org/10.1023/B:BOUN.0000016496.83909.ee)
- JU2003: Allwine & Flaherty, *Joint Urban 2003: Study Overview and Instrument Locations*, [PNNL-15967 PDF](https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-15967.pdf)

**CODASC** (hẻm phố với các tỉ lệ H/W và hàng cây khác nhau) — 🔴 **cả hai host chính thức đều hỏng** (`codasc.de` lỗi TLS, `windforschung.de` từ chối kết nối). Mô tả theo search (⚠️): do KIT duy trì, *"28 cấu hình hẻm phố / hàng cây"*. Bản ghi trích dẫn được: [TU/e research portal](https://research.tue.nl/en/publications/codasc-a-database-for-the-validation-of-street-canyon-dispersion-/) và Gromke & Ruck, [DOI 10.1007/s10546-012-9703-z](https://doi.org/10.1007/s10546-012-9703-z).

### 16.4 Lộ trình kiểm định 3 bậc (📐 tổng hợp của nhóm)

| Bậc | Câu hỏi | Làm gì | Mốc tham chiếu |
|---|---|---|---|
| **1 — VERIFICATION** | *Mã có đúng không?* | So bộ giải voxel với **nghiệm Gaussian giải tích** trong dòng đều, không nhà. Làm việc này **TRƯỚC** khi thêm bất cứ toà nhà nào; không đạt = có bug | QES-Plume đạt sai số tương đối tối đa **5,91%** ✅ |
| **2 — VALIDATION vật lý** | *Vật lý có đúng không?* | So với dữ liệu hầm gió **Michelstadt** hoặc **MUST** (miễn phí, Hamburg EWTL). Báo cáo FAC2, FB, NMSE theo **tầng ngưỡng ĐÔ THỊ** | QES-Plume đạt **FAC2 = 0,59** trên mảng khối lập phương ✅ |
| **3 — APPLICATION** | *Dùng được cho địa bàn thật không?* | So với trạm **US Embassy Hà Nội** (cấp tham chiếu) + OpenAQ. So profile đứng với **CAMS EAC4** (60 mực mô hình) — chỉ kiểm định **HÌNH DẠNG** profile | ⚠️ Nêu rõ: đây là **so sánh điểm**, không phải kiểm định trường |

---

## 17. Tiền lệ đã công bố (prior art) — những công trình phải trích dẫn

### 17.1 Ba bài quan trọng nhất cho đề tài này

| # | Công trình | Vì sao quan trọng | Trạng thái |
|---|---|---|---|
| **1** | **Shi, Tong, Yang, Chang, Zhong, Gai & Zuo (2020)**, *SIMULATION AND EXPRESSION OF ATMOSPHERIC POLLUTION DISPERSION PROCESS BASED ON 3D GRID*, ISPRS Annals V-4-2020, 239–245 — [DOI](https://doi.org/10.5194/isprs-annals-V-4-2020-239-2020) · [PDF](https://isprs-annals.copernicus.org/articles/V-4-2020/239/2020/isprs-annals-V-4-2020-239-2020.pdf) | **Gần nhất về mặt đề bài**: mô hình dữ liệu lai, *"biểu diễn lưới ba chiều thực sự và suy diễn cellular automata"*, tính và trực quan hoá động nồng độ theo thời gian / mặt cắt / vùng | ✅ **MỞ, đọc PDF miễn phí.** ⚠️ Quy tắc CA, độ phân giải, kiểm định chưa trích xuất được |
| **2** | **Jjumba & Dragićević (2015)**, *Integrating GIS-Based Geo-Atom Theory and Voxel Automata to Simulate the Dispersal of Airborne Pollutants*, **Transactions in GIS** — [DOI 10.1111/tgis.12113](https://doi.org/10.1111/tgis.12113) | **Tiền lệ gần nhất về mặt phương pháp**: "voxel automata" + GIS, đăng trên một tạp chí GIS chính thống | ⚠️ Wiley 403 — **lấy qua thư viện trường, đây là bài phải có** |
| **3** | **Padsala, Valger, Santhanavanich, Voss & Coors (2024)**, *Geo-visualisation of Air-Pollutant Dispersion in Complex Urban Environments using 3D City Models*, ISPRS Archives XLVIII-4/W11-2024, 89–95 — [DOI](https://doi.org/10.5194/isprs-archives-XLVIII-4-W11-2024-89-2024) | **Khuôn mẫu kiến trúc hệ thống**: CityGML LoD1/LoD2 → STL → CFD (ANSYS Fluent RANS k-ε, 6,6 triệu ô polyhedral) → CSV → feature điểm 3D → **3D Tiles / GeoJSON** → CesiumJS qua **OGC 3D GeoVolumes API**, tô màu theo nồng độ; đóng khung là **urban digital twin** | ✅ (mức abstract). ⚠️ Chi tiết: CityGML phải chuyển sang STL bằng Ansys SpaceClaim vì chuyển đổi CAD tự động không cho hình học đạt chuẩn CFD (snippet) — **chính là điểm đau mà mô hình voxel tránh được** |

### 17.2 Các tiền lệ khác

| Công trình | Nội dung | Trạng thái |
|---|---|---|
| ⭐ **Ridzuan, Ujang, Azri & Choon (2020)**, *Visualising Urban Air Quality Using AERMOD, CALPUFF and CFD Models: A Critical Review*, ISPRS Archives XLIV-4/W3-2020, 355–363 — [DOI](https://doi.org/10.5194/isprs-archives-XLIV-4-W3-2020-355-2020) | **Trích dẫn tốt nhất để BIỆN MINH đề tài** — phân loại AERMOD (tầm ngắn) / CALPUFF (tầm rộng) / CFD (công cụ tổng quát), và nêu **3 khiếm khuyết của trực quan hoá 2D** (xem §1.2), rồi cổ vũ trực quan hoá 3D tích hợp GIS | ✅ đọc được |
| ⭐ **Ridzuan, Wickramathilaka, Ujang & Azri (2024)**, *3D Voxelisation for Enhanced Environmental Modelling Applications*, Pollution 10(1), 151–167 — [DOI](https://doi.org/10.22059/poll.2023.360562.1942) | Voxel hoá cho tiếng ồn (voxel + kriging 3D) và ô nhiễm không khí; **LoD1 cho tiếng ồn, LoD2 cho gió** | ✅ đọc được |
| **Hamer et al. (2020)**, *EPISODE v10.0*, GMD 13, 4323 — [link](https://gmd.copernicus.org/articles/13/4323/2020/) | Kiến trúc lai "lưới Eulerian 3D + Gaussian dưới lưới" — xem §8.4 | ✅ |
| **Teutscher et al. (2025)**, *A Digital Urban Twin Enabling Interactive Pollution Predictions and Enhanced Planning* — [arXiv:2502.13746](https://arxiv.org/abs/2502.13746) | CFD ghép khí tượng trực tiếp; **lattice Boltzmann trong OpenLB mã nguồn mở**; phần tử thấm (cây) vs không thấm (nhà) suy từ **XML OpenStreetMap**; triển khai cập nhật hằng giờ 7–23/11/2024; ước tính NO₂ và PM từ giao thông và toà nhà; *"cho phép chỉnh sửa tương tác hình học đô thị và cập nhật dữ liệu liên tục"* | ✅ (abstract) |
| **Jia et al. (2025)**, FastGaussianPuff, *Sci. Rep.* 15:18710 — [DOI](https://doi.org/10.1038/s41598-025-99491-x) · [repo](https://github.com/Hammerling-Research-Group/FastGaussianPuff) | Puff Gaussian trên **lưới 3D có cấu trúc** hoặc point cloud thưa; nhanh hơn 2 bậc độ lớn | ✅ |
| **ENVIFATE** — plugin QGIS có module phát tán khí quyển, *"dựa trên các thuật toán được ISPRA Ý kiểm nghiệm và tin cậy"*, ISPRS Archives XLII-4/W2:79 (2017) — [PDF](https://iris.unitn.it/retrieve/handle/11572/184964/151989/isprs-archives-XLII-4-W2-79-2017.pdf) | Một trong rất ít plugin GIS có mô-đun phát tán | ✅ |
| *A System Coupled GIS and CFD for Atmospheric Pollution Dispersion Simulation in Urban Blocks*, Atmosphere 14(5):832 — [DOI 10.3390/atmos14050832](https://doi.org/10.3390/atmos14050832) | Ghép GIS + CFD cho khối phố đô thị | ⚠️ MDPI 403 |
| **Systematic review of air quality modeling in digital twins for sustainable green cities**, *Discover Environment* — [DOI 10.1007/s44274-025-00412-6](https://doi.org/10.1007/s44274-025-00412-6) | ~100 nghiên cứu peer-reviewed + 17 ca ứng dụng thực tế, 2018–2024 ⚠️ (snippet) | ⚠️ Springer chuyển hướng |

### 17.3 Công cụ mã nguồn mở thực sự nối GIS với phát tán

| Công cụ | Trạng thái | Bằng chứng |
|---|---|---|
| ⭐⭐ **UMEP / URock** (plugin QGIS) | **Phù hợp nhất.** Python, chạy trong QGIS, gió Röckle, xuất **NetCDF 3D**, trần 30 triệu ô có tài liệu hoá | ✅ [GMD 16, 5703](https://gmd.copernicus.org/articles/16/5703/2023/) · [UMEP docs](https://umep-docs.readthedocs.io/en/latest/processor/Wind%20model%20URock.html) |
| **AUSTAL** (quy chuẩn Đức) | GPL, miễn phí, **có mã nguồn**, Windows + Linux, v3.3.0 (2024), mô hình hạt Lagrange theo TA Luft Phụ lục 2 | ✅ [Umweltbundesamt](https://www.umweltbundesamt.de/en/topics/air/air-quality-control-in-europe/download) |
| **GRAL / GRAMM** | GPL-3, .NET, GUI mã nguồn mở, xử lý toà nhà và địa hình phức tạp | ✅ [GitHub](https://github.com/GralDispersionModel/GRAL) · [gral.tugraz.at](https://gral.tugraz.at/) |
| **MUNICH** | GPL-3, mô hình mạng hẻm phố | ✅ [GMD 15, 7371](https://gmd.copernicus.org/articles/15/7371/2022/) |
| **pyaermod** | MIT, **wrapper** quanh AERMOD của EPA — *"là wrapper, không phải tái cài đặt"*, dùng binary chính thức của EPA; đã kiểm chứng với EPA v26135 và v24142; 172 commit, có CI — **nhưng chỉ 1 sao** ⚠️ | ✅ [GitHub](https://github.com/atmmod/pyaermod) |
| **openair** (R) | ⚠️ **Phân tích, KHÔNG phải phát tán** — *"thiếu một bộ công cụ mã nguồn mở dễ tiếp cận, chuyên dụng để **phân tích** dữ liệu chất lượng không khí"*; có phân tích quỹ đạo và đọc được file HYSPLIT | ✅ [openair book](https://openair-project.github.io/book/) |
| **CALPUFF / CALMET** | Mã nguồn, executable, preprocessor và tài liệu tại [calpuff.org](https://calpuff.org/); bản EPA chấp nhận 5.8.5 | ✅ |
| **QES** | GPL-3.0, C++ + CUDA, **bắt buộc GPU NVIDIA CC ≥ 7.0** | ✅ [GitHub](https://github.com/UtahEFD/QES-Public) |
| **WindNinja** | Mô hình gió chẩn đoán cho cháy rừng, có cả solver bảo toàn khối lượng và solver động lượng OpenFOAM | ⚠️ [repo](https://github.com/firelab/windninja) (mức search) |

> 🔴 **Phát hiện phủ định, nêu thẳng:** tìm trong kho plugin QGIS chính thức trả về **không có plugin nào dành riêng cho chất lượng không khí hay phát tán khí quyển** trong số 4.108 plugin đã duyệt ✅ ([plugins.qgis.org](https://plugins.qgis.org/plugins/?q=air+quality) — tuy nhiên search phía server không lọc đúng nên đây là phủ định yếu). **UMEP (chứa URock) là ngoại lệ thực tế và nó LÀ một plugin QGIS.** Các repo "Gaussian plume" trên PyPI/GitHub chủ yếu là script dạy học một tác giả, không phải thư viện được bảo trì.
>
> 🔴 **Không tìm được nền tảng chất lượng không khí dựa trên Unity nào.** ⚠️ Không xác thực được đặc tả voxel layer của ArcGIS Pro qua blog Esri (403) — nhưng tài liệu sản phẩm thì đã xác thực (§14.3).

---

## 18. Những thứ CHƯA kiểm chứng được — phải tự đọc trước khi trích dẫn

Đây là danh sách trung thực các khoảng trống. **Đọc trước khi đưa bất cứ con số nào vào slide.**

### 18.1 🔴 Ưu tiên cao — sẽ bị hỏi và sẽ bị bắt lỗi

| # | Vấn đề | Việc phải làm |
|---|---|---|
| 1 | **Ngưỡng chấp nhận Chang & Hanna** — ba giá trị NMSE (1,5 / 3 / 4) đang lưu hành cho cùng một trích dẫn | Mở [DOI 2004](https://doi.org/10.1007/s00703-003-0070-7) và [DOI 2012](https://doi.org/10.1007/s00703-011-0177-1) qua thư viện, chép bảng |
| 2 | **QCVN 05:2023 — PM10, TSP, Pb** và các hàng SO₂/CO/NO₂/O₃ (một nguồn). Ba lần đọc PDF cho kết quả **mâu thuẫn nhau** (một lần PM10 24h = 150, lần khác = 100; một lần SO₂ 24h = 50 và năm = 20, bất hợp lý nội tại) | **Mở PDF chính thức và đọc Bảng 1, Bảng 2 bằng mắt.** Chỉ PM2.5 = 50/25 là được hai nguồn độc lập xác nhận. ⚠️ Một lần trích còn nhắc tới giá trị chuyển tiếp PM2.5 năm = 45 µg/m³ đến 01/01/2026 — **chưa xác thực, chỉ 1 nguồn, phải kiểm hoặc bỏ** |
| 3 | **WHO 2021 — SO₂ 24h và CO 24h** | WHO đăng bảng dưới dạng **ảnh** (`pollutants_2005_2021_new.jpg`), IRIS trả 403. Các giá trị khác lấy từ EEA (cách WHO một bước). **Mở PDF WHO và trích Bảng 4.1 trực tiếp** |
| 4 | **Ngưỡng H/W của Oke (1988)** — tên ba chế độ đã xác nhận, các ranh giới số thì không (0,65 vs 0,7 tuỳ nguồn) | Mở [DOI 10.1016/0378-7788(88)90026-6](https://doi.org/10.1016/0378-7788(88)90026-6) |
| 5 | **Giá trị z₀ Davenport–Wieringa bằng mét** — WMO xác nhận danh sách LỚP, không có con số | Mở [Wieringa 1992, DOI 10.1016/0167-6105(92)90434-C](https://doi.org/10.1016/0167-6105(92)90434-C) |
| 6 | **Quy tắc z₀ ≈ 0,1·z_H, d ≈ 0,7·z_H** — không có trong nguồn gốc đã đọc | Mở [Grimmond & Oke 1999](https://doi.org/10.1175/1520-0450(1999)038%3C1262:APOUAD%3E2.0.CO;2) |
| 7 | **Quy tắc định lượng của COST 732** (khoảng cách biên theo bội số H, blockage ≤ 3%, ≥ 10 ô/cạnh nhà) và các số của AIJ | PDF nén ảnh, không trích xuất được. Tải [COST 732 BPG](https://theairshed.com/pdf/COST%20732%20Best%20Practice%20Guideline%20May%202007.pdf) và đọc Chương 4 |
| 8 | **URock Eq. A4 (chiều dài cavity)** — HTML đã xuất bản bị lỗi render, hai lần trích cho hai kết quả khác nhau | ✅ **ĐÃ GIẢI QUYẾT bằng mã nguồn** — xem §6.2. Nhưng hãy đối chiếu `InitWindField.py` trước khi cài đặt các phương trình VẬN TỐC trong vùng |

### 18.2 ⚠️ Ưu tiên trung bình — cần kiểm nếu dùng

| # | Vấn đề |
|---|---|
| 9 | **Danh sách trạm OpenAQ ở Việt Nam** — API trả 401 không key, trang explore render bằng JS. **Tự chạy `?iso=VN`** |
| 10 | **Mật độ gắn thẻ chiều cao OSM ở Hà Nội/TP.HCM** — API taginfo bị reset kết nối. **Tự chạy Overpass đếm** |
| 11 | **Chiều cao trong Microsoft GlobalMLBuildingFootprints cho Việt Nam** — Việt Nam không có trong danh sách vùng có chiều cao; **có lẽ không, nhưng chưa xác nhận** |
| 12 | **Điều khoản tier miễn phí, nghiên cứu và lưu trữ của TomTom** |
| 13 | **Điều khoản sử dụng IQAir cho công bố học thuật** |
| 14 | **Vùng phủ Sensor.Community ở Việt Nam**; **mật độ PurpleAir ở Việt Nam** |
| 15 | **Pixel TROPOMI 5,5 × 3,5 km sau 2019** — trang chính thức nêu lấy mẫu 7 × 7 km |
| 16 | **Bộ 3D 72 mực mô hình của MERRA-2** — GES DISC từ chối kết nối |
| 17 | **Meta HRSL** — mọi URL rỗng hoặc chuyển hướng |
| 18 | **EPA-454/R-99-005 có chứa phương pháp SRDT hay không** — đọc PDF thất bại hai lần |
| 19 | **Vùng phủ và điều khoản tải của GAINS cho Việt Nam** (403/404) |
| 20 | **Khuyến nghị lưới và số hạt của GRAL** — nằm trong PDF ở [GRALRecommendations](https://github.com/GralDispersionModel/GRALRecommendations), chưa đọc được |
| 21 | **Điều khoản giấy phép của QUIC** — trang LANL im lặng về chi phí, giấy phép, kiểm soát xuất khẩu |
| 22 | **Chữ ký API `voxelize` của PyVista** — 4 URL đều không render. Kiểm cục bộ bằng `help()` |
| 23 | **Ví dụ volume rendering của three.js** (`webgl2_materials_texture3d`) — trang examples render bằng JS |
| 24 | **VoxelLayer trong ArcGIS Maps SDK for JavaScript** — trang tham chiếu trả rỗng, blog Esri 403 |
| 25 | **Phương trình LBM** ở §7.3 — viết theo kiến thức chuẩn, **không trích xuất được từ nguồn nào** |
| 26 | **Biểu thức khuếch tán số** `K_num = ½·u·Δx·(1−Cr)` ở §6.4 — sách giáo khoa, chưa có nguồn chính thức |
| 27 | **Phương trình box model** ở §3 — không tìm được trang chính thức/peer-reviewed nào in ra nó |
| 28 | **CODASC** — cả hai host chính thức đều hỏng |
| 29 | **Bộ phương trình đầy đủ của OSPM** — Aarhus chỉ công bố mô tả khái niệm; Berkowicz 2000 paywall. **Dùng CERC P28/01 làm thay thế hợp lệ** |
| 30 | **Điều khoản giấy phép của OSPM và SIRANE**; **gói CALPUFF miễn phí có kèm mã nguồn Fortran hay không** |

### 18.3 🔴 Khoảng trống về bằng chứng, không phải về khả năng truy cập

| # | Khoảng trống |
|---|---|
| 31 | **Không tìm được nghiên cứu đối chứng nào đặt Gaussian / Röckle / Lagrange / CFD trên CÙNG một ca và báo cáo FAC2 cho từng loại.** Mọi ứng viên đều paywall. Thang ba bậc ở §10.2 là **tổng hợp của nhóm**, không phải một phát biểu đã xuất bản |
| 32 | **Không tìm được bài báo nào thực hiện nội suy 3-D thể tích thực sự cho một mạng cảm biến đô thị.** Nếu có, research này không tìm thấy |
| 33 | **Không tìm được nguồn peer-reviewed nào mô tả một viewer chất lượng không khí dùng CesiumJS voxel-primitive cụ thể.** Một "Ebrahim et al. 2021" hay được nhắc chỉ xuất hiện trong search snippet **không có DOI giải được — đừng trích dẫn** |
| 34 | **Không tìm được nguồn peer-reviewed nào kết hợp CHÍNH XÁC "mô hình Gaussian + lưới voxel".** Gần nhất: EPISODE (Gaussian dưới lưới trong lưới Eulerian 3D) và FastGaussianPuff (puff trên lưới 3D có cấu trúc). 📐 **Nếu đồ án muốn tuyên bố tính mới ở chỗ này, cần một khảo sát văn liệu riêng** |
| 35 | **Không có số chi phí tính toán cho PALM urban LES, CMAQ hay CAMx** trong các nguồn đọc được |
| 36 | **Không có nguồn nào cho độ chính xác dữ liệu theo từng quốc gia đối với Việt Nam.** Cảnh báo mạnh nhất có nguồn là của chính Google (*"đánh giá chỉ giới hạn ở Bắc Mỹ, châu Âu và Nhật Bản — không phải Global South"*) và của Overture (*"độ chính xác thấp hơn, đặc biệt ảnh hưởng vùng phủ ở Global South"*). **Trích hai câu đó, đừng bịa một con số cho Việt Nam** |
| 37 | **Không tìm được báo cáo kiểm kê phát thải nào của JICA hay World Bank cho Hà Nội/TP.HCM** |

### 18.4 Ghi chú về thời điểm

⚠️ Một số nguồn có ngày sau tháng 05/2026 (vd. arXiv 2603.16554, arXiv 2607.04516, hướng dẫn AIJ-LES 2025, *Sensors* 26(8) 2026, *Comput. Environ. Urban Syst.* 123). Chúng được báo cáo đúng như kết quả tìm kiếm trả về và **chưa được đánh giá độc lập**.

---

## 19. Danh mục nguồn (gom nhóm, đầy đủ link)

### 19.1 Mô hình Gaussian, quy chuẩn EPA

1. EPA ISC3 User's Guide Vol. II — Description of Model Algorithms (EPA-454/B-95-003b) — https://gaftp.epa.gov/aqmg/SCRAM/models/other/isc3/isc3v2.pdf
2. EPA SCRAM — Preferred and Recommended Models — https://www.epa.gov/scram/air-quality-dispersion-modeling-preferred-and-recommended-models
3. EPA SCRAM — Alternative Models — https://www.epa.gov/scram/air-quality-dispersion-modeling-alternative-models
4. EPA SCRAM — Screening Models — https://www.epa.gov/scram/air-quality-dispersion-modeling-screening-models
5. AERMOD Model Formulation Document — https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_mfd.pdf
6. AERMOD Implementation Guide — https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_implementation_guide.pdf
7. AERMOD User's Guide — https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_userguide.pdf
8. AERMOD mã nguồn / executable — https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_source.zip · https://gaftp.epa.gov/Air/aqmg/SCRAM/models/preferred/aermod/aermod_exe.zip
9. R-LINE v1.2 User's Guide — https://www.cmascenter.org/r-line/documentation/1.2/RLINE_UserGuide_11-13-2013.pdf · trang model https://www.cmascenter.org/r-line/
10. CALPUFF User's Guide v5 — https://calpuff.org/calpuff/download/CALPUFF_UsersGuide.pdf · site https://calpuff.org/
11. Micallef & Micallef (2024), *Sci* 6(3):48 — https://doi.org/10.3390/sci6030048
12. Johnson (2022), *Environ. Sci. Proc.* 19:18 — https://doi.org/10.3390/environsciproc2022019018
13. Jia et al. (2025), FastGaussianPuff, *Sci. Rep.* 15:18710 — https://doi.org/10.1038/s41598-025-99491-x · https://github.com/Hammerling-Research-Group/FastGaussianPuff
14. pyaermod — https://github.com/atmmod/pyaermod · https://pypi.org/project/pyaermod/
15. aermodpy — https://github.com/leiran/aermodpy · AERMOD_Framework — https://github.com/maxnyf/AERMOD_Framework
16. gaussian-plume-model-practical (Python dạy học) — https://github.com/maul1609/gaussian-plume-model-practical
17. Box/Gifford-Hanna/Box-GH — https://doi.org/10.1023/A:1020958603263 ⚠️

### 19.2 Mô hình hẻm phố

18. Mô tả OSPM chính thức, Aarhus DCE — https://envs.au.dk/en/research-areas/air-pollution-emissions-and-effects/the-monitoring-program/air-pollution-models/ospm/description-of-the-ospm-model
19. Berkowicz (2000), *Environ. Monit. Assess.* 65:323–331 — https://doi.org/10.1023/A:1006448321977 ⚠️ · bản Springer chapter https://link.springer.com/content/pdf/10.1007/978-94-010-0932-4_35.pdf
20. Kakosimos et al. (2010), review OSPM — https://doi.org/10.1071/EN10070 ⚠️
21. CERC — chỉ mục đặc tả kỹ thuật — http://www.cerc.co.uk/environmental-software/technical-specifications.html
22. CERC P10/01 & P12/01 — plume/puff spread và mean concentration — http://www.cerc.co.uk/environmental-software/assets/data/doc_techspec/P10_01.P12_01.pdf
23. CERC P28/01C/17 — basic street canyon model — http://www.cerc.co.uk/environmental-software/assets/data/doc_techspec/P28_01.pdf
24. CERC ADMS-Urban — https://www.cerc.co.uk/environmental-software/ADMS-Urban-model.html
25. Soulhac et al. (2011), SIRANE Part I — https://doi.org/10.1016/j.atmosenv.2011.07.008 · PDF tác giả http://air.ec-lyon.fr/Doc/Publi/Soulhac-Atm-Env-2011-a.pdf
26. Soulhac et al. (2017), SIRANE Part III — https://doi.org/10.1016/j.atmosenv.2017.08.034 · PDF http://air.ec-lyon.fr/Doc/Publi/Soulhac-Atm-Env2017.pdf
27. SIRANE site — http://air.ec-lyon.fr/SIRANE/
28. MUNICH v2.0, GMD 15, 7371 — https://gmd.copernicus.org/articles/15/7371/2022/ · https://github.com/cerea-lab/munich
29. Oke (1988), *Energy and Buildings* 11:103–113 — https://doi.org/10.1016/0378-7788(88)90026-6 ⚠️

### 19.3 Gió chẩn đoán Röckle, mô hình phản hồi nhanh, Lagrange

30. ⭐ Bernard, Lindberg & Oswald (2023), **URock 2023a**, GMD 16, 5703–5727 — https://doi.org/10.5194/gmd-16-5703-2023 · https://gmd.copernicus.org/articles/16/5703/2023/ · dữ liệu https://doi.org/10.5281/zenodo.7681245 · preprint https://egusphere.copernicus.org/preprints/2023/egusphere-2023-354/
31. ⭐ **Mã nguồn URock** `CalculatesIndicators.py` — https://raw.githubusercontent.com/UMEP-dev/UMEP-processing/main/functions/URock/CalculatesIndicators.py
32. UMEP Manual 4.11 — Urban Wind Fields: URock — https://umep-docs.readthedocs.io/en/latest/processor/Wind%20model%20URock.html
33. ⭐ QES-Winds documentation — https://qes-documentation.readthedocs.io/en/latest/QES-Winds.html
34. Margairaz et al. (2023), QES-Plume v1.0, GMD 16, 5729–5754 — https://doi.org/10.5194/gmd-16-5729-2023 · OSTI full text https://www.osti.gov/pages/servlets/purl/2345877
35. QES-Public repository (GPL-3.0) — https://github.com/UtahEFD/QES-Public
36. LANL QUIC — https://www.lanl.gov/science-engineering/science-programs/office-of-science-programs/quic · tin https://www.lanl.gov/media/news/0923-quick-depdose
37. QUIC-URB v1.1 Theory and User's Guide (LA-UR-07-3181) — https://cdn.lanl.gov/files/quicurb-usersguide_c8fb5.pdf
38. QES-Winds v1.0 Theory and User's Guide — https://collections.lib.utah.edu/dl_files/6c/9b/6c9bd00e2cf589e7d75a1c7cded565569baab4db.pdf
39. Singh, Hansen, Brown & Pardyjak (2008), đánh giá QUIC-URB — https://doi.org/10.1007/s10652-008-9084-5 ⚠️
40. Bagal et al., improved upwind cavity parameterization (AMS) — https://ams.confex.com/ams/pdfpapers/74016.pdf
41. Nelson et al., new rooftop recirculation parameterization (AMS) — https://ams.confex.com/ams/pdfpapers/104247.pdf
42. Front. Earth Sci. (2023), rapid 3-D canopy winds (chi phí 2–3 bậc độ lớn) — https://doi.org/10.3389/feart.2023.1251056
43. GRAL — https://gral.tugraz.at/ · https://github.com/GralDispersionModel/GRAL · https://github.com/GralDispersionModel/GRAMM · https://github.com/GralDispersionModel/GRALRecommendations
44. AUSTAL (Umweltbundesamt) — https://www.umweltbundesamt.de/en/topics/air/air-quality-control-in-europe/download
45. FLEXPART v10.4, GMD 12, 4955 — https://doi.org/10.5194/gmd-12-4955-2019 · https://models.nilu.no/models/flexpart/
46. Tinarelli et al. (2007), Micro-Swift-Spray — https://doi.org/10.1007/978-0-387-68854-1_49 ⚠️ · Oldrini et al., PMSS — https://doi.org/10.1007/s10652-017-9532-1 ⚠️ · AIRCITY — https://www.aria.fr/projets/aircity/pdf/H15-184.Moussafir.AIRCITY.V4.pdf ⚠️
47. WindNinja — https://github.com/firelab/windninja ⚠️
48. Horne, Pan & Davis (2026), roughness length & displacement height — https://pmc.ncbi.nlm.nih.gov/articles/PMC13053558/ · https://doi.org/10.1007/s10546-026-00968-7
49. WMO Codes Registry — Davenport surface roughness — https://codes.wmo.int/wmdr/SurfaceRoughnessDavenport
50. Davenport, Grimmond, Oke & Wieringa (2000), AMS — https://ams.confex.com/ams/AugDavis/techprogram/paper_15611.htm
51. Wieringa (1992) — https://doi.org/10.1016/0167-6105(92)90434-C ⚠️ · Grimmond & Oke (1999) — https://doi.org/10.1175/1520-0450(1999)038%3C1262:APOUAD%3E2.0.CO;2 ⚠️
52. Ng et al. (2011), urban morphology & surface roughness — https://pmc.ncbi.nlm.nih.gov/articles/PMC7127139/
53. EnergyPlus I/O Reference — bảng số mũ profile gió — https://bigladdersoftware.com/epx/docs/24-1/input-output-reference/group-location-climate-weather-file-access.html

### 19.4 Số trị, CFD, LES, LBM, CTM

54. OpenFOAM-10 `scalarTransportFoam.C` — https://github.com/OpenFOAM/OpenFOAM-10/blob/master/applications/solvers/basic/scalarTransportFoam/scalarTransportFoam.C
55. OpenFOAM v12 User Guide — `fvSchemes` — https://doc.cfd.direct/openfoam/user-guide-v12/fvschemes
56. Courant, Friedrichs & Lewy (1928) — https://doi.org/10.1007/BF01448839 ⚠️ · ADS https://ui.adsabs.harvard.edu/abs/1928MatAn.100...32C/abstract
57. Strang (1968), SIAM J. Numer. Anal. 5(3):506–517 — https://doi.org/10.1137/0705041 ⚠️
58. Menter (1994), AIAA J. 32(8) — https://doi.org/10.2514/3.12149 ⚠️ · ADS https://ui.adsabs.harvard.edu/abs/1994AIAAJ..32.1598M/abstract
59. COST 732 Best Practice Guideline (05/2007) — https://theairshed.com/pdf/COST%20732%20Best%20Practice%20Guideline%20May%202007.pdf ⚠️
60. Franke et al. (2011), tóm tắt COST 732 — https://doi.org/10.1504/IJEP.2011.038443 ⚠️
61. Britter & Schatzmann, COST 732 evaluation protocol — https://senseable.mit.edu/papers/pdf/20100527_Britter_Schatzmann_CostModel_ComputationalWind.pdf ⚠️
62. Di Sabatino et al., urban-scale model evaluation protocol — https://senseable.mit.edu/papers/pdf/20081009_DiSabatino_etal_ModelEvaluation_AtmosphericDispersion.pdf ⚠️
63. Tominaga et al. (2008), AIJ guidelines — https://doi.org/10.1016/j.jweia.2008.02.058 ⚠️ · AIJ-LES 2025 — https://www.sciencedirect.com/science/article/pii/S0167610525003174 ⚠️
64. Elfverson & Lejon (2021), OpenFOAM urban dispersion, *Atmosphere* 12(9):1124 — https://doi.org/10.3390/atmos12091124 ⚠️
65. Rakai & Kristóf (2013), Michelstadt CFD evaluation — https://pmc.ncbi.nlm.nih.gov/articles/PMC3763361/ · https://doi.org/10.1155/2013/781748
66. Maronga et al. (2020), PALM 6.0, GMD 13, 1335 — https://doi.org/10.5194/gmd-13-1335-2020 · special issue https://gmd.copernicus.org/articles/special_issue999.html
67. Maronga et al. (2018), Berlin building-resolving LES — https://elib.dlr.de/121678/
68. Hellsten et al. (2021), nested multi-scale PALM, GMD 14, 3185 — https://doi.org/10.5194/gmd-14-3185-2021
69. Kadasch et al. (2021), mesoscale nesting interface PALM, GMD 14, 5435 — https://doi.org/10.5194/gmd-14-5435-2021
70. PALM licence (Trac) — https://palm.muk.uni-hannover.de/trac · PALM-4U tại DWD — https://www.dwd.de/EN/ourservices/palm4u_en/palm4u_en.html
71. Teng et al. (2025), LES over urban roughness (Michel-Stadt, GPU-giờ) — https://arxiv.org/abs/2502.13672
72. Merlier, Jacob & Sagaut (2018), LBM-LES street canyon — https://doi.org/10.1016/j.atmosenv.2018.09.040 ⚠️
73. LBM review, *Atmosphere* 12(7):833 — https://www.mdpi.com/2073-4433/12/7/833 ⚠️
74. LBM trên HPC dị thể (18 tỉ ô) — https://arxiv.org/abs/2506.21804
75. LBM GPU near-real-time urban wind — https://arxiv.org/abs/2607.04516
76. UrbanFlow-3K dataset — https://arxiv.org/html/2603.16554
77. EPA CMAQ neighborhood scales — https://www.epa.gov/cmaq/evaluation-cmaq-applications-neighborhood-scales · repo https://github.com/USEPA/CMAQ
78. CAMx — https://www.ramboll.com/en-us/products/government-and-public/camx · User's Guide v7.20 https://www.camx.com/Files/CAMxUsersGuide_v7.20.pdf
79. Grell et al. (2005), WRF-Chem — https://doi.org/10.1016/j.atmosenv.2005.04.027 · PDF https://www2.mmm.ucar.edu/people/skamarock/grell_et_al_2005.pdf · trạng thái https://www2.acom.ucar.edu/wrf-chem
80. ⭐ Hamer et al. (2020), EPISODE v10.0, GMD 13, 4323 — https://gmd.copernicus.org/articles/13/4323/2020/
81. ⭐ CAIRDIO v1.0, GMD 14, 1469 — https://doi.org/10.5194/gmd-14-1469-2021
82. ACP 25, 3363 (2025), multi-scale Paris exposure (chi phí CPU-giờ) — https://doi.org/10.5194/acp-25-3363-2025
83. FAIRMODE Antwerp microscale intercomparison — https://www.sciencedirect.com/science/article/pii/S0048969724019041 ⚠️
84. Antonioni et al. (2012), CFD vs operational models — https://www.sciencedirect.com/science/article/abs/pii/S1352231011011459 ⚠️
85. Evaluation of fast atmospheric dispersion models in a regular street network — https://doi.org/10.1007/s10652-018-9587-7 ⚠️
86. Lagrangian stochastic idealized urban area — https://www.sciencedirect.com/science/article/abs/pii/S0167610519305768 ⚠️
87. ECCC training on urban dispersion — https://eer.cmc.ec.gc.ca/projets/CUDM/urbanDispersion_page3.html

### 19.5 Cellular automata / voxel automata

88. ⭐ Shi et al. (2020), ISPRS Annals V-4-2020, 239–245 — https://doi.org/10.5194/isprs-annals-V-4-2020-239-2020 · PDF https://isprs-annals.copernicus.org/articles/V-4-2020/239/2020/isprs-annals-V-4-2020-239-2020.pdf
89. ⭐ Jjumba & Dragićević (2015), Voxel Automata, Transactions in GIS — https://doi.org/10.1111/tgis.12113 ⚠️
90. Air quality simulation through cellular automata (1992) — https://www.sciencedirect.com/science/article/abs/pii/0266983892900102 ⚠️
91. CA simulation of dispersion of pollutants — https://www.sciencedirect.com/science/article/abs/pii/S0927025600000975 ⚠️
92. ICIIT 2020, CA atmospheric quality — https://doi.org/10.1145/3385209.3385213 ⚠️
93. Sonnenschein et al. (2024), hybrid CA air pollution model — https://doi.org/10.2139/ssrn.4933580

### 19.6 Học máy / surrogate

94. GNN rapid prediction of urban pollutant dispersion — https://pubmed.ncbi.nlm.nih.gov/39153302/ ⚠️
95. Two-stage CFD-GNN — https://www.sciencedirect.com/science/article/abs/pii/S2210670724004323 ⚠️
96. Li & Li (2026), morphology-guided cGAN, *Sensors* 26(8):2367 — https://doi.org/10.3390/s26082367
97. FastFlow — https://arxiv.org/abs/2211.12035
98. Deep learning emergency pollution forecast — https://www.sciencedirect.com/science/article/abs/pii/S1364815222000937 ⚠️
99. Data fusion air quality mapping low-cost sensors — https://www.sciencedirect.com/science/article/pii/S0160412020319206 ⚠️
100. Integrating low-cost sensors with dispersion modelling — https://www.sciencedirect.com/science/article/pii/S0160412026001157 ⚠️
101. Spatio-temporal GP with Vecchia approximation — https://arxiv.org/pdf/2511.22500 · mobile+fixed sensor model comparison — https://arxiv.org/pdf/2511.22550

### 19.7 Chuẩn, cấu trúc dữ liệu và thư viện GIS 3D

102. OGC CityGML — https://www.ogc.org/standards/citygml/ · Part 1 https://docs.ogc.org/is/20-010/20-010.html · Part 2 https://docs.ogc.org/is/21-006r2/21-006r2.html · Users Guide https://docs.ogc.org/guides/20-066.html · CityGML 2.0 https://docs.ogc.org/is/12-019/12-019/pdf
103. CityJSON 2.0.1 — https://www.cityjson.org/specs/2.0.1/
104. OGC 3D Tiles — https://www.ogc.org/standards/3dtiles/ · spec 1.1 https://docs.ogc.org/cs/22-025r4/22-025r4.html
105. 3D Tiles Implicit Tiling — https://github.com/CesiumGS/3d-tiles/tree/main/specification/ImplicitTiling
106. ⭐ `3DTILES_content_voxels` (draft) — https://github.com/CesiumGS/3d-tiles/tree/voxels/extensions/3DTILES_content_voxels
107. OGC CoverageJSON 1.0 — https://docs.ogc.org/cs/21-069r2/21-069r2.html
108. OGC Zarr Storage Specification 2.0 — https://www.ogc.org/standards/zarr-storage-specification/ · GeoZarr SWG https://www.ogc.org/announcement/ogc-forms-new-geozarr-standards-working-group-to-establish-a-zarr-encoding-for-geospatial-data/ · charter https://github.com/zarr-developers/geozarr-spec/blob/main/CHARTER.adoc
109. CF Conventions — https://cfconventions.org/cf-conventions/cf-conventions.html
110. Khronos WebGL 2.0 Specification — https://registry.khronos.org/webgl/specs/latest/2.0/
111. OpenVDB — https://www.openvdb.org/about/ · overview https://www.openvdb.org/documentation/doxygen/overview.html · Python https://www.openvdb.org/documentation/doxygen/python.html · Museth VDB paper https://doi.org/10.1145/2487228.2487235 ⚠️
112. Zarr — https://zarr.readthedocs.io/en/stable/ · Dask Array https://docs.dask.org/en/stable/array.html
113. xarray — https://docs.xarray.dev/en/stable/getting-started-guide/why-xarray.html · dask guide https://docs.xarray.dev/en/stable/user-guide/dask.html
114. rioxarray — https://corteva.github.io/rioxarray/stable/readme.html · netCDF4-python https://unidata.github.io/netcdf4-python/ · HDF5 https://www.hdfgroup.org/solutions/hdf5/
115. scipy.ndimage — https://docs.scipy.org/doc/scipy/reference/ndimage.html · RBFInterpolator https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.RBFInterpolator.html
116. scikit-image `marching_cubes` — https://scikit-image.org/docs/stable/api/skimage.measure.html
117. PyKrige — https://geostat-framework.readthedocs.io/projects/pykrige/en/stable/ · GSTools https://geostat-framework.readthedocs.io/projects/gstools/en/stable/
118. trimesh voxel creation — https://trimesh.org/trimesh.voxel.creation.html · Open3D voxelization https://www.open3d.org/docs/release/tutorial/geometry/voxelization.html · PyVista voxelize https://docs.pyvista.org/api/core/_autosummary/pyvista.datasetfilters.voxelize ⚠️
119. VTK file formats — https://examples.vtk.org/site/VTKFileFormats/ · ParaView displaying data https://docs.paraview.org/en/latest/UsersGuide/displayingData.html
120. ⭐ VoxCity — https://github.com/kunifujiwara/VoxCity · https://doi.org/10.1016/j.compenvurbsys.2025.102366 · arXiv https://arxiv.org/pdf/2504.13934
121. 3DBAG data layers (ngữ nghĩa extrude LoD1) — https://docs.3dbag.nl/en/schema/layers/
122. Esri — What is a voxel layer — https://doc.esri.com/en/arcgis-pro/latest/help/mapping/layer-properties/what-is-a-voxel-layer-.html · supported formats https://pro.arcgis.com/en/pro-app/latest/help/mapping/layer-properties/supported-voxel-formats.htm · GA Layer 3D To NetCDF https://doc.esri.com/en/arcgis-pro/latest/tool-reference/geostatistical-analyst/ga-layer-3d-to-netcdf.html
123. CesiumJS VoxelPrimitive — https://cesium.com/learn/cesiumjs/ref-doc/VoxelPrimitive.html · Cesium3DTilesVoxelProvider https://cesium.com/learn/ion-sdk/ref-doc/Cesium3DTilesVoxelProvider.html
124. deck.gl layers — https://deck.gl/docs/api-reference/layers · GridCellLayer https://deck.gl/docs/api-reference/layers/grid-cell-layer · PointCloudLayer https://deck.gl/docs/api-reference/layers/point-cloud-layer
125. three.js Data3DTexture — https://threejs.org/docs/#api/en/textures/Data3DTexture · MapLibre style spec https://maplibre.org/maplibre-style-spec/layers/
126. QGIS 3D map view — https://docs.qgis.org/latest/en/docs/user_manual/map_views/3d_map_view.html · Qgis2threejs https://qgis2threejs.readthedocs.io/en/latest/ · https://github.com/minorua/Qgis2threejs
127. QGIS plugin repository search — https://plugins.qgis.org/plugins/?q=air+quality
128. Volume ray casting (nguồn cấp ba) — https://en.wikipedia.org/wiki/Volume_ray_casting

### 19.8 Văn liệu GIS 3D / voxel peer-reviewed

129. Gorte et al. (2024), 3D Data Integration in the Voxel Domain — https://doi.org/10.5194/isprs-annals-X-4-2024-133-2024
130. Aleksandrov et al. (2019), Voxel-Based Visibility Analysis — https://doi.org/10.5194/isprs-annals-IV-4-W8-11-2019
131. Apeh & Abdul Rahman (2023), review 3D spatial data models — https://doi.org/10.5194/isprs-archives-XLVIII-4-W6-2022-15-2023
132. García-Sánchez et al. (2021), impact of LoD on CFD wind — https://doi.org/10.5194/isprs-archives-XLVI-4-W4-2021-67-2021
133. ⭐ Ridzuan et al. (2020), Visualising Urban Air Quality (critical review) — https://doi.org/10.5194/isprs-archives-XLIV-4-W3-2020-355-2020
134. ⭐ Ridzuan et al. (2024), 3D Voxelisation for Environmental Modelling — https://doi.org/10.22059/poll.2023.360562.1942
135. ⭐ Padsala et al. (2024), Geo-visualisation of Air-Pollutant Dispersion — https://doi.org/10.5194/isprs-archives-XLVIII-4-W11-2024-89-2024
136. Teutscher et al. (2025), Digital Urban Twin (OpenLB) — https://arxiv.org/abs/2502.13746
137. GPU-Accelerated Voxel Simulation Framework, ISPRS IJGI 15(9):405 — https://doi.org/10.3390/ijgi15090405 ⚠️
138. GIS + CFD coupled system, *Atmosphere* 14(5):832 — https://doi.org/10.3390/atmos14050832 ⚠️
139. Systematic review — air quality modeling in digital twins — https://doi.org/10.1007/s44274-025-00412-6 ⚠️
140. ENVIFATE QGIS plugin (ISPRS 2017) — https://iris.unitn.it/retrieve/handle/11572/184964/151989/isprs-archives-XLII-4-W2-79-2017.pdf
141. openair (R) — https://openair-project.github.io/book/
142. Voxelization algorithms for geospatial applications — https://doi.org/10.1016/j.mex.2016.01.001 ⚠️ · Spatial indices in voxel-based space — https://doi.org/10.1007/s10109-016-0231-0 ⚠️

### 19.9 Kiểm định — chỉ số và bộ dữ liệu

143. Chang & Hanna (2004) — https://doi.org/10.1007/s00703-003-0070-7 ⚠️
144. Hanna & Chang (2012), urban acceptance criteria — https://doi.org/10.1007/s00703-011-0177-1 ⚠️
145. PMC8009780 — nguồn nêu cả hai tầng ngưỡng — https://pmc.ncbi.nlm.nih.gov/articles/PMC8009780/
146. ⭐ Hamburg EWTL reference data sets — https://www.mi.uni-hamburg.de/en/arbeitsgruppen/windkanallabor/data-sets.html
147. Harmonisation classic datasets (Prairie Grass…) — https://www.harmo.org/classic.php
148. ADMLC datasets index — https://admlc.com/datasets/
149. Yee & Biltoft (2004), MUST — https://doi.org/10.1023/B:BOUN.0000016496.83909.ee ⚠️
150. Allwine & Flaherty, JU2003 PNNL-15967 — https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-15967.pdf ⚠️
151. Gromke & Ruck, CODASC — https://doi.org/10.1007/s10546-012-9703-z ⚠️ · https://research.tue.nl/en/publications/codasc-a-database-for-the-validation-of-street-canyon-dispersion-/
152. Efthimiou et al. (2015), Michel-Stadt dispersion sensors — https://doi.org/10.3390/toxics3030259

### 19.10 Dữ liệu — quan trắc, khí tượng, phát thải, nền

153. OpenAQ — https://docs.openaq.org/ · quick start https://docs.openaq.org/using-the-api/quick-start · rate limits https://docs.openaq.org/using-the-api/rate-limits · licenses https://docs.openaq.org/resources/licenses · key https://explore.openaq.org
154. ⭐ AirNow embassy monitors — https://gispub.epa.gov/airnowembassy/
155. moitruongthudo.vn — https://moitruongthudo.vn/ · CEM — https://cem.gov.vn/ · PAM Air — https://pamair.org/en/home/ · API https://pamair.org/en/service/api-service/
156. IQAir API — https://www.iqair.com/air-pollution-data-api · Việt Nam https://www.iqair.com/vietnam
157. PurpleAir — https://api.purpleair.com/ · https://develop.purpleair.com · Sensor.Community — https://sensor.community/en/
158. Sentinel-5P — https://dataspace.copernicus.eu/explore-data/data-collections/sentinel-data/sentinel-5p · SentiWiki https://sentiwiki.copernicus.eu/web/s5p-mission · GEE NO₂ https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_NO2
159. MODIS MAIAC AOD MCD19A2 — https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/products/MCD19A2
160. ⭐ CAMS EAC4 (60 mực mô hình) — https://ads.atmosphere.copernicus.eu/datasets/cams-global-reanalysis-eac4 · CAMS Europe (ngoài Việt Nam) https://ads.atmosphere.copernicus.eu/datasets/cams-europe-air-quality-reanalyses
161. MERRA-2 — https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/ · GES DISC https://disc.gsfc.nasa.gov/datasets?project=MERRA-2
162. ERA5 — https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels · ERA5-Land https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land
163. ⭐ Open-Meteo — https://open-meteo.com/en/docs · historical https://open-meteo.com/en/docs/historical-weather-api · air quality https://open-meteo.com/en/docs/air-quality-api
164. NOAA GFS — https://www.nco.ncep.noaa.gov/pmb/products/gfs/ · NOMADS https://nomads.ncep.noaa.gov/ · NCHMF https://nchmf.gov.vn/
165. EPA Meteorological Monitoring Guidance EPA-454/R-99-005 — https://www.epa.gov/sites/default/files/2020-10/documents/mmgrma_0.pdf ⚠️ · index https://www.epa.gov/scram/meteorological-guidance
166. Golder (1972) — https://doi.org/10.1007/BF00769106 ⚠️
167. windrose — https://pypi.org/project/windrose/ · https://python-windrose.github.io/windrose/
168. EDGAR v8.1 — https://edgar.jrc.ec.europa.eu/dataset_ap81 · HTAP v3 https://edgar.jrc.ec.europa.eu/dataset_htap_v3 · Zenodo https://zenodo.org/records/7516361 · bài ESSD https://essd.copernicus.org/articles/15/2667/2023/ · CAMS-GLOB-ANT https://eccad.aeris-data.fr/ · GAINS https://iiasa.ac.at/models-tools-data/gains
169. EMEP/EEA Guidebook 2023 — https://www.eea.europa.eu/publications/emep-eea-guidebook-2023 · EF database https://efdb.apps.eea.europa.eu/ · COPERT https://copert.emisia.com/utilities/copert/
170. ⭐⭐ Tran et al. (2024), hệ số phát thải xe máy Hà Nội (mở) — https://doi.org/10.1088/1755-1315/1391/1/012007
171. Ho et al. (2020), kiểm kê giao thông TP.HCM — https://doi.org/10.34154/2020-jue-0101-29-38/euraass
172. ⭐ Hung, N.T., luận án tiến sĩ Hà Nội (PDF miễn phí) — https://www2.dmu.dk/pub/phd_hung.pdf
173. ⭐ Ngo et al. (2023), street-scale dispersion Hà Nội, *Environ. Res.* 233:116497 — https://doi.org/10.1016/j.envres.2023.116497 ⚠️ · PubMed https://pubmed.ncbi.nlm.nih.gov/37356526/
174. Hanoi WRF-CMAQ traffic/health study, *Atmosphere* 16(11):1301 — https://doi.org/10.3390/atmos16111301 ⚠️
175. TomTom Traffic API — https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/product-information/introduction · terms https://docs.tomtom.com/legal/terms-and-conditions
176. Geofabrik Vietnam — https://download.geofabrik.de/asia/vietnam.html · Overpass https://wiki.openstreetmap.org/wiki/Overpass_API · **giấy phép chính thức** https://www.openstreetmap.org/copyright
177. OSM `building:levels` — https://wiki.openstreetmap.org/wiki/Key%3Abuilding%3Alevels · taginfo https://taginfo.openstreetmap.org/keys/building%3Alevels
178. Google Open Buildings v3 — https://sites.research.google/gr/open-buildings/ · ⭐ **2.5D Temporal (có chiều cao, có Việt Nam)** https://sites.research.google/gr/open-buildings/temporal/ · GEE https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1
179. Microsoft GlobalMLBuildingFootprints — https://github.com/microsoft/GlobalMLBuildingFootprints · Overture buildings https://docs.overturemaps.org/guides/buildings/
180. GlobalBuildingAtlas, ESSD 17, 6647 — https://doi.org/10.5194/essd-17-6647-2025
181. Copernicus DEM GLO-30 — https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM · DOI https://doi.org/10.5270/ESA-c5d3d65 · ALOS AW3D30 https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/aw3d30_e.htm · SRTM https://search.earthdata.nasa.gov/
182. WorldPop — https://hub.worldpop.org/geodata/listing?id=29 · **file Việt Nam** https://data.worldpop.org/GIS/Population/Global_2000_2020_Constrained/2020/BSGM/VNM/ · GHS-POP https://human-settlement.emergency.copernicus.eu/datasets.php

### 19.11 Tiêu chuẩn chất lượng không khí

183. **QCVN 05:2023/BTNMT** — HTML dễ đọc nhất: https://luatvietnam.vn/tai-nguyen/quy-chuan-viet-nam-qcvn-05-2023-btnmt-245815-d3.html · PDF gov.vn http://huulung.langson.gov.vn/upload/105417/20250327/01-btnmt-qc05_a74c1.pdf · mirror https://thuvienmoitruong.vn/wp-content/uploads/2025/05/QCVN05_2023_BTNMT_919891.pdf · https://thuvienphapluat.vn/TCVN/Tai-nguyen-Moi-truong/QCVN-05-2023-BTNMT-Chat-luong-khong-khi-919891.aspx
184. **WHO 2021 Global Air Quality Guidelines** — https://www.who.int/publications/i/item/9789240034228 · IRIS https://apps.who.int/iris/handle/10665/345329 · số liệu qua EEA https://www.eea.europa.eu/en/analysis/publications/europes-air-quality-status-2024

---

## 20. Ba câu tóm tắt

1. **Về mô hình:** có sáu tầng, và **tầng T3 (gió chẩn đoán Röckle + bảo toàn khối lượng Sasaki + vận chuyển trên voxel)** là tầng duy nhất đồng thời phân giải toà nhà, chạy trên laptop, và native voxel — tức là đúng thứ mà đề tài "3D Array/voxel" yêu cầu.
2. **Về chi phí:** khoảng cách giữa T3 và T4/LES là **hai đến ba bậc độ lớn** ✅, và bảng CAIRDIO ✅ cho thấy **5–10 m là điểm ngọt về độ phân giải**. Đây là hai con số quyết định phạm vi đồ án.
3. **Về tính trung thực:** tài liệu này gắn cờ 37 mục chưa kiểm chứng được ở §18. **Danh sách đó không phải điểm yếu của nghiên cứu — nó là danh sách việc phải làm tuần 1**, và việc nêu nó ra trong báo cáo là một điểm cộng học thuật chứ không phải điểm trừ.

➡️ **Quyết định chọn phương án nào, vì sao, và kế hoạch triển khai: xem [`DECISION.md`](./DECISION.md).**









