# ROADMAP — 10 mốc tuần, 2 người, ứng dụng web GIS 3D

**Ràng buộc:** 2 người · giữ mã 10 mốc tuần để truy vết · một study area · PM2.5 · chạy được trên
laptop. Kế hoạch không có gói seminar; thời gian được dùng cho API, cơ sở dữ liệu, tích hợp,
kiểm thử và báo cáo cuối kỳ.

**Điều chỉnh ngày 19/10/2026:** giữ tuần 1–7; đưa hai tuần nâng cấp vào tuần 8–9;
chuyển công việc chốt báo cáo, demo và release từ tuần 8 cũ sang tuần 10.
Mã task hiện hành theo tuần thực hiện: A8/B8 = nâng cấp đợt 1, A9/B9 = nâng cấp
đợt 2, A10/B10 = bàn giao. Các trao đổi/tài liệu trước điều chỉnh có thể dùng mã cũ;
tra cứu công việc theo tên và bảng hiện hành dưới đây. Không thay đổi trạng thái
hoàn thành của tuần 1–7; trạng thái nâng cấp xem bảng cập nhật theo từng task.
**Rà soát 27/10/2026:** ưu tiên đáp ứng đề bài và chất lượng, không khóa phần nâng cấp
trong 10 ngày. Mốc 9 được chia các đợt theo phụ thuộc ở dưới; chốt lịch sau pilot của B
và benchmark của A. Giữ lịch sử hoàn thành, không tự đóng task chỉ vì cập nhật tài liệu.
Tham chiếu yêu cầu/ca kiểm thử: spec §4–6. Đề bài không bắt buộc LoD2.

| Nhóm việc trong bản kế hoạch trước | Vị trí/mã hiện hành |
|---|---|
| Tuần 9 cũ: comparison, polygon, thiết kế nghiên cứu | Tuần 8: A8.1–A8.4, B8.1–B8.4 |
| Tuần 10 cũ: giảm nguồn, export, kết quả nghiên cứu | Tuần 9: A9.1–A9.2, B9.1–B9.3 |
| Tuần 8 cũ và các task bàn giao trùng ở tuần 10 cũ | Gộp về tuần 10: A10.1–A10.5, B10.1–B10.4 |

Quy ước trạng thái:

- ✅ Đã có trong repository hoặc đã kiểm tra được.
- 🟡 Đã có một phần nhưng chưa đạt contract sản phẩm cuối.
- ⬜ Chưa thực hiện.
- ✂️ Cắt khỏi phạm vi.

---

## 1. Sản phẩm cuối

Một ứng dụng web GIS 3D cho phép người dùng chọn khu vực/kịch bản, yêu cầu mô phỏng, theo
dõi trạng thái và xem nồng độ PM2.5 theo độ cao. Hệ thống đích:

```text
Web GIS 3D → NestJS modular monolith → PostgreSQL/PostGIS
                                      → Python solver subprocess
                                      → local NetCDF/JSON artifacts
```

| Mã | Tính năng | Người sở hữu | Bắt buộc | Trạng thái hiện tại |
|---|---|---|---|---|
| `P1` | Dựng cảnh đô thị 3D từ footprint, chiều cao, đường, sông/công viên thực | B chuẩn bị dữ liệu, A render web | Có | ✅ scene DB/API/render và audit độc lập footprint/height/voxel: 0 mismatch |
| `P2` | PostgreSQL/PostGIS, migration và seed | A | Có | ✅ Docker DB healthy; migrate/seed thật đã kiểm tra |
| `P3` | NestJS modular monolith cho web, API, persistence và simulation orchestration | A | Có | ✅ module/controller/service/DTO và test đã có |
| `P4` | Internal executor và trạng thái `queued/running/succeeded/failed` | A | Có | ✅ real solver smoke qua API → executor → Python → PostGIS đã `succeeded` |
| `P5` | Python CLI chạy pipeline theo `run_id`, được monolith spawn nội bộ | B, A tích hợp | Có | ✅ production 500.000 voxel hội tụ; nút Chạy web → real solver → DB đã thành công |
| `P6` | Trường gió mass-consistent + FV transport | B | Có | ✅ corrected faces + explicit FV, 5 production cases qua verification |
| `P7` | Lát cắt theo z, exceedance, profile và summary query | A | Có | ✅ API, E2E, EXPLAIN và benchmark 500.000 voxel đã có |
| `P8` | Web 3D có camera 2D/3D, height slider, scenario, threshold, profile và lớp gió | A | Có | ✅ UI/API production FV, vector solver theo run/tầng; còn nghiệm thu release cuối tuần 10 |
| `P9` | Verification và provenance theo từng run | B | Có | ✅ B5/B6 có convergence, gates, checksum, input/source hash và sensitivity; release freeze ở B7 |
| `P10` | Docker/demo, runbook, báo cáo và số liệu cuối | A + B | Có | 🟡 Docker/runbook/draft và evidence candidate tuần 7 đã có; final release tuần 10 còn lại |

### Công nghệ

| Lớp | Công nghệ chốt | Lý do |
|---|---|---|
| Web | MapLibre + deck.gl | Dựng nhà LoD1 đúng footprint/height, lớp đường–nước–cây xanh và nồng độ theo z |
| API | NestJS + TypeScript | Module/controller/service/DTO rõ, thuận tiện OpenAPI và test |
| DB | PostgreSQL + PostGIS | Bắt buộc có DB/query; hỗ trợ geometry, GiST và spatial predicates |
| Điều phối run | `SimulationModule` + bảng `simulation_runs`, concurrency=1 | Không cần broker/queue service |
| Solver | Python CLI + NumPy/SciPy/xarray, gọi bằng child process | Tái sử dụng lõi mô phỏng mà không thành service riêng |
| Artifact | NetCDF cho tensor; JSON/GeoJSON/Parquet cho web | Không ép PostGIS chứa toàn bộ tensor |
| Đóng gói | Một app container + PostgreSQL bằng Docker Compose | Monolith đơn giản, dễ demo và tái lập |

### Yêu cầu cảnh đô thị 3D dựa trên thực tế

Web không dùng các khối nhà minh hoạ đặt thủ công. Cảnh 3D phải được dựng từ cùng bộ dữ liệu
GIS mà voxeliser sử dụng, để hình học mô phỏng và hình học người dùng nhìn thấy không lệch nhau.

| Lớp cảnh | Nguồn/thuộc tính | Cách dựng | Người phụ trách |
|---|---|---|---|
| Toà nhà | OSM footprint + Open Buildings/OSM `height` | Extrude LoD1 theo `height_m` | B chuẩn hoá, A render |
| Đường | OSM centerline + `highway` | Line layer theo cấp đường | B chuẩn hoá, A render |
| Sông/mặt nước | OSM polygon/line | Polygon đúng vị trí | B chuẩn hoá, A render |
| Công viên/cây xanh | OSM landuse/leisure/natural | Polygon lớp phủ | B chuẩn hoá, A render |
| Nền địa lý | MapLibre basemap | Kiểm tra CRS và alignment | A |
| Nồng độ/gió | Output đúng `run_id` | Voxel/slab và luồng gió dạng vệt mềm chuyển động từ solver theo tầng, có pause; thiếu artifact không vẽ giả | B xuất vector, A render |

MVP dùng toà nhà **LoD1**: footprint thực và mái phẳng theo chiều cao dữ liệu.
Vật liệu sáng và cửa sổ được ghi rõ là minh họa; không dùng texture ảnh thật,
không sửa geometry solver. Địa hình vẫn phẳng `z=0` và phải được ghi là hạn chế.

### Luồng dữ liệu ra web

![Kiến trúc modular monolith](./img/architecture-monolith.svg)

1. Web gửi `POST /runs`.
2. `SimulationModule` validate, ghi run `queued` và trả `202`.
3. Internal executor tuần tự hoá run và spawn Python CLI bằng arguments whitelist.
4. Python ghi NetCDF/manifest; monolith kiểm exit code, verification và persist metrics/slices.
5. Web poll status rồi gọi API để lấy layer/query kết quả.

### Đã cắt gì để giữ đúng đường găng

| Cắt | Lý do | Thời gian giữ lại |
|---|---|---:|
| Auth nhiều vai trò/multi-tenant | Không đóng góp vào câu hỏi GIS 3D | 2–3 người-ngày |
| CFD/RANS/LES | Vượt khả năng tính toán và lịch | Trên 10 người-ngày |
| Chemistry/NO₂ | Cần mô hình phản ứng và dữ liệu mới | 4–6 người-ngày |
| Kubernetes/cloud production | Docker Compose đủ cho demo | 2–3 người-ngày |
| Volume ray-marching hoàn chỉnh | Height slice/voxel layer đã chứng minh được 3D | 2 người-ngày |
| WorldPop/exposure nâng cao | Chỉ làm sau khi MVP ổn định | 1–2 người-ngày |

---

## 2. Bản đồ tổng thể

Tuần 1–7: nền tảng → Tuần 8: comparison/polygon → Tuần 9: nghiên cứu/export → Tuần 10: release.

Sơ đồ 8 tuần cũ không còn là lịch thực hiện hiện hành; bảng mốc bên dưới là chuẩn.

| Mốc | Cuối tuần | Kết quả phải có | Điều kiện qua mốc |
|---|---:|---|---|
| `M0` | 1 | Contract monolith–Python CLI, ERD, skeleton ứng dụng | Hai người thống nhất command/manifest schema |
| `M1` | 2 | DB dựng sạch, data seed, pipeline input reproducible | Migration + seed chạy trên máy mới |
| `M2` | 3 | API tạo run mock; FV 2D verification xanh | Có `run_id`, CFL/mass tests đạt |
| `M3` | 4 | Run thật đi HTTP → monolith → Python subprocess → artifact | Một run end-to-end không thao tác tay |
| `M4` | 5 | Kết quả 3D query được qua PostGIS/API | Slice/exceedance/profile/summary đúng |
| `M5` | 6 | Web 3D đọc API, hai scenario chạy được | Không còn đọc trực tiếp file nội bộ |
| `M6` | 7 | Demo ổn định, integration tests, số liệu báo cáo | Chạy lại từ DB rỗng và tạo kết quả |
| `M7` | 8 | So sánh hai run, phân tích polygon, pilot nghiên cứu lưới | API/SQL/web và fixture khớp; thiết kế thí nghiệm tái lập |
| `M8` | 9 (nhiều đợt) | Nghiên cứu lưới, mặt cắt đứng, export và LoD render ổn định | XG-3/6/7 và regression đạt, kết luận đúng mức; khóa phạm vi tính năng |
| `M9` | 10 | Báo cáo cuối, demo máy thứ hai và release | QG/XG bắt buộc đạt; đủ bộ bàn giao và phương án dự phòng |

### Cổng chất lượng mục tiêu 9+

Hoàn thành task không đồng nghĩa tự động đạt cổng. Release chỉ được gọi là hoàn thành khi tất
cả điều kiện dưới đây có bằng chứng lưu trong repository/artifacts:

Đây là cổng chất lượng nhóm chọn để hướng tới bài làm tốt; điểm cuối do giảng viên chấm,
không phải cam kết 9+. Chỉ dùng tên “đạt” sau khi có kết quả thực và review đúng người.

| Gate | Bằng chứng bắt buộc | Nếu chưa đạt |
|---|---|---|
| `QG-1` Đúng đề tài | FV voxel 3D là kết quả chính trên web; Gaussian chỉ là baseline | Không release |
| `QG-2` Đúng số trị | Transport dùng corrected face velocities của wind; divergence của chính flux transport dưới tolerance | Không công bố kết quả |
| `QG-3` Không che lỗi | Không clip nồng độ âm trước kiểm tra; mass correction bằng 0 hoặc được định lượng | Run `failed` |
| `QG-4` Verification | CFL, divergence, positivity, wall flux, mass budget và nghiệm giải tích đều pass | Run `failed` |
| `QG-5` DB/query thật | Migration/seed, 4 query endpoint và `EXPLAIN ANALYZE` có bằng chứng | Chưa đạt yêu cầu DB |
| `QG-6` GIS 3D thật | Web/DB/voxel dùng cùng footprint, height, CRS; scene có provenance và QA | Không dùng hình demo làm kết quả |
| `QG-7` Đánh giá bất định | Sensitivity chiều cao + ít nhất một external benchmark/cross-check | Chỉ được tuyên bố verification nội bộ |
| `QG-8` Tái lập | Máy sạch chạy seed → run → query → web bằng runbook/Compose | Chưa đóng gói |
| `QG-9` Nhất quán tài liệu | Threshold, units, version và số liệu giống nhau giữa config, DB, web, report | Không chốt báo cáo |
| `QG-10` Bằng chứng 3D | Có số liệu chênh lệch theo z, profile đứng và exceedance volume | Chưa chứng minh đóng góp 3D |

---

## 3. Phân vai

| | **Người A — Monolith, Web, DB và tích hợp** | **Người B — Dữ liệu GIS 3D, mô hình và Python solver** |
|---|---|---|
| Sở hữu | Toàn bộ NestJS modular monolith, PostgreSQL/PostGIS, migration, query, web renderer, Docker và adapter gọi Python subprocess | Thu thập/chuẩn hoá dữ liệu cảnh 3D, voxel, emission, wind, FV transport, Gaussian, verification, benchmark |
| File/thư mục đích | `app/`, `db/`, `docker-compose.yml` | `src/`, `tests/`, `config/`, solver CLI |
| Đầu ra chính | API contract, ERD, migrations, query plans, UI và demo | Scene package có provenance, NetCDF, manifest, metrics và kết quả khoa học |
| Phần báo cáo | Kiến trúc, DB/query, dữ liệu GIS, web và kết quả trực quan | Phương pháp, phương trình, verification và hạn chế |

**Ranh giới trách nhiệm:** A chịu toàn bộ API/web/DB/integration. B chịu dữ liệu GIS nguồn và
pipeline biến dữ liệu thật thành building/road/water/green layers cùng voxel/model. B không làm
frontend hoặc NestJS; A không sửa geometry khoa học hay phương trình khi chưa có review của B.

### Hợp đồng B → A

Python solver CLI nhận `run_id` và đường dẫn/snapshot cấu hình từ `SimulationModule`, sau đó tạo:

```text
artifacts/<run_id>/
├── concentration.nc
├── wind.nc
├── columns.csv.gz
├── metrics.json
├── manifest.json
└── solver.log
```

`manifest.json` bắt buộc có `run_id`, `model_version`, `input_hash`, scenario, grid, units,
artifact checksum, warnings và verification status. A chỉ đánh dấu run `succeeded` khi manifest
hợp lệ, subprocess thoát thành công và B trả verification pass.

---

## 4. Tiến độ thực tế tại thời điểm lập kế hoạch (lịch sử)

Các khoảng trống trong mục này là baseline lúc lập kế hoạch, không phải danh sách thiếu
hiện tại. Trạng thái hiện hành xem từng task tuần 8–10; không suy ra API/DB chưa có từ bảng cũ.

### Kết quả đã đạt được

| Nhóm việc | Kết quả đang có | Mức dùng lại |
|---|---|---|
| Geometry/voxel | Pipeline footprint, height, rasterisation, NetCDF | Cao |
| Emission | Road processing, rasteriser, EDGAR normalisation, assumptions | Cao |
| Gaussian | Baseline và hình minh hoạ | Cao |
| Wind/transport | Module, notebook debug và test verification | Trung bình; cần nối run contract |
| Analysis | Slices, morphology, figures, web export | Cao |
| Web | Viewer deck.gl/MapLibre đọc dữ liệu tĩnh | Trung bình; phải chuyển sang API |
| API | Chưa có NestJS application | Chưa có |
| Database | Chưa có PostgreSQL/PostGIS schema/migration | Chưa có |
| Monolith–Python integration | Pipeline CLI có nhưng chưa có subprocess lifecycle | Thấp |

### Khoảng trống bắt buộc đóng

| Mã | Khoảng trống | Người | Hạn |
|---|---|---|---:|
| `G1` | Chưa có ERD/schema/migration PostGIS | A | Tuần 2 |
| `G2` | Chưa có API và DTO | A | Tuần 3 |
| `G3` | Chưa có state machine và internal executor | A | Tuần 4 |
| `G4` | ✅ Solver CLI thật nhận `run_id`, chạy wind→FV và ghi manifest chuẩn; còn production-grid ở G5/B5 | B | Tuần 4 |
| `G5` | FV 3D chưa trở thành output chính của web | B + A | Tuần 6 |
| `G6` | Spatial query chưa có query plan/index evidence | A | Tuần 5 |
| `G7` | Chưa có integration test seed → run → query → web | A + B | Tuần 7 |
| `G8` | Chưa có release/runbook/bộ số liệu cuối | A + B | Tuần 10 |

### Câu hỏi bảo vệ cần có kết quả định lượng

| Câu hỏi | Bằng chứng cần tạo | Người |
|---|---|---|
| Vì sao cần 3D thay vì bản đồ 2D? | So sánh lát 1,5 m, 15 m và profile đứng | A + B |
| Mô hình có bảo toàn và ổn định không? | CFL, divergence, mass balance, analytic tests | B |
| DB được dùng để làm gì? | ERD, 4 query endpoint, `EXPLAIN ANALYZE` | A |
| Vì sao không lưu toàn bộ voxel vào DB? | Benchmark/giải thích hybrid PostGIS + NetCDF | A |
| Kết quả đáng tin tới đâu? | Verification, sensitivity, limitations; không tuyên bố validation | B |

---

## 5. Giai đoạn 1 — Nền tảng và run end-to-end

### Tuần 1 — Chốt contract, ERD và baseline → M0

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A1.1` | Vẽ user flow create run → status → result | `docs/user-flow.md` hoặc sơ đồ trong architecture | Bao phủ success/failure/retry |
| `A1.2` | Thiết kế ERD PostGIS | ERD + data dictionary | Có PK/FK/SRID/index dự kiến |
| `A1.3` | Scaffold NestJS modular monolith | Application skeleton | `/health` chạy, phục vụ web và có config validation |
| `A1.4` | Chốt DTO/API endpoints | OpenAPI draft | Khớp `spec.md` |
| `A1.5` | Chốt single source of truth cho threshold/units | Config + DB seed contract | QCVN/WHO không mâu thuẫn giữa research, config và web |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B1.1` | Chạy lại pipeline hiện tại | Log + danh sách dependency | Xác định bước chạy được/bước lỗi |
| `B1.2` | Chốt Python CLI input/output contract | JSON schema/typed model | Có `run_id`, config, manifest, metrics và exit code |
| `B1.3` | Chốt tên mô hình và giới hạn | Đoạn phương pháp cho report | Không gọi Röckle đầy đủ/CFD |
| `B1.4` | Kiểm kê dữ liệu dựng cảnh 3D thực tế | Bảng layer/source/license/coverage | Có footprint, height, road, water, green và provenance |
| `B1.5` | Chọn external benchmark/cross-check khả thi | Benchmark plan + metric | Có dataset/case, cách chạy và giới hạn tuyên bố |

**Kết quả tuần 1:** ERD, API contract và Python CLI contract được review chéo; `/health` chạy;
pipeline hiện trạng có log tái lập. Nếu chưa thống nhất contract thì chưa sang tuần 2.

### Tuần 2 — Database, dữ liệu và reproducibility → M1

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A2.1` | Dựng PostgreSQL/PostGIS | Docker service | Healthcheck xanh |
| `A2.2` | Viết migration các bảng lõi | Migration files | Up/down hoặc rebuild sạch được |
| `A2.3` | Tạo GiST/B-tree indexes | Migration + query kiểm tra | Index tồn tại đúng cột |
| `A2.4` | API read-only study areas/scenarios | Endpoints + tests | Trả geometry/metadata đúng schema |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B2.1` | Chuẩn hoá voxel/emission input | NetCDF + manifest | `[z,y,x]`, units, CRS đầy đủ |
| `B2.2` | Chạy Gaussian baseline | Baseline artifact | Có hai scenario để so sánh |
| `B2.3` | Đóng gói config loader | Python solver CLI | Không hard-code grid/path |
| `B2.4` | Chuẩn hoá scene package và seed input | GeoJSON/Parquet + metadata | Building/road/water/green cùng CRS, counts và provenance |

**Kết quả tuần 2:** từ DB rỗng có thể migrate + seed bằng scene package của B; API đọc study
area/scenario; dữ liệu toà nhà, đường, mặt nước và cây xanh cùng CRS, có provenance; B tạo được
input artifacts và Gaussian baseline.

**Trạng thái 07/10/2026:** B2.1 và B2.2 PASS. Input `100×100×50` được tái dựng từ scene đã
khóa checksum, chuẩn hóa bằng EDGAR v8.1 chính thức và hai Gaussian baseline đã được chạy lại.
Cách kiểm tra và giới hạn tuyên bố ở README (chạy/test) và spec §5–6 (ca kiểm thử).

### Tuần 3 — Run API và verification 2D → M2

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A3.1` | `POST /runs` + DTO validation | Endpoint + tests | Trả `202` và `run_id` |
| `A3.2` | `GET /runs/:id` | Status endpoint | Trả progress/error/metrics schema |
| `A3.3` | Internal executor và DB state transition | Service tests | Concurrency=1; không chạy trùng một `run_id` |
| `A3.4` | Mock subprocess integration | Fake completed run | UI/API flow test được trước solver thật |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B3.1` | Verify advection 2D | Tests/plots | Blob đi đúng `u·t` trong tolerance |
| `B3.2` | Verify diffusion 2D | Tests/metrics | `σ²=2Kt` trong tolerance chốt |
| `B3.3` | Kiểm CFL, positivity, mass balance | Test suite | Không clip âm để che lỗi |
| `B3.4` | Benchmark nhỏ | Bảng runtime/memory | Có số đo, không ước lượng miệng |
| `B3.5` | Bỏ clipping che lỗi positivity | Solver + regression test | Kiểm tra giá trị âm trước correction; fail nếu vượt tolerance |

**Kết quả tuần 3:** API tạo và hoàn tất mock run; solver 2D vượt verification gate; metrics
schema đã ổn định để A lưu vào DB.

**Trạng thái 07/10/2026:** B3.4 PASS trên real solver: fixture 9.216 voxel, ba lần chạy,
wall-clock median 3,2222 s và peak RSS 111,8164 MB. Đây là benchmark nhỏ; B5.4 vẫn phải đo
production grid.

### Tuần 4 — Python subprocess thật và pipeline end-to-end → M3

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A4.1` | `SimulationModule` và subprocess lifecycle | Integration service | `queued→running→succeeded/failed` |
| `A4.2` | Timeout, restart recovery và retry policy | State transition tests | Không để run `running` vô hạn |
| `A4.3` | Artifact + metrics persistence | DB records | Checksum/path/manifest truy xuất được |
| `A4.4` | Error mapping/log retrieval | API response | Lỗi Python process không thành HTTP 500 mơ hồ |
| `A4.5` | Lưu verification gate theo run | DB/API fields | Run chỉ `succeeded` khi toàn bộ gate pass |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B4.1` | Solver CLI nhận `run_id` | Command/module | Chạy không cần thao tác tay |
| `B4.2` | Mass-consistent wind 3D | `wind.nc` + metrics | Divergence dưới tolerance |
| `B4.3` | Ghi manifest/metrics/log | Artifact bundle | Đúng contract tuần 1 |
| `B4.4` | Failure exit codes | Test case lỗi | API phân biệt input/model/system error |
| `B4.5` | Xuất corrected face velocities | `uf`, `vf`, `wf` contract + tests | Transport dùng đúng face flux đã được kiểm divergence |

**Kết quả tuần 4:** một request thật được modular monolith điều phối và spawn Python subprocess, tạo artifact và metrics,
sau đó xem lại bằng `GET /runs/:id`. Đây là cổng quyết định quan trọng nhất.

**Trạng thái 07/10/2026:** A4 PASS ở mức real E2E smoke: `POST /runs` đi qua NestJS,
PostGIS, Python wind/FV, manifest verification rồi query lại artifact/summary/slice/profile.
B1–B4 đã có real CLI smoke 3D, corrected face velocities, verification manifest và exit-code
regression test; cách tái lập ở README (chạy/test) và spec §5–6 (ca kiểm thử).
Không suy diễn smoke run thành production result: dữ liệu EDGAR local, production grid và
steady-state vẫn thuộc B5.

---

## 6. Giai đoạn 2 — Query, web, đánh giá và đóng gói

### Tuần 5 — FV 3D và truy vấn PostGIS → M4

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A5.1` | Persist concentration slices/summaries | Importer + schema | Không nhân đôi khi retry |
| `A5.2` | Slice endpoint | `/runs/:id/slices` | Filter đúng `z_m`/bbox |
| `A5.3` | Exceedance endpoint | `/exceedance` | Threshold và units rõ |
| `A5.4` | Profile + summary endpoint | `/profile`, `/summary` | Trả đúng trục z và aggregates |
| `A5.5` | Đo query plan | File SQL/report | Có `EXPLAIN (ANALYZE, BUFFERS)` |
| `A5.6` | Benchmark DB ở kích thước demo | Bảng latency/storage | Query chính có p50/p95 và không full-scan ngoài chủ ý |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B5.1` | Chạy FV 3D tới steady state | `concentration.nc` | Có stopping criterion |
| `B5.2` | Mass budget toàn run | Metrics | emitted≈remaining+escaped |
| `B5.3` | Numerical diffusion estimate | Bảng kết quả | Đặt cạnh physical K |
| `B5.4` | Benchmark production grid | Runtime/memory | Có số đo trên máy demo |
| `B5.5` | Đối chiếu geometry web với voxel mask | QA report + overlay | Footprint/height/occupancy không lệch CRS hoặc đảo trục |
| `B5.6` | Verification trên production grid | Gate report theo run | Face divergence, mass budget, positivity và wall flux pass |

**Kết quả tuần 5:** output chính là FV voxel 3D, không còn chỉ Gaussian; bốn loại query DB
trả kết quả đúng và có bằng chứng index/query plan.

**Trạng thái 09/10/2026 — A5.1–A5.6:** triển khai và kiểm thử phần A đã hoàn tất:
retry không nhân đôi cột/metrics; slice dùng ô chứa cao độ, kiểm bbox và threshold;
profile/summary/exceedance đối chiếu DB trong real Python E2E. Web lấy thống kê và profile
chính xác từ API, không tính lại từ uint8 dùng để render. Benchmark 500.000 voxel có
20 mẫu/query, provenance và EXPLAIN; xem `DATABASE.md`. UI đã rút gọn thao tác chính,
dùng icon SVG và bảng màu nhẹ. Benchmark ban đầu dùng synthetic;
đã bổ sung benchmark trên production FV thật và nhập hai baseline khô/mưa vào PostGIS.

**Trạng thái 09/10/2026 — B5.1–B5.6:** hoàn tất trên 5 production cases 500.000 voxel.
Hội tụ 660–663 s mô phỏng, wall-clock 94,55–166,89 s, RSS 303–317 MB; mọi gate pass.
Audit scene/voxel độc lập 0 mismatch; có ước lượng K số cạnh K vật lý và mass ledger.
Chi tiết kiểm thử và lệnh tái lập: [README – chạy và kiểm thử](../README.md); phương pháp: [RESEARCH.md](./RESEARCH.md).

### Tuần 6 — Web 3D đọc API và so sánh scenario → M5

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A6.1` | Chuyển viewer từ file tĩnh sang API | API client | Không đọc `web/data/*.js` làm nguồn chính |
| `A6.2` | Render cảnh đô thị thực tế | Building/road/water/green layers | Nhà extrude đúng footprint/height, các lớp khớp basemap |
| `A6.3` | Height slider + legend | UI | Layer đổi đúng `z_m` |
| `A6.4` | Scenario/run selector + threshold | UI/map layer | Đổi run không trộn dữ liệu, hiện units |
| `A6.5` | Profile đứng và summary panel | Chart/panel | Click điểm trả profile đúng |
| `A6.6` | Đặt FV làm kết quả mặc định | UI + API integration test | Viewer mặc định dùng `model=fv`; Gaussian chỉ là comparison toggle |
| `A6.7` | Camera và lớp gió | Nút xoay/reset/2D–3D + wind overlay | Xoay bằng chuột/nút; gió nền ghi rõ nguồn; hỗ trợ reduced motion |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B6.1` | Chạy hai wind scenarios | Hai artifact bundles | Plume đổi hướng hợp lý |
| `B6.2` | So sánh FV với Gaussian | Tables/figures | Gắn nhãn model rõ ràng |
| `B6.3` | So sánh lát yêu cầu 1,5 m (tâm1 m) và 15 m | Figure/metrics | Định lượng chênh lệch theo dữ liệu, kể cả nhỏ/0, không ép một chiều tăng/giảm |
| `B6.4` | Sensitivity tối thiểu | Bảng sensitivity | Một tham số chính được thay đổi |
| `B6.5` | Xuất scene manifest và kiểm tra coverage | Manifest + QA figures | Mọi feature hiển thị truy được nguồn; không có building đặt tay |
| `B6.6` | Sensitivity chiều cao và benchmark/cross-check | Tables/figures | Kết luận chính không dựa vào một bộ height duy nhất; claim đúng mức bằng chứng |
| `B6.7` | Xuất trường gió web | Artifact/API `u,v,w` downsampled | Vector gắn đúng `run_id`, cao độ và solid mask; không dùng metadata gió nền thay cho kết quả solver |

**Kết quả tuần 6:** web dựng lại study area bằng footprint và chiều cao thực, có đường, mặt
nước/cây xanh nếu nguồn tồn tại; cảnh khớp basemap và voxel mask. Người dùng tạo/chọn run,
kéo height slider, đổi scenario, xem threshold, profile và summary hoàn toàn qua API.

**Trạng thái 09/10/2026 — B6.1–B6.7:** hoàn tất hai mùa, FV–Gaussian, lát 1,5/15 m,
K×0,5, height±20%, provenance/geometry QA và vector corrected `u,v,w` qua artifact API.
Cross-check độc lập bằng nghiệm giải tích phương trình nhiệt (variance 40 m², sai số 0
trong tolerance 1%); đây là verification, không phải validation quan trắc/wind tunnel.
Hình 300 dpi và bảng số liệu được sinh từ manifests; xem [README – chạy và kiểm thử](../README.md).
Web ưu tiên FV thật; nút Chạy đã hoàn tất production run tự động. Không dùng fake wind.
Clean-room candidate thuộc tuần 7; final report/release freeze thuộc mốc tuần 10 theo lịch mới.

### Tuần 7 — Kiểm thử tích hợp, dashboard và báo cáo kết quả → M6

**Cập nhật 12/10/2026:** A7.1 đã bổ sung retry bootstrap/result/query, tiếp tục polling
sau mất kết nối, mở khóa session khi saved run 404, không tự retry POST tạo run.
Test request/state và thao tác browser được ghi ở README và spec §5–6.
Theo lựa chọn mới, bỏ pilot ảnh Sunwah; dùng vật liệu/cửa sổ sáng minh họa,
giữ footprint/height GIS. Gió đổi từ mũi tên sang vệt mềm theo trường solver,
không thêm xoáy/turbulence giả. Ảnh pilot cũ lưu local ngoài web để có thể khôi phục.
A7.2 đã hoàn tất regression ngày 12/10/2026: required E2E 53/53 không skip,
unit 96 PASS + 1 Windows symlink skip, web 35/35; browser tạo production run thật
và query/profile thành công. Cách tái lập: [README – chạy và kiểm thử](../README.md).
Tại mốc 12/10, A7.3–A7.6 và nhóm bàn giao chưa được chốt; không đồng nhất A7.2
với clean-room A7.6. Xem cập nhật 14/10 ngay dưới cho trạng thái mới hơn.

**Cập nhật 14/10/2026 — candidate tuần 7:** A7.3–A7.6 đã có Dockerfile/Compose
đầy đủ, dashboard provenance, draft report và nghiệm thu fresh-volume thực tế.
Script dựng project riêng không mount input host, chạy hai production case qua
HTTP, kiểm checksum/queries/EXPLAIN, restart và browser. B7.1–B7.6 có full
science suite, model/config/runtime freeze, phương pháp/GIS limitations, năm
production cases, hình 300 dpi và ma trận kiểm chứng. Snapshot sinh local tại
`artifacts/week7/week7-candidate.json`; lệnh tái lập ở
[README – chạy và kiểm thử](../README.md); nội dung kiến trúc/phương pháp hiện ở ARCHITECTURE/RESEARCH. File nháp báo cáo đã bỏ theo yêu cầu.
M6 đạt mức candidate trên Docker host hiện tại. Máy vật lý thứ hai, final
report, release tag và rehearsal bảo vệ chưa chốt; theo lịch điều chỉnh sẽ làm ở tuần 10, không chốt M9.

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A7.1` | Loading/error/empty states | UI states | Python process lỗi không làm UI treo |
| `A7.2` | ✅ API e2e + DB integration tests | Required E2E + web regression | 53 E2E PASS, create/status/query/failure; xem spec §5–6 và script regression |
| `A7.3` | ✅ Docker Compose đầy đủ | Dockerfile + Compose | Một lệnh dựng monolith + PostGIS |
| `A7.4` | ✅ Kết quả dễ đọc và truy được provenance | UI + API/artifacts + regression | UI giữ units/cảnh báo cần thiết; raw version/hash/ledger đã bỏ khỏi sidebar theo yêu cầu, truy qua API/artifacts |
| `A7.5` | ✅ Viết phần kiến trúc/DB/web | Nội dung kiến trúc/DB; nháp cũ đã bỏ | Có ERD, sequence, query evidence |
| `A7.6` | ✅ Clean-room E2E rehearsal trên Docker host | Script + evidence snapshot | Fresh volumes → migrate → seed → run → query → browser; máy thứ hai tuần 10 theo lịch điều chỉnh |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B7.1` | ✅ Chạy final candidate verification suite | JUnit + snapshot | 247 Python pass, 0 skip |
| `B7.2` | ✅ Freeze model parameters | model-freeze.json + runtime lock | Mọi run cuối dùng cùng version |
| `B7.3` | ✅ Viết phương pháp và hạn chế | Nội dung phương pháp/dữ liệu ở RESEARCH; nháp cũ đã bỏ | Verification ≠ validation |
| `B7.4` | ✅ Xuất figure/table 300 dpi | Report assets + captions | Có caption, units, scenario |
| `B7.5` | ✅ Viết phần dữ liệu GIS 3D và độ tin cậy hình học | Nội dung phương pháp/dữ liệu ở RESEARCH; nháp cũ đã bỏ | Có coverage, nguồn height, clipping và flat-terrain limitation |
| `B7.6` | ✅ Lập bảng kết quả candidate 9+ | Evidence snapshot QG-1…QG-10 | Mỗi claim có run_id, metric, figure/table và limitation |

**Kết quả tuần 7:** clean-room seed → run → verification gate → query → web chạy tự động;
FV là lớp mặc định; draft báo cáo có kiến trúc, mô hình, sensitivity, external cross-check,
hạn chế và bằng chứng DB query.

### Giai đoạn nâng cấp — Tuần 8–9, phân tích và độ tin cậy

**Mục tiêu:** từ viewer mô phỏng thành công cụ so sánh kịch bản và phân tích vùng
GIS 3D; tăng độ tin cậy số trị, không thêm microservice, auth nhiều vai trò, texture
thật hoặc hiệu ứng làm thay đổi ý nghĩa khoa học. A tiếp tục sở hữu API/web/DB,
B sở hữu phương pháp/dữ liệu/solver. Tuần 10 mới chốt release; hoàn thành nâng cấp không tự hoàn thành các task bàn giao.

**Thứ tự ưu tiên:** giữ comparison/polygon đã làm → review B và nghiên cứu lưới →
mặt cắt đứng + xuất kết quả → LoD hiển thị và QA → giảm nguồn/LoD2 có điều kiện. Kiểm máy thứ hai, báo cáo và
phương án demo dự phòng luôn phải giữ. Trong UI dùng nhóm phân tích nâng cao
thu gọn, không đưa mọi tùy chọn lên luồng xem bản đồ chính.

**Điều kiện bắt đầu:** xử lý tính tái lập checkout/freeze trước khi phát triển.
Đã sửa 57 file CRLF-only mà không đổi nội dung hay lock. Ngày 20/10,
checkout sạch commit `1d11064` với `core.autocrlf=false` khớp đủ 74 hash trên
Windows Node 22.16.0 và Linux Node 22.23.3 trong Docker (mount checkout read-only).
Đây là kiểm khác runtime/OS trên cùng host, không phải nghiệm thu máy thứ hai.

### Tuần 8 — So sánh run, phân tích vùng và thiết kế nghiên cứu → M7

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A8.1` | 🟡 Chuẩn hóa checkout/freeze và chốt contract với B | Freeze checkout sạch Windows/Linux PASS; contract và fixture ở spec | Phần chuẩn hóa của A đã xong; còn xác nhận phương pháp độc lập của B tại B8.1, không tự ký thay |
| `A8.2` | ✅ So sánh hai run trên web/API | Exact comparison, một map/camera, 3 chế độ và biểu đồ | Browser 20/10: khô–mưa, đổi 25 m, Gốc/So sánh/Chênh lệch, tự so sánh ΔC=0; số liệu production đối chiếu API |
| `A8.3` | ✅ Chọn polygon và khoảng cao độ | Vẽ trực tiếp, JSON/CSV, kết quả theo tầng | Browser 20/10: vẽ qua tòa nhà, 0–15/0–10 m, tải CSV, đổi thông số ẩn kết quả cũ, Esc/Xóa, lỗi vùng tự cắt tiếng Việt; không có nhập tọa độ theo yêu cầu |
| `A8.4` | ✅ Kiểm thử comparison và query vùng | PostGIS E2E, web regression, freeze tests, benchmark/EXPLAIN và browser QA | Đã sửa lỗi picking tòa nhà làm thoát vẽ; regression tái hiện FAIL→PASS. Đo lại SQL 500.000 voxel ngày 20/10; chi tiết spec §5–6 và DATABASE |

**Cập nhật triển khai 19/10/2026:** phương án một bản đồ, chuyển Gốc / So sánh /
Chênh lệch, không thay solver. API/CSV và tests triển khai trong Results module;
schema/input rules ở `spec.md`, cách chạy ở README và spec §5–6, benchmark ở `DATABASE.md`.
**Nghiệm thu 20/10/2026:** browser đã hoạt động; đã kiểm trực tiếp A8 và lưu ảnh
local ở `artifacts/a8-acceptance/`. Không còn lấy trạng thái browser disabled của
19/10 làm blocker hiện tại. Task B8.1 vẫn thuộc B; công thức trọng số và fixture
trong spec đã chuẩn bị để B review, chưa có xác nhận độc lập. M7 vẫn cần B8.2/B8.3;
mobile/performance release và máy vật lý thứ hai giữ ở tuần 10.

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B8.1` | ⬜ Chốt phép so sánh và thống kê vùng | Định nghĩa metrics, fixture tham chiếu cho A | Mean theo thể tích không khí; ô biên dùng diện tích giao × chiều dày giao khoảng z; loại solid; no-data khác 0; không trung bình các mean không cùng trọng số |
| `B8.2` | ⬜ Thiết kế nghiên cứu ba mức lưới và bước thời gian | Cấu hình thí nghiệm, đại lượng đánh giá, ngân sách runtime | Dùng bài toán kiểm chứng phù hợp, tách khỏi scene baseline cố định; giữ miền vật lý/nguồn/điều kiện biên và thời điểm so sánh; kiểm soát sai số thời gian để không nhầm với sai số không gian |
| `B8.3` | ⬜ Chạy pilot và kiểm tra kết quả lưới | Run manifests, sai số theo chuẩn đã chốt, runtime/memory | Mọi case qua verification; nếu dùng analytic reference phải ghi giả thiết; không thay lưới production chỉ để làm kết quả đẹp hơn |
| `B8.4` | ⬜ Thiết kế kịch bản giảm phát thải thật (có điều kiện) | Contract baseline/giảm 20%/giảm 40%, fixture | Chỉ thay hệ số nguồn, giữ các yếu tố khác; định nghĩa snapshot/hash/version và mass ledger; khác hoàn toàn slider minh họa trên web |

**Kết quả tuần 8 — M7:** so sánh cùng cao độ cho hai run và thống kê vùng chọn
có test đối chiếu SQL/giá trị tham chiếu; nghiên cứu lưới có thiết kế/pilot tái lập.
Nếu tải công việc vượt dự kiến, hoãn A9.1/B9.2 trước, không giảm test hoặc chốt
PASS cho nghiên cứu chưa hoàn thành.

### Tuần 9 — Kết quả khoa học, xuất dữ liệu và ổn định tính năng → M8

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A9.1` | ⬜ Tích hợp kịch bản giảm nguồn (có điều kiện) | Form tối giản, config snapshot, run thật và comparison | Tạo run_id mới, spawn Python qua executor hiện tại; units/provenance/gates đầy đủ; không nhân màu phía client để giả mô phỏng |
| `A9.2` | 🟡 Hoàn thiện xuất kết quả dùng cho báo cáo | CSV vùng/comparison/transect đã có; còn hoàn thiện export chung và ảnh bản đồ có chú giải | Có run IDs, cao độ yêu cầu/tâm ô hoặc khoảng z, units, legend, nguồn/attribution và trạng thái minh họa; ảnh không được ngầm coi là số liệu chính xác |
| `A9.3` | ✅ Mặt cắt đứng theo đường vẽ | DTO/schema/service/repository/controller trong Results, biểu đồ khoảng cách–z và CSV | 27/10: PostGIS E2E, web regression, browser FV thật; CSV 1.700 mẫu khớp JSON và DB. Chi tiết spec BR-46–48; review phương pháp độc lập vẫn thuộc B9.4 |
| `A9.4` | ⬜ LoD hiển thị có giảm geometry thật | Ba mức render, culling chi tiết, đo trước/sau | Spec F; TC-LOD; giảm vertices/layer data chứ không chỉ opacity; query/CSV không đổi |
| `A9.5` | ⬜ Hoàn thiện UX và thông tin chất lượng | Kết quả dễ đọc, chất lượng chiều cao/nguồn qua bảng thông tin gọn và export | TC-UX/TC-GEO; không thêm sidebar dài, không phục hồi nhập tọa độ hay bảng kỹ thuật đã bỏ; lỗi tiếng Việt, retry và stale response đúng |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B9.1` | ⬜ Hoàn tất nghiên cứu lưới/bước thời gian | Bảng sai số, đồ thị, observed order/GCI nếu phù hợp | Báo cáo cả kết quả không hội tụ; chỉ tính/diễn giải GCI khi thỏa giả thiết, không suy ra grid convergence của đô thị từ analytic case; ghi hạn chế geometry thay đổi khi raster hóa |
| `B9.2` | ⬜ Chạy baseline và giảm nguồn (có điều kiện) | Ba bundle cùng geometry/wind/K và báo cáo ΔC | Nguồn và mass ledger thay đổi đúng contract; phân biệt giả định tuyến tính với kết quả chạy; không gọi giảm emission proxy là dự báo chính sách hoặc cải thiện chất lượng không khí thực đo |
| `B9.3` | ⬜ Chốt figure/table và nội dung khoa học | Hình có caption/units, sensitivity và limitations | Số liệu sinh từ artifacts cùng version; nếu bỏ kịch bản giảm nguồn thì dùng kết quả hai mùa và lưới, không để bảng placeholder |
| `B9.4` | ⬜ Review mặt cắt, phân tích cao độ và chất lượng hình học | Fixture A9.3 đã có C=2+3z và tuyến gấp khúc; B còn review độc lập, bảng/hình theo tầng/cột và nguồn/fallback chiều cao | Không coi test của A là B ký duyệt; đối chiếu E/TC-CUT, 0/null/solid và tâm ô; kết luận theo dữ liệu kể cả khác biệt nhỏ, bàn giao phần khoa học cho A9.5/báo cáo |
| `B9.5` | ⬜ Đánh giá khả thi LoD2, chỉ triển khai khi qua cổng | Nguồn mái, giấy phép, chất lượng, quyết định làm/không làm và phương pháp đối chiếu | Spec G; TC-ROOF; không có nguồn thì giữ LoD1. Nếu đổi physics: scene/mask/run mới, không bỏ guard comparison A8 |

**Kết quả mốc tuần 9 — M8:** gói mở rộng có mặt cắt đứng, phân tích cao độ,
export tái lập, nghiên cứu sai số và LoD hiển thị đo được. LoD2/giảm nguồn được ghi rõ
đã làm hoặc hoãn có lý do; không là điều kiện ngầm. Các tính năng đủ ổn định để khóa phạm vi và chuyển
sang nghiệm thu/báo cáo cuối ở tuần 10. Không đánh dấu release tại M8.

### Tuần 10 — Báo cáo, nghiệm thu và release cuối → M9

**Người A**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `A10.1` | 🟡 Chốt seed/demo dataset và revision cố định | Demo profile, input hashes và version release | Dùng lại bundle candidate đã có; bổ sung kết quả nâng cấp, không phụ thuộc tải dữ liệu khoa học trực tiếp |
| `A10.2` | ⬜ Chốt README/runbook và kiểm máy thứ hai | Log máy khác, hướng dẫn đã thực hiện | Checkout/build/seed/run/query/web chạy trên máy vật lý thứ hai; ghi OS/runtime, không coi fresh volumes cùng host là máy khác |
| `A10.3` | ⬜ Kiểm UI, performance và demo flow | Checklist có số đo, video/screenshot dự phòng | Kiểm responsive, bàn phím, lỗi kết nối và thời gian demo; ghi cấu hình/tải đo, không coi mobile screenshot là FPS audit |
| `A10.4` | ⬜ Chốt chương kiến trúc/DB/web/kết quả | Final report và bảng query plans/benchmark | Khớp code và số liệu release, có comparison/polygon/export nếu đã nghiệm thu |
| `A10.5` | ⬜ Audit QG/XG và chốt release | Ma trận nghiệm thu local, version/tag được phê duyệt | QG-1…QG-10 và XG bắt buộc pass, đủ run_id/artifact; không tự commit/tag/push nếu người dùng chưa yêu cầu |

**Người B**

| ID | Công việc | Đầu ra | Tiêu chí đạt |
|---|---|---|---|
| `B10.1` | ⬜ Chạy/chốt release scenarios và suite cuối | Final artifacts, manifests/checksums, regression khoa học | Cùng revision sạch/config được review; freeze khớp, mọi case bắt buộc qua gate |
| `B10.2` | ⬜ Chốt bảng/hình verification và limitations | Final tables/captions từ release artifacts | Gồm nghiên cứu lưới, comparison và giảm nguồn nếu giữ; không copy số candidate khác version |
| `B10.3` | ⬜ Review toàn bộ thuật ngữ khoa học | Review notes và báo cáo đã đối chiếu | Không gọi Röckle đầy đủ/CFD/validation; không suy từ analytic grid study ra đô thị đã grid-converged |
| `B10.4` | ⬜ Chuẩn bị câu trả lời kỹ thuật và rehearsal | Q&A notes | Trả lời model choice, CFL/mass, numerical diffusion, bất định geometry, ý nghĩa 3D và DB/query |

**Cùng thực hiện:** rehearsal luồng mở web → tạo/chọn run → đổi tầng → spatial query → giải
thích model → nêu hạn chế. Chuẩn bị video/screenshot và artifact local làm phương án dự phòng.

**Kết quả tuần 10:** release candidate có tag/version, Docker/runbook, final artifacts, báo cáo
khớp code và một demo có phương án dự phòng.

Release chỉ được chốt khi `QG-1` đến `QG-10` đều có trạng thái PASS và đường dẫn bằng chứng.

### Timeline phối hợp tuần 8–10 và nghiệm thu

| Thời gian | A | B | Đầu ra/điều kiện chuyển bước |
|---|---|---|---|
| Tuần 8, ngày 1–2 | A8.1; contract comparison/polygon | B8.1–B8.2; fixture, review freeze và thiết kế nghiên cứu | Hash nhất quán; chốt dấu ΔC, trọng số vùng và ngân sách thí nghiệm |
| Tuần 8, ngày 3–5 | A8.2–A8.4; comparison/polygon và tests | B8.3; pilot lưới, đối chiếu query; B8.4 nếu đủ thời gian | M7; demo hai run và vùng chọn; quyết định giữ/hoãn giảm nguồn |
| Mốc 9, đợt 1 | A9.3 đã triển khai 27/10; phối hợp B review và hoàn thiện A9.2 từ CSV sẵn có | B9.4 review độc lập fixture của A và phương pháp, bổ sung hình/bảng; B9.1 chạy thí nghiệm sau pilot | Mặt cắt và export khớp giá trị tham chiếu, nghiên cứu không bị lẫn dt/lưới; A xong không tự đóng phần B |
| Mốc 9, đợt 2 | A9.4 benchmark/LoD; A9.5 UX/quality | B9.1 phân tích sai số; B9.3 hình/bảng, B9.5 đánh giá dữ liệu mái | Kết quả chiều cao và hiệu năng có số đo, LoD2 có kết luận khả thi |
| Mốc 9, đợt 3 tùy chọn | A9.1 sau contract B8.4, chỉ khi giữ | B9.2 hoặc pilot LoD2 khi nguồn đủ | Run thật/config/mask đúng; không dùng hiệu ứng màu thay solver |
| Cuối mốc 9 | Regression/EXPLAIN/UI và khóa phạm vi | Review độc lập, kiểm lại bảng/hình và diễn giải | M8; tất cả gate cốt lõi và nâng cấp đã chọn có kết quả, không để placeholder |
| Tuần 10 | A10.1–A10.5 | B10.1–B10.4 | M9; máy vật lý thứ hai, final report/artifacts, Q&A và demo dự phòng; tag/version chỉ theo phê duyệt |

Mỗi đợt có thể kéo dài hơn một tuần lịch; chưa có căn cứ để cam kết ngày hoàn tất.
Ước lượng lại sau B8.3 và pilot A9.3/A9.4; hai người cùng review, không chia đều chỉ bằng số task.
Tuần 10 là mốc bàn giao của tuần 8 cũ, không bổ sung tính năng sau feature freeze.
Viết nháp báo cáo và chuẩn bị runbook được làm song song; chỉ chốt bản cuối sau M8.

**Cổng nghiệm thu bổ sung:**

| Gate | Điều kiện |
|---|---|
| `XG-1` So sánh đúng | Run tương thích; định nghĩa ΔC/thang màu rõ; query chính xác và regression không trộn run |
| `XG-2` GIS/query vùng đúng | Fixture polygon/độ cao/solid khớp tính tay; trọng số thể tích được định nghĩa; CSV khớp API |
| `XG-3` Sai số được định lượng | Có nghiên cứu lưới/bước thời gian, cấu hình tái lập và kết luận đúng mức, kể cả chưa hội tụ |
| `XG-4` Giảm nguồn (nếu giữ) | Solver chạy thật với run/config/hash riêng; gates/mass ledger pass; so sánh đúng baseline |
| `XG-5` Bàn giao được | Máy thứ hai, báo cáo, demo dự phòng; QG-1…QG-10 không hồi quy và A10/B10 được chốt |
| `XG-6` Chiều đứng rõ ràng | Mặt cắt/profile/lát ngang có fixture tham chiếu, axes/units/tâm ô đúng và hình/bảng định lượng từ B9.4 |
| `XG-7` LoD hiển thị đúng nghĩa | Geometry giảm thật ở mức xa; số đo cùng môi trường trước/sau; kết quả khoa học bất biến theo zoom |

Nếu cắt kịch bản giảm nguồn thì ghi rõ A9.1/B8.4/B9.2 là **hoãn** và XG-4 là
**không thuộc phạm vi**, không đánh dấu PASS. M7/M8 chỉ hoàn thành sau kiểm tra
tính năng/nghiên cứu; M9 chỉ hoàn thành sau nghiệm thu release cuối.
Reports/hashes/logs giữ local ở `artifacts/`; kết luận nằm trong research,
test/demo và báo cáo, không tạo lại thư mục `docs/evidence/`.


---

## 7. Ngân sách

Ngân sách nền tảng theo kế hoạch 8 tuần cũ: khoảng 32 người-ngày, không tính thời gian chờ máy.
Phần bàn giao của tuần 8 cũ được chuyển sang tuần 10, không tính lại thành công việc mới.

| Hạng mục | A | B | Tổng người-ngày |
|---|---:|---:|---:|
| Contract, ERD, chuẩn dữ liệu | 2 | 2 | 4 |
| PostgreSQL/PostGIS + monolith orchestration | 6 | 1 | 7 |
| Dữ liệu GIS và scene package | 1 | 4 | 5 |
| Python solver/model/verification | 1 | 7 | 8 |
| Web 3D + query/dashboard | 4 | 0 | 4 |
| Integration, Docker, report, rehearsal | 2 | 2 | 4 |
| **Tổng** | **16** | **16** | **32** |

**Ước lượng lịch sử trước nâng cấp 27/10 (không còn là trần hiện hành):** 20 người-ngày, A/B mỗi người 10 ngày
làm việc tập trung, ngoài 32 người-ngày nền tảng. Đây không tương đương 2 tuần
bán thời gian của lịch gốc.

| Hạng mục mở rộng | A | B | Tổng người-ngày |
|---|---:|---:|---:|
| Reproducibility, contract và fixture | 1 | 1 | 2 |
| Comparison hai run và phân tích polygon | 4 | 2 | 6 |
| Nghiên cứu lưới/bước thời gian, bảng/hình | 0,5 | 3,5 | 4 |
| Kịch bản giảm nguồn (dự phòng, có thể hoãn) | 1 | 1 | 2 |
| Export, regression, máy thứ hai, báo cáo và demo cuối | 3,5 | 2,5 | 6 |
| **Tổng mở rộng tối đa** | **10** | **10** | **20** |

Nếu chỉ có thời lượng bán thời gian, ưu tiên XG-1/XG-2/XG-3/XG-5, hoãn giảm
nguồn/LoD2 và giãn lịch sau pilot; phạm vi hiện hành giữ thêm XG-6/XG-7 đã chọn, không lấy thời gian nghiệm thu/báo cáo để
bù cho tính năng mới. Không coi M6 candidate hiện tại là release đã hoàn tất.

Nếu trễ, cắt theo thứ tự: cache/concurrency nâng cao → sensitivity thứ hai → advanced 3D query → hiệu ứng
thị giác. Không cắt run lifecycle, PostGIS query, FV output, verification hoặc provenance.

---

## 8. Giả định và độ tin cậy

### Căn cứ ước lượng và điều kiện cập nhật

Không có dữ liệu để gán xác suất 75% cho lịch. Bảng ngân sách cũ chỉ giữ làm mốc so sánh,
chưa gồm A9.3–A9.5/B9.4–B9.5. Sau pilot ghi thời gian thực từng gói, chia lại tải A/B
và lịch mốc 9 trước khi cam kết; không cắt verification, DB/query hoặc chiều z để giữ lịch.

Các giả định chính:

- Docker/PostgreSQL chạy được trên máy demo.
- Production grid chạy trong thời gian chấp nhận được; tuần 3 và 5 có benchmark để xác nhận.
- Một study area và hai scenario là đủ cho câu hỏi đồ án.
- Internal executor concurrency=1 đủ cho quy mô đồ án; chưa cần broker hoặc hệ thống phân tán.
- Dữ liệu đầu vào đã có local cache để demo không phụ thuộc Internet.

### Các tầng test

| Tầng | Nội dung | Người chịu trách nhiệm |
|---|---|---|
| Unit | Toán tử số, DTO, service, query builder | A/B theo module |
| Verification | Advection, diffusion, mass, CFL, divergence | B |
| DB integration | Migration, constraints, SRID, indexes, query result | A |
| Subprocess integration | Spawn, timeout, restart recovery, retry, manifest, failure | A + B |
| API e2e | Create run, status, result endpoints | A |
| System smoke | Seed → run → query → web | A + B |
| Reproducibility | Cùng input/version cho cùng manifest và metrics hợp lý | B |

---

## 9. Quy tắc làm việc

1. Contract thay đổi phải cập nhật `spec.md`, migration/DTO và Python CLI schema trong cùng PR.
2. A sở hữu merge các thay đổi monolith/web/DB; B sở hữu merge Python solver.
3. Không truyền tensor qua JSON giữa NestJS và Python; dùng artifact path/reference.
4. Không đánh dấu `succeeded` nếu verification fail hoặc artifact thiếu checksum.
5. Mỗi cuối tuần chạy smoke test trên máy của người còn lại.
6. Kết quả báo cáo phải sinh từ release artifacts, không copy số từ run cũ không rõ version.
7. Không dùng `git add -A`, `git add .`, `git commit -a` hoặc commit secrets.

---

## 10. Những thứ dễ làm trượt lịch nhất

| Rủi ro | Dấu hiệu sớm | Van an toàn | Owner |
|---|---|---|---|
| Solver 3D chậm/không ổn định | Benchmark tuần 3/5 vượt ngân sách | Giảm domain/grid cho demo, giữ full run offline | B |
| Monolith–Python contract thay đổi liên tục | DTO/manifest sửa mỗi tuần | Freeze v1 cuối tuần 1, version contract | A + B |
| Lưu quá nhiều voxel vào PostGIS | Import/query tăng mạnh | Chỉ persist slices/summaries, tensor ở NetCDF | A |
| Web payload quá lớn | Slider lag, browser hết RAM | bbox, level query, downsample/tiling | A |
| Demo phụ thuộc Internet | Data/API ngoài timeout | Seed và artifact local cố định | A |
| Claim khoa học vượt bằng chứng | Dùng “validation/chính xác” sai | Checklist thuật ngữ và limitations | B |

---

## 11. Cấu trúc repo mục tiêu

```text
app/                        NestJS modular monolith — Người A
├── src/modules/            Study area, scenario, simulation, results
├── public/                 Web GIS 3D được phục vụ cùng ứng dụng
└── test/                   Unit, integration và API e2e
db/
├── migrations/             PostgreSQL/PostGIS — Người A
├── seeds/
└── queries/
src/                        Python model/solver CLI — Người B
tests/                      Verification + integration
config/                     Grid/scenario/model configuration
data/                       Input cache
artifacts/                  Run outputs, không commit file lớn
docs/                       Research, spec, architecture, roadmap
docker-compose.yml          Modular monolith + PostgreSQL/PostGIS
```

Trong thời gian chuyển đổi, thư mục `web/` hiện tại được giữ và A có thể nâng cấp tại chỗ trước
khi đưa static assets vào `app/public/`. Chỉ có một application deployable; Python là chương
trình tính toán được gọi nội bộ, không phải service độc lập.
