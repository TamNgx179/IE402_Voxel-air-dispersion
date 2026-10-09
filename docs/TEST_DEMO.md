# Test và demo — viewer production FV

## 1. Khởi động trên máy hiện tại

Repository: `C:\Voxel air\IE402_Voxel-air-dispersion`. Mở Docker Desktop, tại root:

```powershell
docker compose up -d db
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Nếu app đang chạy và health `ok`, **không chạy thêm app thứ hai**. Nếu app đã tắt,
trong `app/` kiểm `.env` local có `SOLVER_MODE=real`, Python trỏ venv của repository:

```powershell
npm run db:migrate
npm run build
npm run start
```

Mở `http://127.0.0.1:3000/`; Swagger: `http://127.0.0.1:3000/api/docs`.
DB hiện có scene và kết quả thật: không `db:reset`, không seed lại trong buổi demo.
Máy mới vẫn cần cài dependencies/config và seed theo `DATABASE.md`; chưa có clean-room
Compose đầy đủ cho monolith. Nền bản đồ và CDN cần Internet, không hứa demo offline hoàn chỉnh.

## 2. Kịch bản trình bày 5–7 phút

| Bước | Thao tác | Điều cần chứng minh |
|---|---|---|
| 1 | Bấm nút la bàn “Về khu vực mô phỏng”; zoom ra/vào, xoay chuột phải/Ctrl+kéo | Nền địa lý phủ viewport; khu vực tính toán 500×500 m đặt đúng vị trí, không giới hạn panning |
| 2 | Chọn kết quả **Mùa khô · Voxel**, không chọn “Dữ liệu thử” | FV thật từ run đã qua verification, nhà từ footprint/height thật |
| 3 | Quan sát gió, bấm pause rồi play | Hạt/mũi tên đổi vị trí theo solver, tốc độ hiển thị ×6; HUD m/s là số thật trung bình mẫu |
| 4 | Đổi tầng 1 → 15 → 31 m; có thể chuyển 2D để nhìn lát rõ | Nồng độ và dòng gió thay theo độ cao, không phải chỉ nâng một ảnh 2D |
| 5 | Chọn kết quả **Mùa mưa · Voxel** ở cùng độ cao | Gió/plume đổi theo scenario; không trộn field giữa run |
| 6 | Bấm ô khí, kéo panel tới Phân tích | Profile đứng và thống kê từ API/PostGIS; giải thích mean/max, diện tích/thể tích |
| 7 | Bật WHO/QCVN | Hiển thị ngưỡng đúng units; không vượt ngưỡng vẫn là kết quả hợp lệ |
| 8 | Chọn kịch bản mới → Chạy → đợi completed | HTTP → NestJS → Python → manifest/gates → PostGIS → web tự chọn run mới |

Production baseline khoảng 2–3 phút trên máy đo. Có thể tạo run đầu buổi rồi giải thích
DB/3D trong lúc chờ; concurrency=1. Dùng baseline đã có làm dự phòng nếu chạy mới lỗi,
không đổi sang mock và gọi là kết quả khoa học.

Điều chỉnh minh họa khi bảo vệ nên giữ **×1, nền 0**. Tăng hệ số/nền chỉ đổi cách xem,
không phải kết quả solver mới. Các số trên màn hình lúc đó là ước tính.

## 3. Checklist kiểm giao diện

- Nền có tên đường/khu phố cả ngoài ô mô phỏng. Nếu trống: mở **Lớp hiển thị → Nền
  bản đồ → Đường phố OSM**. Nền sáng có watchdog/fallback sau 12 s và nút tải lại;
  mạng mất hoàn toàn vẫn không tải được tile, nhưng scene/result local còn hoạt động.
- Gió di chuyển; pause giữ vị trí; play chạy tiếp. Tắt lớp gió thì dừng animation;
  bật lại hoạt động. System reduced-motion giữ hình tĩnh; tab ẩn dừng để tiết kiệm máy.
- Đổi run hoặc tầng tạo lại hạt từ field đúng run/tầng; run thiếu artifact không vẽ giả.
- Hạt không đi xuyên solid hoặc wrap qua biên. Đây là trực quan nội suy field downsample,
  không phải solver hạt PM2.5 hoặc validation trajectory chính xác.
- Slider 15 m: tâm ô 15 m; yêu cầu 1,5 m qua API lấy ô chứa, tâm 1 m trên grid dz=2 m.
- Camera 2D/3D và reset hoạt động; trên mobile panel không tràn ngang.
- “Nguồn dữ liệu và giới hạn” đã bỏ khỏi panel; scientific limitations vẫn ở báo cáo.

## 4. Test tự động

Tại repository root:

```powershell
node --check web/app.js
node --test web/tests/viewer.test.cjs
node --test web/tests/building-appearance.test.cjs
.venv/Scripts/python.exe -m pytest -q
```

5 viewer tests: chuyển động theo u/v và units, không xuyên solid/biên, đúng tầng/zero
wind, raster fallback không bị giới hạn bởi study bbox và giữ attribution, vùng bấm pause
nhận pointer events dù HUD cho phép kéo bản đồ xuyên qua phần không tương tác.
Python kiểm numerical verification, convergence pass/fail, wind/export và FV/reference.
Các tests raw-data có thể skip nếu thiếu raw OSM cache; scene đã đóng gói có audit riêng.

Trong `app/`:

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

E2E dùng test database riêng theo cấu hình dự án; không đổi test DB sang DB demo chính.
Xem `QUERY_EVIDENCE.md` và `B5_B6_EVIDENCE.md` cho benchmark/phương pháp/số liệu.

## 5. Kiểm DB/API khi demo

Ví dụ baseline thật đã có trên máy hiện tại:

```powershell
$demoRunId = '6c58daaf-7698-4cb9-8816-fd52568d56e7'
$demoApi = "http://127.0.0.1:3000/api/runs/$demoRunId"
Invoke-RestMethod "$demoApi"
Invoke-RestMethod "$demoApi/summary"
Invoke-RestMethod "$demoApi/slices?z_m=15"
Invoke-RestMethod "$demoApi/profile?i=40&j=34"
Invoke-RestMethod "$demoApi/exceedance?z_m=15&threshold_key=who_24h"
Invoke-RestMethod "$demoApi/artifacts"
```

Giải thích rằng API/query lấy concentration thật; uint8/log payload chỉ phục vụ render.
Manifest local `artifacts/<run_id>/manifest.json` chứa gates/input hash/checksum;
`metrics.json` chứa convergence history và mass ledger. Không gọi mọi chênh lệch
FV–Gaussian là “sai số so thực tế”. Nguồn emission EDGAR vùng và flat terrain vẫn là hạn chế.

## 6. Tái tạo báo cáo khoa học (ngoài giờ demo)

```powershell
.venv/Scripts/python.exe -m src.production_study
.venv/Scripts/python.exe -m src.production_analysis
```

Chạy 5 cases tạo UUID mới và báo cáo/figures local; không tự nhập height sensitivity
vào DB baseline. Đây là verification/sensitivity, chưa validation quan trắc thực địa.
Rõ ràng + tái lập + giải thích đúng mô hình có giá trị hơn chỉ thêm hiệu ứng đẹp;
điểm cuối phụ thuộc rubric và phần bảo vệ, không thể đảm bảo 9+ bằng UI.

## Nguồn cấu hình nền bản đồ

### QA thực hiện 09/10/2026

Build/lint PASS; 5 viewer tests PASS; NestJS unit 88 PASS, 1 skip; API E2E 42 PASS.
Đã kiểm browser: nền sáng và raster OSM đều hiện, pause giữ frame rồi play tiếp tục,
đổi mùa mưa/tầng 15 m trả mean 0,0639 và max 0,273 µg/m³, HUD gió 1,67 m/s từ TN.
Mobile 390×844 không overflow ngang, toàn domain nằm trên panel sau reset camera.
Nguồn/giới hạn không còn trong panel; `UI_DESIGN.md` đã xóa và gỡ tham chiếu.
Ảnh QA local: `artifacts/ui-wind-context-desktop.jpg`, `artifacts/ui-wind-context-mobile.jpg`.
Python solver không đổi trong lần sửa viewer này; full suite lần B5/B6: 218 pass, 9 skip.

### Tài liệu thư viện

### Màu nồng độ và mặt đứng công trình

Viewer dùng thang tuần tự vàng kem → cam đất → đỏ trầm, thang log µg/m³.
Màu không đại diện chiều cao hoặc phân loại sức khỏe AQI; nhãn và số legend là căn cứ.
[AirNow AQI](https://www.airnow.gov/aqi/aqi-basics//) dùng màu theo các category của chỉ số;
không áp màu/category này trực tiếp cho steady increment của mô hình.
Scene hiện chỉ có `source_feature_id,height_m,height_source,wkt`, không có ảnh facade,
UV texture hay mesh LoD2/LoD3. Viewer có cửa sổ/vật liệu **minh họa**, không gọi là mặt
đứng thực tế; hover/bấm nhà hiện building ID và nhãn minh họa. Có thể tắt Chi tiết mặt đứng.
Registry ảnh nguồn theo từng building/cạnh đã có, hiện rỗng; thiếu/lỗi ảnh thì fallback
minh họa. Hướng dẫn ở `web/assets/facades/README.md`.
Muốn thực hiện đúng cần ảnh/mesh có quyền sử dụng, gắn building ID và hướng mặt đứng;
ảnh vệ tinh roof không cung cấp mặt bên. Model hình học solver vẫn giữ nguyên LoD1.

Gió đã bỏ reset lifespan 18 s và throttle 33 ms: cập nhật mỗi animation frame, tái sinh
fade khi chạm solid/biên, không dừng toàn bộ theo vòng. Vận tốc thấp vẫn đi chậm tự nhiên.
Regression gồm 20 s wind integration không reset tùy tiện, facades không sửa footprint/
height và không vượt mái, photo mapping có source/license và fallback theo từng cạnh.

QA bổ sung cho mặt đứng/gió: 9/9 web tests PASS; build/lint PASS. Browser kiểm tra
bật/tắt chi tiết không đổi số liệu, chọn nhà hiện ID/chiều cao/nhãn minh họa.
Ảnh kết quả: `artifacts/ui-facades-continuous-wind.jpg`.
Registry hiện chưa có ảnh thật; nhánh BitmapLayer cần kiểm tra thêm khi có ảnh hợp lệ.

- [MapLibre raster source](https://maplibre.org/maplibre-style-spec/sources/).
- [MapLibre raster tile example](https://maplibre.org/maplibre-gl-js/docs/examples/map-tiles/).
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/): giữ attribution,
  dùng HTTPS và browser caching; không bulk download/prefetch cho offline.
