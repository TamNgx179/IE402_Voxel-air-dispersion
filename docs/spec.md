# Đặc tả — Mô phỏng lan truyền ô nhiễm không khí đô thị trên lưới voxel GIS 3D

> Đây là đặc tả cấp dự án. `RESEARCH.md` cung cấp cơ sở khoa học và nguồn tham khảo;
> `ARCHITECTURE.md` mô tả cách các thành phần ghép với nhau; `ROADMAP.md` quy định tiến độ
> và phân công. Khi tài liệu mâu thuẫn, đặc tả này là chuẩn về yêu cầu sản phẩm.

## Định nghĩa

**Voxel** là một ô của lưới ba chiều đều, mang giá trị tại mọi vị trí trong thể tích. Voxel
khác raster 2.5D, mô hình bề mặt và point cloud vì nó biểu diễn được trường nồng độ trong
toàn bộ không khí: phía trên mái, giữa hẻm phố và theo nhiều cao độ.

**Run mô phỏng** là một lần chạy bất đồng bộ, được định danh bằng `run_id`, gắn với snapshot
tham số, phiên bản mô hình, dữ liệu đầu vào, trạng thái, metrics và artifacts.

## Mục tiêu

Tạo trường nồng độ PM2.5 ba chiều cho một khu vực đô thị tại Việt Nam bằng:

1. mô hình hình học thành phố dạng voxel;
2. trường gió chẩn đoán bảo toàn khối lượng;
3. phương trình tải–khuếch tán giải bằng thể tích hữu hạn;
4. các phép phân tích không gian 3D;
5. ứng dụng modular monolith NestJS có web/API, PostgreSQL/PostGIS và gọi Python solver nội bộ.

Luận điểm cần chứng minh là bản đồ 2D không đủ để thể hiện biến thiên nồng độ theo chiều
cao. Hệ thống phải trung thực về sai số, provenance và các hiện tượng vật lý chưa mô hình hoá.

## Cơ sở yêu cầu

| Mã | Loại | Nội dung hỗ trợ |
|---|---|---|
| `ASSIGN-1` | Đề tài | Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D |
| `ASSIGN-2` | Kỹ thuật bắt buộc | Mô hình 3D Array/voxel và phân tích không gian |
| `EXT-1` | Nghiên cứu | Trực quan hoá 2D thiếu thông tin đứng, vị trí 3D và biểu diễn gió không gian |
| `EXT-2` | Nghiên cứu | Độ phân giải lưới ảnh hưởng mạnh tới sai số mô hình vi mô đô thị |
| `EXT-3` | EPA | Hệ số phát tán Gaussian đô thị và power-law wind profile |
| `EXT-4` | QES/URock | Công thức mass-consistency và nghiệm Poisson/SOR |
| `EXT-5` | Nghiên cứu | Diagnostic wind rẻ hơn nhiều so với LES/DNS nhưng thiếu physics dòng chảy |
| `EXT-6` | PostGIS | Truy vấn không gian, GiST, `ST_3DIntersects`, `ST_3DDWithin` |
| `OBS-1` | Repo | Lưới mặc định 500 × 500 × 100 m, `dx=dy=5 m`, `dz=2 m` |
| `OBS-2` | Repo | Mảng 3D theo `[z,y,x]`, mảng 2D theo `[y,x]` |
| `OBS-3` | Repo | NetCDF hiện lưu geometry, wind/concentration và provenance |
| `OBS-4` | Repo | Gaussian baseline, emission, voxel, analysis và web prototype đã có code/test |
| `SCOPE-1` | Quyết định dự án | PM2.5 được coi là chất thụ động, không phản ứng |
| `SCOPE-2` | Quyết định dự án | Verification bắt buộc; validation thực địa chưa thuộc MVP |
| `SCOPE-3` | Quyết định dự án | Một NestJS modular monolith, PostgreSQL/PostGIS và Python solver subprocess là kiến trúc mục tiêu |

### Lưu ý trung thực học thuật

- Benchmark của QES-Plume, CAIRDIO hoặc mô hình khác chỉ dùng làm tham khảo, không được
  trình bày như độ chính xác đạt được của project.
- Độ chính xác chiều cao Google Open Buildings ngoài Global South phải được nêu kèm hạn chế.
- Verification bằng nghiệm giải tích và định luật bảo toàn không phải validation ngoài thực địa.
- Ngưỡng QCVN/WHO là mức so sánh kết quả, không phải bằng chứng rằng mô hình đúng.

## Phạm vi

### Trong phạm vi

- Voxel occupancy mask và height field LoD1 cho một study area.
- Nguồn phát thải giao thông raster hoá vào voxel gần mặt đất.
- Mass-consistent diagnostic wind: inflow profile, building mask, nghiệm Poisson/SOR.
- Finite-volume advection–diffusion: upwind bậc một, central diffusion, explicit time step.
- Gaussian plume analytic làm baseline so sánh.
- Verification: nghiệm giải tích, bảo toàn khối lượng, boundedness, wall impermeability, CFL.
- Ít nhất năm phép phân tích không gian 3D.
- NestJS monolith phục vụ web/API, tạo run, theo dõi trạng thái và truy vấn kết quả.
- PostgreSQL/PostGIS lưu metadata, geometry, metrics, slices/summaries và provenance.
- `SimulationModule` gọi Python CLI dưới dạng child process nền và xuất NetCDF/artifacts.
- Web dựng lại study area 3D từ dữ liệu thực: footprint và chiều cao toà nhà, đường, mặt
  nước/công viên nếu nguồn có; đồng thời có height slider, scenario switch, threshold,
  profile và summary.

### Ngoài phạm vi

- Röckle đầy đủ bảy vùng, CFD/RANS/LES hoặc chemical transport model.
- Chemistry, deposition, washout, resuspension và traffic-produced turbulence đầy đủ.
- Validation bằng wind tunnel/field measurements trong MVP.
- Dự báo sức khoẻ, cảnh báo chính thức hoặc thay thế mô hình quy chuẩn AERMOD.
- Multi-tenant, billing, Kubernetes, mobile app và phân quyền doanh nghiệp.
- Seminar riêng; toàn bộ công sức tập trung cho sản phẩm, báo cáo và bảo vệ cuối kỳ.

## Ràng buộc

- Grid contract nằm trong `config/project.yaml`; không hard-code spacing ở module khác.
- Mảng 3D là `[z,y,x]`; mảng 2D là `[y,x]`.
- Tensor đầy đủ trao đổi bằng CF-conventions NetCDF-4; concentration dùng `float32`.
- PostgreSQL/PostGIS không thay thế NetCDF cho toàn bộ tensor 3D.
- Geometry dùng projected CRS phù hợp study area khi tính khoảng cách/diện tích.
- `POST /runs` trả `202`; HTTP handler không chờ solver, nhưng tác vụ nền vẫn thuộc cùng
  monolith và không qua message broker/microservice.
- Hai người, tám tuần, bán thời gian; A sở hữu monolith/web/DB/integration, B sở hữu Python solver/model.
- Không commit secrets, file môi trường hoặc dữ liệu có giấy phép không phù hợp.

## Quy tắc nghiệp vụ

### 5.1 Tên gọi và bản chất mô hình

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-1` | Gọi đúng là **mass-consistent diagnostic wind model**, không gọi là Röckle đầy đủ hoặc CFD | `EXT-4`, `SCOPE-1` |
| `BR-2` | Không giải phương trình động lượng; toà nhà tác động qua solid mask và face coefficients | `EXT-4`, `EXT-5` |
| `BR-3` | Chất mô phỏng là PM2.5 thụ động, không phản ứng | `SCOPE-1` |
| `BR-4` | Gaussian là baseline/đối chiếu, không phải solver voxel chính | `OBS-4` |

### 5.2 Solver vận chuyển

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-5` | Advection dùng first-order upwind; không dùng central differencing cho advection | verification hiện có |
| `BR-6` | Flux tính trên mặt ô để khối lượng rời ô này đi vào ô kề tương ứng | conservation law |
| `BR-7` | `dt` được tính từ trường vận tốc thực, Courant mục tiêu không quá 0,5 | stability analysis |
| `BR-8` | Run dừng theo steady-state criterion, không dựa vào số bước cố định | model contract |
| `BR-9` | Building wall và ground không cho flux xuyên qua; boundary ngoài có clean inflow/open outflow | model contract |
| `BR-10` | Nồng độ âm vượt tolerance làm run thất bại; không âm thầm clip để che lỗi | verification rule |
| `BR-36` | Wind solver phải xuất corrected face velocities `uf,vf,wf`; transport dùng trực tiếp các flux này thay vì nội suy lại từ tâm ô | numerical consistency |
| `BR-37` | Positivity được kiểm trên giá trị cập nhật thô trước mọi round-off correction; mọi correction phải ghi lượng mass thay đổi | numerical honesty |

### 5.3 Geometry, grid và dữ liệu

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-11` | Grid mặc định 100 × 100 × 50 nhưng mọi module phải đọc từ config | `OBS-1` |
| `BR-12` | Thứ tự trục `[z,y,x]` là contract xuyên suốt | `OBS-2` |
| `BR-13` | Thiếu chiều cao nhà phải được báo cáo; không dùng default im lặng | data quality |
| `BR-14` | Output khoa học đầy đủ là NetCDF kèm units, CRS, coordinates và provenance | `OBS-3` |
| `BR-15` | Nguồn dữ liệu, thời điểm tải, version và phép biến đổi phải được lưu | reproducibility |

### 5.4 Monolith, Python subprocess và trạng thái run

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-16` | `POST /runs` validate DTO, tạo snapshot tham số và trả `202 Accepted` cùng `run_id` | `SCOPE-3` |
| `BR-17` | Trạng thái hợp lệ: `queued → running → succeeded/failed`; có thể thêm `cancelled/stale` | architecture |
| `BR-18` | Python solver không mở port/API; chỉ `SimulationModule` được spawn process bằng command/arguments whitelist | architecture |
| `BR-19` | Monolith chỉ chạy một simulation process tại một thời điểm trong MVP; retry ghi attempt count và không nhân đôi kết quả | reliability |
| `BR-20` | Chỉ run vượt qua verification mới được đánh dấu `succeeded` | `SCOPE-2` |
| `BR-21` | HTTP disconnect không huỷ subprocess; DB là nguồn sự thật và monolith khôi phục/đánh dấu run gián đoạn khi restart | architecture |

### 5.5 PostgreSQL/PostGIS và truy vấn

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-22` | DB lưu study area, buildings, roads, scenarios, runs, metrics, slices/summaries và artifacts | `SCOPE-3` |
| `BR-23` | Geometry có SRID đúng và GiST index; foreign key/index B-tree cho `run_id`, `z_m`, `status` | `EXT-6` |
| `BR-24` | Tensor đầy đủ nằm ở artifact storage; DB chỉ giữ phần cần filter/aggregate/spatial query | storage trade-off |
| `BR-25` | Query từ client dùng endpoint/whitelist; không nhận SQL tự do | security |
| `BR-26` | Tối thiểu có query slice theo z, vùng vượt ngưỡng, profile đứng và summary theo tầng | assignment DB/query |
| `BR-27` | Truy vấn chính phải có `EXPLAIN (ANALYZE, BUFFERS)` hoặc bằng chứng index phù hợp | performance |

### 5.6 Web và tính trung thực

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-28` | Web chỉ gọi API same-origin của monolith, không query DB hoặc gọi Python CLI trực tiếp | architecture |
| `BR-29` | Height slider đổi đúng lớp `z_m` mà không reload toàn trang | product objective |
| `BR-30` | UI hiển thị units, scenario, model version, threshold và warnings | reproducibility |
| `BR-31` | Numerical diffusion và các physics bị thiếu phải xuất hiện trong report/UI | `SCOPE-2` |
| `BR-32` | Toà nhà trên web dùng đúng footprint và `height_m` của dữ liệu đã voxel hoá; không đặt khối nhà thủ công | 3D scene contract |
| `BR-33` | Đường, mặt nước và cây xanh lấy từ lớp GIS có provenance và cùng CRS; không bịa feature để làm đẹp | data integrity |
| `BR-34` | Cảnh MVP là LoD1; không tuyên bố có facade/roof detail nếu nguồn không chứa các chi tiết đó | honesty |
| `BR-35` | Geometry web, PostGIS và voxel mask phải dùng cùng study-area transform và được kiểm bằng overlay/anchor points | spatial consistency |

### 5.7 Cổng chất lượng release

| Mã | Quy tắc | Nguồn |
|---|---|---|
| `BR-38` | FV voxel là kết quả mặc định trên web và trong báo cáo; Gaussian chỉ là baseline có nhãn | project objective |
| `BR-39` | Run chỉ được `succeeded` khi CFL, divergence, positivity, wall flux, mass balance và artifact integrity đều pass | verification gate |
| `BR-40` | Threshold/units có một nguồn cấu hình được version hoá; DB seed, API, web và report không được tự chép số riêng | consistency |
| `BR-41` | Có sensitivity chiều cao và ít nhất một external benchmark/cross-check; mức tuyên bố phải khớp loại bằng chứng | academic quality |
| `BR-42` | Release phải chạy được trên môi trường sạch theo chuỗi Compose → migrate → seed → run → query → web | reproducibility |
| `BR-43` | Mọi kết luận định lượng trong báo cáo truy được về `run_id`, model version, input hash, table/figure và limitation | traceability |

## API contract

| Method | Endpoint | Kết quả |
|---|---|---|
| `GET` | `/health` | trạng thái monolith, DB, artifact directory và Python runtime |
| `GET` | `/study-areas` | vùng nghiên cứu và bounds |
| `GET` | `/scenarios` | kịch bản khí tượng/phát thải |
| `POST` | `/runs` | tạo run bất đồng bộ, trả `run_id` |
| `GET` | `/runs/:id` | status, progress, error, metrics |
| `GET` | `/runs/:id/slices?z_m=` | concentration layer tại cao độ |
| `GET` | `/runs/:id/exceedance?threshold=` | cells/vùng vượt ngưỡng |
| `GET` | `/runs/:id/profile?x=&y=` | profile theo chiều cao |
| `GET` | `/runs/:id/summary` | mean/max, exceedance volume, mass balance |
| `GET` | `/runs/:id/artifacts` | manifest và artifact references |

## Mô hình dữ liệu tối thiểu

| Bảng | Trường chính |
|---|---|
| `study_areas` | `id`, `name`, `geom`, `projected_srid`, `metadata` |
| `building_footprints` | `id`, `study_area_id`, `geom`, `height_m`, `height_source` |
| `road_segments` | `id`, `study_area_id`, `geom`, `road_class`, `emission_weight` |
| `scenarios` | `id`, `name`, `wind_from_deg`, `wind_speed_m_s`, `parameters` |
| `simulation_runs` | `id`, `scenario_id`, `status`, `model_version`, `input_hash`, timestamps, `error` |
| `run_metrics` | `run_id`, CFL, divergence, mass terms, steps, runtime |
| `concentration_slices` | `run_id`, `z_m`, `geom`, `concentration_ug_m3`, threshold flags |
| `artifacts` | `run_id`, `kind`, `uri/path`, `checksum`, `size_bytes`, `manifest` |

## Trường hợp biên

| Tình huống | Xử lý bắt buộc |
|---|---|
| Nhà thiếu chiều cao | fail hoặc dùng fallback có cờ provenance; không im lặng |
| Nhà cao hơn domain | clip và phát warning định lượng |
| SOR không hội tụ | run `failed`, lưu residual và iteration count |
| Nguồn nằm trong solid voxel | reject hoặc relocate theo rule được ghi lại |
| Gió bằng 0 | solver chuyển thành pure diffusion và không chia cho 0 |
| Concentration âm | kiểm trước correction; fail nếu vượt tolerance, không che bằng clipping; round-off correction phải ghi mass delta |
| Face velocity thiếu/không khớp grid | Python run fail trước transport, không nội suy ngầm từ cell-centred field |
| Payload web quá lớn | downsample/tiling và ghi hệ số |
| Python subprocess chết giữa run | monolith lưu exit code/stderr, run thành `failed`, có thể retry theo attempt |
| Monolith restart | quét `queued/running`, giữ artifacts đã hoàn tất và đánh dấu run bị gián đoạn |
| Artifact thiếu/checksum sai | không trả như kết quả hợp lệ |
| CRS sai hoặc geometry không hợp lệ | reject khi ingest/migration |
| Query bbox không giao study area | trả collection rỗng, không lỗi 500 |

## Tiêu chí nghiệm thu

### 9.1 Geometry và dữ liệu

| ID | Tiêu chí | Truy vết |
|---|---|---|
| `AC-1` | Voxeliser ghi `H(y,x)` và `B(z,y,x)` đúng dimensions/coordinates | `BR-11..14` |
| `AC-2` | Building height thiếu được phát hiện và ghi rõ nguồn/fallback | `BR-13` |
| `AC-3` | NetCDF mở đúng chiều trong QGIS/Panoply mà không cần code riêng | `BR-14` |

### 9.2 Wind và transport

| ID | Tiêu chí | Truy vết |
|---|---|---|
| `AC-4` | Divergence sau correction dưới tolerance tại mọi air voxel | `BR-1..2` |
| `AC-5` | Velocity trong solid voxel bằng 0 và không có flux xuyên tường | `BR-9` |
| `AC-6` | Closed domain bảo toàn khối lượng trong sai số floating-point | `BR-6` |
| `AC-7` | Source/open boundary thoả emitted = remaining + escaped trong tolerance | `BR-6` |
| `AC-8` | Không có concentration âm vượt tolerance | `BR-5`, `BR-10` |
| `AC-9` | Pure diffusion và uniform advection khớp nghiệm giải tích trong ngưỡng đã ghi | `SCOPE-2` |
| `AC-10` | Run báo `dt`, Courant, steps, simulated time và wall-clock | `BR-7..8` |

### 9.3 Monolith, Python subprocess và DB

| ID | Tiêu chí | Truy vết |
|---|---|---|
| `AC-11` | Request hợp lệ trả `202` + `run_id`; request sai bị reject trước khi tạo run | `BR-16` |
| `AC-12` | Run đi qua state machine và được phục hồi/đánh dấu đúng sau khi monolith restart | `BR-17`, `BR-21` |
| `AC-13` | Python exit khác 0 tạo status/error rõ ràng, không tạo artifact “thành công” | `BR-20` |
| `AC-14` | Migration + seed dựng DB mới từ đầu và có FK/SRID/index | `BR-22..23` |
| `AC-15` | Slice, exceedance, profile và summary trả đúng `run_id`, `z_m`, units | `BR-26` |
| `AC-16` | Spatial query có bằng chứng dùng index hoặc lý giải đo được | `BR-27` |
| `AC-17` | Hai run đồng thời được tuần tự hoá theo giới hạn concurrency=1; retry không nhân đôi output | `BR-19` |

### 9.4 Web và kết quả

| ID | Tiêu chí | Truy vết |
|---|---|---|
| `AC-18` | Height slider đổi lớp nồng độ mà không reload trang | `BR-29` |
| `AC-19` | Hai wind scenarios cho plume direction khác nhau hợp lý | objective |
| `AC-20` | Lát 1,5 m và 15 m thể hiện được cấu trúc đứng | objective |
| `AC-21` | UI hiện threshold, units, version và warnings | `BR-30..31` |
| `AC-22` | Gaussian/FV được gắn nhãn rõ, không trộn kết quả | `BR-4` |
| `AC-22a` | 100% building hiển thị có `source_feature_id`, `height_source` và footprint truy ngược được | `BR-32` |
| `AC-22b` | Chọn mẫu ít nhất 10 toà nhà: footprint, tâm và chiều cao web khớp DB/scene package trong tolerance | `BR-32`, `BR-35` |
| `AC-22c` | Road/water/green layers khớp basemap và không có feature được đặt tay ngoài dữ liệu nguồn | `BR-33` |
| `AC-22d` | UI/report ghi rõ cảnh là LoD1 và địa hình phẳng `z=0` | `BR-34` |

### 9.5 Trung thực học thuật

| ID | Tiêu chí | Truy vết |
|---|---|---|
| `AC-23` | Báo cáo dùng từ “verification”, không tuyên bố validation chưa thực hiện | `SCOPE-2` |
| `AC-24` | Numerical diffusion được đo/ước lượng cạnh physical diffusivity | `BR-31` |
| `AC-25` | Hạn chế cavity/wake, canyon vortex, traffic turbulence và flat terrain được nêu | `BR-31` |
| `AC-26` | Mọi run có model version, input hash và provenance | `BR-15`, `BR-30` |

### 9.6 Cổng nghiệm thu mục tiêu 9+

| ID | Tiêu chí | Truy vết |
|---|---|---|
| `AC-27` | Artifact gió chứa `uf,vf,wf`; divergence của chính face field đưa vào transport dưới tolerance tại mọi air cell | `BR-36` |
| `AC-28` | Regression test cố tình tạo bước không ổn định phải fail trước clipping; test phát hiện được giá trị âm | `BR-10`, `BR-37` |
| `AC-29` | Với một production run: emitted mass = remaining + escaped + documented correction trong tolerance; correction xấp xỉ 0 | `BR-37`, `BR-39` |
| `AC-30` | Mở web sau release mặc định tải scenario `model=fv`; Gaussian chỉ xuất hiện khi người dùng bật comparison | `BR-38` |
| `AC-31` | Run có verification fail không thể chuyển thành `succeeded` hoặc xuất hiện trong danh sách kết quả hợp lệ | `BR-39` |
| `AC-32` | Test tự động so sánh threshold/units từ config, DB, API payload, web legend và report fixture, không có sai khác | `BR-40` |
| `AC-33` | Báo cáo có sensitivity chiều cao và external benchmark/cross-check, nêu rõ đó là verification hay validation | `BR-41` |
| `AC-34` | Trên môi trường sạch, runbook dựng monolith + DB, seed, spawn Python solver, trả 4 query và mở web mà không sửa tay | `BR-42` |
| `AC-35` | Evidence index liên kết mỗi figure/table quan trọng tới `run_id`, commit/model version, input hash và manifest | `BR-43` |

## Ghi chú quan sát

| Đã quan sát trong repo | Chưa được chứng minh và cần triển khai/đo |
|---|---|
| Pipeline voxel, emission, Gaussian, analysis và web prototype đã tồn tại | NestJS monolith, migrations và subprocess adapter chưa tồn tại |
| Contract `[z,y,x]` và NetCDF đã được dùng | Contract monolith–Python CLI cần integration test |
| Có test verification cho nhiều toán tử | Kết quả FV cuối cùng cần nối với web/API |
| Có dữ liệu study area và hai kịch bản minh hoạ | DB query plan và tải thực tế chưa đo |
| Có giới hạn dữ liệu chiều cao/phát thải được ghi nhận | Chưa có validation hiện trường |

## Nguồn

- `docs/RESEARCH.md`: cơ sở khoa học, dữ liệu, mô hình và danh mục nguồn đầy đủ.
- `docs/ARCHITECTURE.md`: kiến trúc modular monolith, Python subprocess, DB và trade-off.
- `docs/ROADMAP.md`: tiến độ, phân công A/B và tiêu chí mốc.
- [PostGIS 3D predicates](https://postgis.net/docs/ST_3DIntersects.html).
- [PostGIS spatial indexes](https://postgis.net/documentation/faq/spatial-indexes/).
- [US EPA dispersion modelling](https://www.epa.gov/scram/air-quality-dispersion-modeling-preferred-and-recommended-models).

## Phụ lục thay đổi phạm vi

### A. Chiều cao công trình

Open Buildings 2.5D được dùng cho coverage; OSM là nguồn footprint/đối chứng. Khi chiều cao
bị clip ở 100 m hoặc khác mạnh với OSM, warning và provenance phải đi cùng kết quả.

### B. Mạng đường và địa hình

Road graph phải loại bản sao hai chiều khi tổng hợp chiều dài/phát thải. MVP giả định mặt
đất phẳng `z=0`; đây là hạn chế được ghi rõ, không phải kết quả đã kiểm chứng.

### C. Kiến trúc modular monolith

So với prototype web tĩnh ban đầu, sản phẩm cuối bổ sung một NestJS modular monolith và
PostgreSQL/PostGIS. Monolith phục vụ web/API và gọi Python CLI bằng child process; không có
worker service, broker hay network hop nội bộ. Thay đổi này không làm đổi mô hình khoa học:
solver vẫn dùng cùng grid, NetCDF và verification contract.
