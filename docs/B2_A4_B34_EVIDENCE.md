# B2.1, B2.2, B3.4 và A4 — bằng chứng nghiệm thu

Tài liệu này ghi lại bằng chứng đã chạy trên máy demo ngày 07/10/2026. Các số liệu B2.2 là
**Gaussian baseline**; A4 dùng fixture nhỏ để kiểm tra đường tích hợp thật. Không phần nào dưới
đây được dùng thay cho kết quả FV production-grid của B5.

## B2.1 — voxel và nguồn phát thải tái lập

`src/release_inputs.py` tái dựng input từ scene package đã commit và khóa SHA-256, thay vì tải
lại OSM/Google Open Buildings có thể thay đổi theo thời gian. Kết quả:

| Thuộc tính | Giá trị |
|---|---:|
| Grid | `100 × 100 × 50` = 500.000 voxel |
| Kích thước ô | `5 × 5 × 2 m` |
| Building / road | 62 / 67 |
| Solid voxel | 41.084 |
| Ô nguồn phát thải | 1.341 |
| Thứ tự tensor | `[z,y,x]` |
| CRS | `EPSG:32648` |
| Tổng nguồn tương đối lưu trên file | `0,999999999976` |

Nguồn tương đối loại bỏ các ô solid rồi được chuẩn hóa bằng EDGAR v8.1 PM2.5, sector TRO,
năm 2022. Flux tại ô EDGAR phủ study area là `1,2293387662e-11 kg/m²/s`; tổng đích là
`3,0733469155e-06 kg/s`. File vận chuyển dùng `S[z,y,x]` với đơn vị `kg/m³/s`, tích phân theo
thể tích trả đúng tổng đích. Provenance chiều cao (`gob:building_height`) được giữ trong
metadata voxel.

Lệnh tái lập:

```powershell
.\.venv\Scripts\python.exe -m src.release_inputs --config config/project.yaml
.\.venv\Scripts\python.exe src/edgar_normalizer.py --config config/project.yaml
```

## B2.2 — Gaussian baseline hai kịch bản

Hai baseline dùng chính source đã EDGAR-normalised:

- `output/netcdf/concentration_dry_nov_apr_gaussian.nc`
- `output/netcdf/concentration_wet_may_oct_gaussian.nc`

| Scenario | Max | Cao độ max | Mean toàn miền | Vượt QCVN/WHO 24h |
|---|---:|---:|---:|---:|
| `dry_nov_apr` | 1,47 µg/m³ | 1 m | 0,0242 µg/m³ | 0 / 0 m³ |
| `wet_may_oct` | 2,65 µg/m³ | 1 m | 0,0243 µg/m³ | 0 / 0 m³ |

Phân tích hình thái ghi nhận 228/998 mẫu hẻm phố hai phía, H/W median 0,64 và IQR
0,52–1,06. Nồng độ thấp là hệ quả của EDGAR regional lower-bound; không được diễn giải là
đánh giá phơi nhiễm thực địa tại Nguyễn Huệ.

Pipeline phân tích còn dùng scene road đã khóa checksum khi raw OSM không có trên máy sạch.
Kết quả baseline dùng để kiểm tra hướng plume và làm đối chứng, không phải output chính của
đề tài. Kết quả FV 3D vẫn thuộc B5.

```powershell
.\.venv\Scripts\python.exe src/04_analysis.py --config config/project.yaml --baselines
```

## B3.4 — benchmark solver nhỏ

`src/benchmark_solver.py` gọi **real solver CLI**, không dùng `--mock`, ba lần trên fixture có
obstacle và nguồn vật lý.

| Thuộc tính | Giá trị đo |
|---|---:|
| Máy | Intel Core i5-12500H, 12 core/16 thread, RAM 16 GB, Windows 11 |
| Python | 3.13.3 |
| Grid | `32 × 24 × 12` = 9.216 voxel |
| Thời gian mô phỏng | 60 s, 154 bước, `dt=0,392014 s` |
| SOR | 74 iteration |
| Wall-clock median (3 lần) | 3,2222 s |
| Peak RSS lớn nhất | 111,8164 MB |
| Solver core wall-clock | 0,352–0,412 s |

Đây là benchmark tuần 3 để phát hiện sớm vấn đề runtime. Nó không thay cho benchmark lưới
500.000 voxel ở B5.4.

```powershell
.\.venv\Scripts\python.exe -m src.benchmark_solver --config config/project.yaml
```

## A4 — NestJS gọi Python solver thật

`PROJECT_CONFIG_PATH` là cấu hình đầu vào được validate lúc khởi động. Khi nhận `POST /runs`,
monolith snapshot cấu hình theo run rồi executor spawn Python CLI bằng argument list. E2E mới
chạy luồng thật:

```text
POST /runs
  → queued → running
  → Python wind + FV transport
  → manifest/verification/checksum
  → import 4 concentration columns vào PostGIS
  → succeeded
  → status/artifact/summary/slice/profile query
```

Fixture A4 dùng grid `2 × 2 × 4` khớp chính xác scene seed của test DB và source có đơn vị
`kg m-3 s-1`. Test xác nhận model version, warning, SOR verification, artifact, summary, slice
và profile. Đây là smoke tích hợp thật của lifecycle; kết quả khoa học production vẫn phải
đến từ B5.

```powershell
cd app
npm run test:e2e -- --runInBand
```

## Trạng thái so với roadmap

| ID | Trạng thái | Phần còn lại |
|---|---|---|
| B2.1 | PASS | Không; input release tái lập và có provenance |
| B2.2 | PASS baseline | Không; Gaussian tiếp tục được gắn nhãn baseline |
| B3.4 | PASS benchmark nhỏ | B5.4 phải benchmark production grid riêng |
| A4.1–A4.5 | PASS smoke E2E thật | Tuần 7 vẫn cần clean-room system rehearsal |
