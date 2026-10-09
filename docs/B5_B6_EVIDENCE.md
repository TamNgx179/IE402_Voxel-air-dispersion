# B5/B6 — Bằng chứng production FV và đánh giá 3D

Ngày đo: **09/10/2026**, Windows 11, Python 3.13.3, máy demo hiện tại.
Đây là verification với dữ liệu GIS/phát thải thật, **không phải validation hiện trường**.
Không có cam kết điểm số; đóng gói sạch và báo cáo cuối vẫn thuộc tuần 7–8.

## 1. Dữ liệu và khả năng truy vết

Grid `100×100×50`, ô `5×5×2 m`, thứ tự `[z,y,x]`, EPSG:32648.
Scene gồm 62 tòa nhà LoD1 có nguồn height `gob:building_height`; 41.084 voxel solid.
Scene manifest SHA256:
`7f8728d8ac3762354e5727c217f8d1400cc6bcf397fac2471fb94240f5e2f83d`.
Kiểm checksum, đối chiếu occupancy đóng gói và raster hóa độc lập footprint/height:
**0 voxel occupancy lệch, 0 ô footprint lệch, 0 voxel mái lệch**.
Web/DB dùng cùng scene baseline, không dựng building giả.

Phát thải là EDGAR v8.1 trung bình năm theo vùng, phân bổ qua đường: proxy,
không phải traffic counts hay nồng độ quan trắc. Địa hình phẳng, mái LoD1 và lượng tử hóa
chiều cao là hạn chế. Các run height sensitivity dùng scene riêng, không nhập vào DB cảnh baseline.

`artifacts/production-study/analysis.json` lưu input hash, source hash, hash từng file mô hình,
manifest checks, runtime, số liệu và hạn chế. NetCDF/JSON/hình là generated artifacts local;
không được ngầm hiểu chúng đã được commit. Chạy lại các lệnh cuối tài liệu để tái tạo.

## 2. B5.1/B5.2/B5.4/B5.6 — Hội tụ, bảo toàn và chi phí

Hội tụ: relative L1 giữa hai mẫu cách 30 s ≤ `1e-3`, **3 lần liên tiếp sau 600 s**;
giới hạn 1.800 s. Hết giới hạn mà chưa hội tụ: exit code 3, verification fail,
NestJS không cho `succeeded`. Residual không phụ thuộc thang đơn vị nồng độ.

| Case | run_id | Thời gian thực (s) | Peak RSS (MB) | Thời gian mô phỏng (s) | Residual | Sai số mass tương đối |
|---|---|---:|---:|---:|---:|---:|
| Mùa khô | `6c58daaf-7698-4cb9-8816-fd52568d56e7` | 124,83 | 308,89 | 660,51 | 9,51e-5 | 7,84e-14 |
| Mùa mưa | `9f723ca6-c80d-4ef8-8a68-a1adfc89b24c` | 166,89 | 308,57 | 660,22 | 7,98e-5 | 1,44e-14 |
| K × 0,5 | `acd590b9-2d7e-409c-b7b5-eb1f6307df48` | 94,55 | 303,34 | 660,51 | 1,89e-4 | 7,18e-14 |
| Height × 0,8 | `249804f0-3be6-4d7e-aed5-570c8da1ef27` | 132,54 | 317,26 | 663,05 | 6,21e-5 | 7,20e-14 |
| Height × 1,2 | `c9fed6d7-8557-4411-9c79-9d447ec63325` | 152,95 | 307,48 | 660,81 | 1,15e-4 | 8,60e-14 |

Mỗi case đo một lần, không gọi là runtime p50/p95. RSS lấy mẫu cả process tree mỗi 0,1 s,
không phải bộ đếm peak chính xác của OS. Cả 5 run: CFL=0,5, wall flux=0,
mass correction=0, divergence tối đa < `4,86e-7 s⁻¹` (tolerance `1e-3`).
Ledger ghi emitted = remaining + escaped + correction + solid removal; hai số cuối bằng 0.

Production dùng CG có Jacobi preconditioner cho cùng hệ Poisson mass-consistent;
SOR vẫn là reference. Transport dùng CSR tiền tính cho **cùng FV explicit upwind + diffusion**,
không thay thành implicit/CFD. Regression so corrected faces CG/SOR và 100 bước
CSR/direct faces, cả nồng độ lẫn mass ledger. Tên gate legacy `sor_convergence`
được giữ tương thích; detail/metrics ghi phương pháp thực là `cg`.

## 3. B5.3 — Khuếch tán số so với vật lý

Ước lượng leading-order theo từng trục: `|u|Δ/2 × (1−|u|dt/Δ)`.
Đây là ước lượng 1D cục bộ, bỏ qua mixed terms đa chiều, không phải hiệu chỉnh K.

| Scenario | K vật lý x/y/z (m²/s) | K số p95 x/y/z (m²/s) |
|---|---|---|
| Khô | 2 / 2 / 1 | 6,217 / 2,805 / 0,377 |
| Mưa | 2 / 2 / 1 | 5,662 / 5,316 / 0,426 |

K số ngang có thể lớn hơn K vật lý: phải nêu bias làm nhòe plume, không tuyên bố
đã grid-converged. Xem [phân tích modified equation của LeVeque](https://faculty.washington.edu/rjl/classes/am574w2011/lectures/am574lecture7nup3.pdf).

## 4. B6.1–B6.4 — Scenario, baseline và đóng góp 3D

| Scenario | Mean ở yêu cầu 1,5 m (µg/m³) | Mean ở 15 m (µg/m³) | MAE FV–Gaussian (µg/m³) | RMSE FV–Gaussian (µg/m³) |
|---|---:|---:|---:|---:|
| Khô | 0,20046 | 0,06283 | 0,01187 | 0,03244 |
| Mưa | 0,19712 | 0,06394 | 0,01135 | 0,03518 |

Yêu cầu 1,5 m lấy ô chứa cao độ, tâm 1 m; 15 m có tâm 15 m.
Mean tính trên air cells của tầng, không tính voxel solid như không khí sạch.
Plume centroid dịch so nguồn: khô `(-43,60; +16,39) m`, mưa `(+54,55; +52,26) m`;
cosine với downwind nền lần lượt 0,99970 và 0,99991. Đây là bulk diagnostic,
không có nghĩa mọi vector cục bộ song song gió nền.
Gaussian dùng cùng emission/grid nhưng giả thiết wind/diffusion khác; **không phải ground truth**.

Thay cả K ngang/dọc ×0,5: mean toàn miền +8,77%, max +43,46% so baseline khô.
Thể tích/diện tích vượt WHO/QCVN bằng 0 trong cả 5 case. Không tăng emission để tạo hình
vượt ngưỡng; steady increment từ proxy không chứng minh không khí thực tế an toàn,
và không tương đương trung bình quan trắc 24 h.

## 5. B6.5/B6.6 — Hình học, sensitivity và cross-check độc lập

Height ×0,8: mean toàn miền −3,87%, max −1,95%; height ×1,2: mean +3,77%, max +2,16%.
Giữ footprint, emission total và quy tắc source placement; **raster hóa lại height/mask**,
không chỉ đổi màu hoặc scalar trên web. Kết quả có lượng tử hóa chiều cao ô 2 m;
mean tính trên air cells, số air cells đổi theo height, không phải so cùng mask.

Đối chiếu độc lập nghiệm giải tích phương trình nhiệt `σ²=2Kt`: K=1 m²/s, t=20 s,
FV direct faces cho variance **40,0 m²**, reference **40,0 m²**, relative error 0
trong tolerance 1%. Đây là verification giải tích; **chưa có field/wind-tunnel validation**.

Hình 300 dpi được tạo tự động:

- `artifacts/production-study/geometry-overlay.png`: footprint và occupancy cùng tọa độ UTM.
- `artifacts/production-study/convergence.png`: residual và tolerance.
- `artifacts/production-study/vertical-comparison.png`: profile đứng FV/Gaussian.
- `artifacts/production-study/height-slices.png`: 2 mùa × 2 tầng, chung log color scale.

## 6. B6.7 — Solver wind và tích hợp thật

Artifact `wind-vectors.json` (kind `wind_vectors`) lấy trung bình corrected face `uf,vf,wf` về tâm ô,
downsample stride 5, loại solid, có run_id, units m/s, tầng k/z và tọa độ geographic.
NestJS kiểm checksum và phục vụ qua artifact endpoint; schema/migration chấp nhận kind
`wind_vectors`. Web có **hạt/mũi tên chuyển động lấy mẫu trường solver**, seed ở tầng
đang xem, có w và chặn solid/domain. Hiển thị tăng tốc ×6, không phải PM2.5 particle solver.
Pause/reduced-motion giữ hình tĩnh. Vector downsample/interpolation chỉ dùng trực quan,
không thay face flux trong phép tính FV. HUD là trung bình mẫu của tầng, units m/s thật.
Run cũ thiếu artifact sẽ hiện chưa có vector, không fallback sang gió nền giả solver.

Hai baseline được nhập PostGIS bằng verifier/persistence chung. Run từ nút Chạy trên web:
`5063d58a-38fd-48d8-bdfd-1619c1a1ba5d` đã `succeeded`, tự chọn kết quả mới và mở lại nút.
Benchmark DB trên FV khô: slice p50/p95 31,60/34,68 ms; exceedance 42,11/53,20;
profile 0,96/1,66; summary 59,07/65,19. Xem [QUERY_EVIDENCE.md](./QUERY_EVIDENCE.md).

## 7. Tái lập và kiểm thử

Tại repository root, dùng venv đã cài dependency solver và study (`psutil`, plotting, rasterio):

```powershell
.venv/Scripts/python.exe -m src.production_study
.venv/Scripts/python.exe -m src.production_analysis
.venv/Scripts/python.exe -m pytest -q
```

Trong `app/`, migrate trước rồi import **baseline** bằng đường dẫn manifest của run vừa tạo:

```powershell
npm run db:migrate
npm run db:import-run -- "../artifacts/production-study/dry/<run_id>"
npm run db:import-run -- "../artifacts/production-study/wet/<run_id>"
npm run build
npm run lint
npm test
npm run test:e2e
```

Importer từ chối failed/non-steady run, geometry khác baseline, checksum lỗi hoặc run trùng;
không ghi đè artifacts hiện có. Đã thử nhập lại baseline và nhập height-low: cả hai bị
từ chối trước persistence đúng yêu cầu. `.env.example` vẫn dùng mock cho development an toàn;
đặt `SOLVER_MODE=real` trong `.env` local rồi restart app để nút Chạy gọi production solver.
`config/project.yaml` chốt steady-state/CG/CSR; không có Python microservice.

Unit/API E2E: 88 pass + 1 skip / 42 pass. Full Python: 218 pass, 9 skip sau bổ sung
regression convergence. Có warning ABI NumPy/netCDF và deprecation xarray trên venv hiện
tại; chưa chuẩn hóa môi trường sạch, không đồng nghĩa test thất bại. Các test raw OSM không có raw cache bị skip; scene đóng gói được
audit checksum và raster hóa độc lập ở trên. Clean-room Compose, release parameter freeze,
final report/evidence index vẫn cần thực hiện ở B7/B8 và A7/A8.
