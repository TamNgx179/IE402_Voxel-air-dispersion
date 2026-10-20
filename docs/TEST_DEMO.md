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
Xem `DATABASE.md` cho benchmark truy vấn và `RESEARCH.md` cho phương pháp mô hình.

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
Pilot ảnh Sunwah đã được rút khỏi viewer theo yêu cầu mới; chỉ dùng vật liệu/cửa sổ
minh họa sáng. Hướng dẫn ở `web/assets/facades/README.md`.
Muốn thực hiện đúng cần ảnh/mesh có quyền sử dụng, gắn building ID và hướng mặt đứng;
ảnh vệ tinh roof không cung cấp mặt bên. Model hình học solver vẫn giữ nguyên LoD1.

Gió đã bỏ reset lifespan 18 s và throttle 33 ms: cập nhật mỗi animation frame, tái sinh
fade khi chạm solid/biên, không dừng toàn bộ theo vòng. Vận tốc thấp vẫn đi chậm tự nhiên.
Regression gồm 20 s wind integration không reset tùy tiện, facades không sửa footprint/
height và không vượt mái, photo mapping có source/license và fallback theo từng cạnh.

QA bổ sung cho mặt đứng/gió: 9/9 web tests PASS; build/lint PASS. Browser kiểm tra
bật/tắt chi tiết không đổi số liệu, chọn nhà hiện ID/chiều cao/nhãn minh họa.
Ảnh kết quả: `artifacts/ui-facades-continuous-wind.jpg`.
Pilot ảnh gốc Sunwah 12/10/2026 đã được thử rồi rút lại; kết quả cũ dưới đây là lịch sử QA.

### A7.1 và texture pilot — lịch sử thử nghiệm 12/10/2026

- `node --test web/tests/*.test.cjs`: kiểm request timeout/network/HTTP/invalid JSON,
  không retry POST, resume polling, stale session 404, result/query retry và UV adapter.
- Bootstrap lỗi: thông báo + Thử lại, không vẽ gió giả hoặc bật slider khi chưa có dữ liệu.
- Chọn run lỗi: giữ kết quả cũ, nút Thử lại tải đúng run đã chọn; không trộn callback cũ.
- Truy vấn lỗi: Thử lại truy vấn ngay tại panel, không yêu cầu đổi tầng.
- Mất kết nối run: giữ run_id, ngừng progress giả, Tiếp tục theo dõi không POST lại.
- Empty results: chọn kịch bản để tạo run, selector/slider không dùng dữ liệu chưa có.
- Khi POST mất kết nối, trạng thái có thể chưa xác nhận: kiểm danh sách trước khi tạo lại.

Chạy `npm run start` trong `app/`, đặt `$env:PORT='3001'`, `$env:SOLVER_MODE='real'`
nếu 3000 đang thuộc app khác. Health: `http://127.0.0.1:3001/api/health`.
Không dừng container khác, không reset/migrate DB production để kiểm tra UI.

Demo texture cũ (không còn trong viewer): Lớp hiển thị → Xem texture Sunwah, xoay để thấy ba đoạn cạnh mặt tiền có ảnh,
bấm nhà để xem nguồn/giấy phép/ghi chú. Tắt Chi tiết mặt đứng để so sánh, thống kê
nồng độ không đổi. Ảnh là năm 2013 và UV sampling xấp xỉ trên khối LoD1 77,5 m,
không khẳng định từng chi tiết/mái/độ cong hoặc ngoại hình hiện nay được tái dựng đúng.
Chi tiết bằng chứng, checksum và giấy phép: `web/assets/facades/README.md`.

Kết quả QA 12/10: 21/21 web tests PASS; `npm run build`, `npm run lint` exit 0;
`npm test` trong `app/`: 88 PASS, 1 skip. `/api/health` trên 3001 báo DB/PostGIS/Python OK.
Browser đã thấy texture ba đoạn cạnh, liên kết nguồn/giấy phép và không có console error/warn.
Bật/tắt chi tiết giữ mean 0,2, max 0,89 µg/m³, 7.683 ô khí của run khô 4c63 tại 1 m.
Đổi sang run mưa 9f72 và tầng 15 m: mean 0,0639, max 0,273 µg/m³,
8.210 ô khí; HUD 1,67 m/s từ TN (227°), không lẫn trường gió run khô.
Ảnh QA: `artifacts/ui-sunwah-texture-a71.jpg` (local, không commit).
Các lỗi mạng/polling/retry được kiểm bằng test DOM/VM; chưa có browser fault-injection
hoặc clean-room Compose trong đợt này. Chỉ một building pilot; chưa phủ ảnh thật toàn scene.

### Giao diện mới: nhà sáng và luồng gió mềm — 12/10/2026

Đã bỏ texture ảnh thật, nút Sunwah và UV adapter. Nhà dùng vật liệu kem/cát/trắng
xanh, kính xanh nhạt và bậu cửa sáng; không phải tái dựng ngoại hình khảo sát.
Ảnh pilot cũ lưu local trong `artifacts/former-texture-pilot/`, không phục vụ trên web.

Gió không có đầu mũi tên; các vệt mờ hai đầu chạy theo u/v/w của solver. Đường vệt
tích phân qua trường gió, kiểm solid/biên và giới hạn số điểm; không thêm xoáy giả.
Pause/reduced-motion vẫn giữ. Tầng thấp có nhà chắn gió nên vệt thưa/chậm hơn;
không ép chúng chạy nhanh bằng vận tốc giả. Chuyển động hiển thị ×6, không phải
thời gian mô phỏng transient và không phải khói PM2.5.

Demo trên `http://127.0.0.1:3001/`:

1. Chọn run Voxel thật, mở Lớp hiển thị, bật Toà nhà / Chi tiết mặt đứng / Gió.
2. Xem tầng 1 m rồi 15 m; so sánh hướng/tốc độ ở HUD và nồng độ/thống kê theo tầng.
3. Pause rồi Play: luồng gió dừng và tiếp tục, không tạo run mới.
4. Bật/tắt Chi tiết mặt đứng: số liệu nồng độ không đổi. Xoay/zoom để nhìn kính/bậu cửa.
5. Đổi run mùa mưa/khô: trường gió và thống kê theo đúng run; thu gọn bảng để xem rõ map.

QA đợt mới: 23/23 web tests PASS; `npm run build` và `npm run lint` trong `app/`
exit 0; `npm test`: 88 PASS, 1 skip. Browser kiểm mùa khô 15 m (gió 1,49 m/s từ
ĐĐN), mùa mưa 15 m (1,67 m/s từ TN); mùa mưa mean 0,0639, max 0,273 µg/m³,
8.210 ô khí, không đổi khi bật/tắt mặt đứng. Đã kiểm pause/play và không có console
error/warn ở lượt QA mới. Regression kiểm streamlet không xuyên solid, gió zero
không tạo vệt giả, đường cong theo solver, vật liệu ổn định và GIS không bị sửa.
Không chạy lại full Python/API E2E hay benchmark FPS/mobile trong đợt chỉnh viewer này.
Ảnh QA: `artifacts/ui-natural-buildings-flow.jpg` (local, không commit).

Tinh chỉnh màu sau phản hồi: tường đá/be/xám xanh, kính xanh xám, bậu cửa bớt trắng;
giảm ambient/diffuse/specular để giữ chiều sâu, không thay đổi gió hay solver.
23/23 web tests vẫn PASS; kiểm lại syntax và diff không lỗi.
Ảnh màu dịu: `artifacts/ui-muted-buildings.jpg` (local, không commit).

### Phối lại công trình theo nguồn tham khảo GIS 3D — 12/10/2026

Đối chiếu Esri thematic cityscape, Cesium OSM styling, MapLibre extrusion,
CityOnStats và VoxCity; nguồn/lập luận nằm ở RESEARCH §20. Viewer dùng thân nhà
ngà/pearl, kính ít bão hòa; ambient + key/fill riêng, không specular. Cửa sổ thưa
hơn và rõ dần theo zoom (độ mờ thay đổi từ 0,2 đến 0,9), không thêm ảnh texture.
Đây là preset cartographic daylight của nhóm, không phải quy định màu GIS hoặc
đặc tính vật liệu thật. Không bật experimental shadow.

`node --test web/tests/*.test.cjs`: 25/25 PASS; `node --check web/app.js` PASS.
Đã kiểm browser overview, zoom gần, xoay nhà, bật/tắt chi tiết; không có console
error/warn ở lượt kiểm mới. Bật/tắt chi tiết giữ mean 0,2, max 0,89 µg/m³ và 7.683
ô khí ở run khô 4c63 tầng 1 m. Không chạy lại Python/API E2E hay benchmark FPS.
Ảnh local: `artifacts/ui-researched-buildings-overview.jpg` và
`artifacts/ui-researched-buildings-detail.jpg`.

### Lưới voxel và chọn từng ô — 12/10/2026

Lưới bao phủ toàn miền mô phỏng ở tầng đang xem, không phải toàn bộ bản đồ nền.
Mỗi ô 5 × 5 m; miền hiện tại 100 × 100 ô, nét đậm mỗi 10 ô. Ô đang chọn có viền
xanh trên bản đồ; hai ký hiệu ô trong sidebar đã được bỏ theo phản hồi. Không đặt nhãn lên 10.000 ô để tránh
che bản đồ. Lưới/viền chỉ là lớp hiển thị, không thay đổi solver hoặc số liệu.

1. Chọn run Voxel, bật **Ranh giới từng ô**, zoom gần để thấy từng ô nhỏ.
2. Rê chuột trên lớp nồng độ: xem i/j/k, độ cao và nồng độ **ước tính hiển thị**.
3. Bấm ô: viền xanh đánh dấu ô; bảng nổi hiển thị nồng độ truy vấn và mục
   **Phân tích → Theo độ cao** hiển thị profile. Trong chế độ điều chỉnh minh họa,
   giá trị được ghi rõ là ước tính điều chỉnh, không phải kết quả truy vấn gốc.
4. Nếu nhà che ô hoặc ô quá nhỏ, mở **Ô được chọn → Chọn ô bằng chỉ số**, nhập i/j từ 0 đến 99
   rồi **Xem ô**; i tăng về Đông, j tăng về Bắc. Ô công trình không có nồng độ khí.
5. Đổi độ cao: cùng i/j nhưng k và nồng độ thay đổi. Tắt lưới không mất ô đang chọn.

QA: 30/30 web tests PASS, syntax `web/app.js` PASS, diff check PASS.
Browser đã kiểm click trực tiếp ô (27,19), chọn bằng form (10,10), chuyển 1 m →
3 m và bật/tắt lưới. Ô (10,10), k=1 hiển thị 0,144 µg/m³ từ truy vấn ở run khô
4c63; không có console error/warn trong lượt kiểm. Chưa benchmark mobile/FPS
hoặc chạy lại Python/API E2E. Ảnh local: `artifacts/ui-voxel-grid-selection.png`.

### Bảng điều khiển tinh gọn — 12/10/2026

Luồng chính: chọn kết quả → đổi độ cao → đọc thang màu → bấm ô. Giữ nút bật/tắt
lưới trên màn hình; hướng dẫn/kích thước lưới ở **Tùy chọn bản đồ**. Biểu đồ ô
được chọn nằm ngay sau phần xem kết quả. Không thay đổi hợp đồng API/số liệu.

Các mục **Chạy mô phỏng mới**, **Tùy chọn bản đồ**, **Thống kê & ngưỡng tham chiếu**
và **Điều chỉnh minh họa** mặc định đóng. Bấm tên mục để mở; dùng Tab và Enter
với bàn phím. Ngưỡng QCVN/WHO và bảng vượt ngưỡng nằm chung trong mục thống kê.
Thông báo truy vấn/nút thử lại đặt ngoài các mục đóng; trạng thái tiến độ/lỗi
mô phỏng vẫn hiện ngay cả khi thu gọn phần chạy mới. Giữ hành vi loading, empty,
validation, permission/conflict, timeout/offline của API hiện có.

QA: 31/31 web tests PASS. Browser kiểm mở nhóm chạy mới (không tạo run mới),
mở/đóng thống kê bằng Enter, đổi độ cao và chọn ô (10,10) qua form; profile
và nồng độ truy vấn vẫn cập nhật. Ảnh local: `artifacts/ui-compact-sidebar.png`.
Không chạy lại API/Python E2E hoặc kiểm thử thiết bị di động trong lượt này.

Tinh chỉnh tiếp: bỏ hai swatch Ô voxel/Ô đang chọn. Mọi `details > summary` trong
bảng dùng cùng màu chữ, cỡ 12 px, độ đậm 500 và chevron `currentColor`; mở mục
thì chevron quay xuống. Mục lồng nhau và Chi tiết lỗi dùng cùng quy tắc; giữ focus
và thao tác bàn phím của `details` native. Web tests: 32/32 PASS.

### B5/B6 — Kết quả production và tái lập, 09/10/2026

Đây là verification với GIS/phát thải thật, **không phải validation bằng quan trắc**.
Grid 100 × 100 × 50, ô 5 × 5 × 2 m, `[z,y,x]`, EPSG:32648; 62 nhà LoD1,
41.084 voxel solid. Scene checksum và raster hóa độc lập cho 0 voxel occupancy,
0 ô footprint và 0 voxel mái lệch. EDGAR phân bổ theo đường là emission proxy,
không phải traffic counts; không ngầm coi chiều cao/ngoại hình là khảo sát hiện trường.

| Case | run_id | Runtime (s) | RSS (MB) | Residual | Sai số mass tương đối |
|---|---|---:|---:|---:|---:|
| Khô | `6c58daaf-7698-4cb9-8816-fd52568d56e7` | 124,83 | 308,89 | 9,51e-5 | 7,84e-14 |
| Mưa | `9f723ca6-c80d-4ef8-8a68-a1adfc89b24c` | 166,89 | 308,57 | 7,98e-5 | 1,44e-14 |
| K × 0,5 | `acd590b9-2d7e-409c-b7b5-eb1f6307df48` | 94,55 | 303,34 | 1,89e-4 | 7,18e-14 |
| Height × 0,8 | `249804f0-3be6-4d7e-aed5-570c8da1ef27` | 132,54 | 317,26 | 6,21e-5 | 7,20e-14 |
| Height × 1,2 | `c9fed6d7-8557-4411-9c79-9d447ec63325` | 152,95 | 307,48 | 1,15e-4 | 8,60e-14 |

Mỗi case đo một lần, không phải runtime p50/p95; RSS lấy mẫu process tree mỗi
0,1 s. Hội tụ relative L1 ≤ 1e-3 qua 3 lần cách 30 s sau 600 s; hết 1.800 s chưa
hội tụ thì fail. Cả 5 case CFL=0,5, wall flux=0, mass correction=0,
divergence max < 4,86e-7 s⁻¹. K số p95 ngang khô 6,217/2,805 và mưa
5,662/5,316 m²/s có thể lớn hơn K vật lý 2/2: chưa tuyên bố grid-converged.

Mean tầng yêu cầu 1,5 m (tâm 1 m) / 15 m: khô 0,20046/0,06283, mưa
0,19712/0,06394 µg/m³. MAE/RMSE FV–Gaussian: khô 0,01187/0,03244,
mưa 0,01135/0,03518 µg/m³; Gaussian không phải ground truth.
K ×0,5 làm mean/max tăng 8,77%/43,46%; height ×0,8 đổi −3,87%/−1,95%,
height ×1,2 đổi +3,77%/+2,16%. Height cases raster hóa lại scene và mask,
không chỉ đổi UI; không import chúng vào DB scene baseline. Tất cả ngưỡng WHO/QCVN
có exceedance bằng 0, không chứng minh không khí thực tế an toàn hoặc tương đương
quan trắc 24 h. Verification nhiệt K=1, t=20 s cho variance 40 m², khớp σ²=2Kt.

Tại repo root, venv phải có dependency solver/study (`psutil`, plotting, rasterio):

```powershell
.venv/Scripts/python.exe -m src.production_study
.venv/Scripts/python.exe -m src.production_analysis
.venv/Scripts/python.exe -m pytest -q
```

`artifacts/production-study/analysis.json` lưu hashes/provenance/số liệu; hình
300 dpi gồm `geometry-overlay.png`, `convergence.png`, `vertical-comparison.png`,
`height-slices.png`. Đây là generated artifacts local, không ngầm coi đã commit.
Trong `app/`, migrate rồi import **baseline** từ lượt chạy vừa tạo:

```powershell
npm run db:migrate
npm run db:import-run -- "../artifacts/production-study/dry/<run_id>"
npm run db:import-run -- "../artifacts/production-study/wet/<run_id>"
```

Importer từ chối run failed/non-steady, checksum sai, geometry khác baseline hoặc
run trùng. Bật `SOLVER_MODE=real` trong environment local và restart để nút Chạy
gọi solver thật. Benchmark truy vấn ở [DATABASE.md](DATABASE.md#7--benchmark-truy-vấn-production-fv).
Full Python ngày 09/10: 218 pass, 9 skip (raw cache thiếu); có ABI/deprecation
warnings. Chưa thay thế clean-room hoặc scientific suite cuối B7/B8.

### A7.2 — Regression tích hợp, 12/10/2026

Docker DB healthy; app real solver phục vụ ở 3001. Trong `app/`, dùng
`npm run test:e2e:required` để kiểm bắt buộc PostGIS (53 PASS, 0 skip), không
dùng kết quả suite bị skip để chốt hoàn thành. DB test riêng `_test`; development
DB không bị reset. Unit 96 PASS + 1 skip symlink Windows, web 35/35 PASS,
build/lint PASS. Browser tạo production run `2a3ab50e-2202-4b14-9209-3ab1fba4fd92`
thành công, tự chọn run, đổi tầng/chọn ô/profile và đổi mùa.

Các nhóm regression A7.2: DTO/bbox/độ cao sai; trạng thái queued/running/failed/cancelled
không trả kết quả thành công; import lại không nhân bản; retry/recovery executor;
hai kịch bản Python thật trên fixture nhỏ; timeout/offline, POST chưa rõ kết quả
không tự gửi lại và phản hồi truy vấn cũ không ghi đè lựa chọn mới trên web.

Tái lập tại root bằng `docker compose up -d db`, `node --test web/tests/*.test.cjs`;
trong `app/` chạy `npm test`, `npm run test:e2e:required`, `npm run build`, `npm run lint`.
Required E2E phải thất bại nếu thiếu DB; chỉ được reset DB có tên kết thúc `_test`.
Không dùng `db:reset` trên development DB. Ảnh/báo cáo sinh local ở `artifacts/`.
Chưa thay thế kiểm thử clean-room release A7.3/A7.6, mobile/FPS hoặc validation
bằng quan trắc thực địa; 1 unit test symlink bị skip trên Windows không có quyền tạo symlink.

### Candidate tuần 7 — 14/10/2026

Đã bổ sung Docker monolith/Python + PostGIS, input offline checksum-locked,
runtime dependency lock, dashboard exact provenance và scripts regression,
clean-room, model freeze, report assets/evidence index. Fresh-volume rehearsal
tạo hai run 500.000 voxel qua API, kiểm mọi artifact checksum, exact queries,
benchmark/EXPLAIN, restart và Chrome headless. Browser không có JS exception;
dashboard hiển thị 7/7 gates, profile chờ response API trước screenshot.

Full regression candidate: 247 Python PASS, 0 skip; 40 web PASS; backend
97 PASS + 1 Windows symlink skip; required E2E 53 PASS, 0 skip; build/lint PASS.
Năm production cases đều qua gate; analytic variance 40 m² khớp nghiệm giải tích.
Số liệu mới và captions lấy từ run manifests, không copy bảng cũ.

Runbook: [WEEK7_RUNBOOK.md](./WEEK7_RUNBOOK.md). Draft kiến trúc/phương pháp/GIS:
[REPORT_DRAFT.md](./REPORT_DRAFT.md). Snapshot số liệu và hashes sinh local:
`artifacts/week7/week7-candidate.json`.
Generated NetCDF/logs/hình 300 dpi nằm local tại `artifacts/week7/`.
Đây là candidate tuần 7, chưa phải release tuần 8 hoặc validation quan trắc.

### Dọn tài liệu và mã không dùng — 12/10/2026

Sơ đồ SVG và Mermaid thống nhất Python là subprocess nội bộ của monolith.
Các tài liệu kiểm thử riêng đã bỏ khỏi `docs/`; hướng dẫn và số liệu chính được
gom tại đây và `DATABASE.md`. Gỡ helper `cellCentre`, CSS UI cũ không có caller
và registry texture rỗng; giữ pipeline khoa học/export còn được test sử dụng.
Kiểm lại: web 35/35; unit API 96 pass + 1 skip symlink Windows; required E2E
53/53, 0 skip; build/lint, JS syntax, XML SVG và diff check đều pass.
Không chạy lại full Python science suite trong đợt dọn mã này.

- [MapLibre raster source](https://maplibre.org/maplibre-style-spec/sources/).

### A8 — So sánh run và truy vấn polygon, 19/10/2026

Tại root, audit xuống dòng bằng `node scripts/normalize-frozen-text.mjs`.
Chỉ thêm `--apply` để sửa các text file CRLF mà bytes sau chuẩn hóa khớp đúng
hash freeze đã có. Script kiểm toàn bộ trước khi ghi, không đổi lock, không sửa
content drift hoặc binary. Sau đó `node scripts/check-freeze.mjs` phải PASS.
Đợt này đã sửa 57 file xuống dòng; không đổi nội dung số trị/manifest nguồn.

Chạy `node --test scripts/tests/*.test.mjs web/tests/*.test.cjs` tại root;
trong `app/` chạy `npm test`, `npm run test:e2e:required`, `npm run build`,
`npm run lint`. Chỉ DB `_test` được reset, không reset development DB.
Required E2E mới có fixture polygon cắt ô/tầng, holes, solid/null/zero, CSV,
mask/model/area không tương thích, DTO và run chưa thành công.

Kết quả đợt A8: required E2E **75/75**, 0 skip (21 spatial cases); unit API
**97 pass + 1 skip** symlink Windows; web **49/49** và freeze regression **4/4**;
build/lint, JS syntax và diff check PASS. Không chạy lại full Python science
suite; required E2E có hai fixture Python thật. Smoke production bằng
`node scripts/verify-spatial-api.mjs --base <origin-trong-startup-log>` kiểm hai
run khô/mưa, self comparison, region và CSV, 5 checks PASS. Script chỉ đọc dữ
liệu và không tạo run; report local `artifacts/a8-production-api.json`.
PostgreSQL `real` được đối chiếu theo float32 round-trip, không so chuỗi thập
phân ngắn của slice với double-cast bằng equality sai kiểu biểu diễn.

Demo trên web:

1. Chọn run gốc trong selector **Kết quả mô phỏng**, bấm nút **Phân tích**,
   sau đó chọn **So sánh kết quả**.
2. Chọn **Kết quả so sánh**, chuyển **Hiển thị trên bản đồ** sang Gốc / So sánh /
   Chênh lệch. Đổi độ cao bằng slider chính, camera giữ nguyên. Bảng và biểu đồ
   trung bình đọc số thực DB; legend ΔC có dấu và tâm 0, không phải AQI.
3. Chuyển sang **Theo vùng**, nhấn **Vẽ vùng**, bấm ít nhất 3 đỉnh nằm trong
   miền rồi **Hoàn tất**. Khi vẽ chỉ hiện Hoàn tất/Hủy; Hoàn tất chỉ dùng được
   khi đủ 3 điểm. Chọn xong mới hiện biểu mẫu khoảng độ cao và ngưỡng.
   **Esc/Hủy vẽ** thoát chế độ vẽ; không chọn nhầm voxel trong lúc vẽ.
   Giao diện chỉ chọn vùng bằng cách vẽ trên bản đồ, không có nhập tọa độ.
4. Nhập **Độ cao từ / Đến độ cao (m)** và ngưỡng, nhấn **Phân tích vùng**.
   Kết quả có thẻ trung bình/cao nhất, tỷ lệ thể tích vượt ngưỡng, thể tích khí,
   câu diễn giải và bảng theo tâm tầng. **Tải CSV** chỉ hiện sau khi có kết quả.
   Đây là truy vấn run gốc, không tạo run mới. Đổi run/region/interval làm mất
   hiệu lực kết quả cũ và cần truy vấn lại. Đưa hệ số về ×1, nền 0 khi dùng phân tích.
5. Không khí không có dữ liệu trả null, không phải 0; vùng chỉ chứa solid hiện
   “Không có dữ liệu”. Gió và profile ngoài mục này vẫn của run gốc, không phải ΔC.

Trong `app/`, `npm run db:benchmark:spatial` lưu SQL timings và EXPLAIN vào
`artifacts/a8-spatial-benchmark.json` trên run FV non-mock mới nhất, không ghi DB.
Report đo self comparison và region trên 500.000 voxel, không bao gồm HTTP,
mask validation hay GPU/FPS. Có thể chỉ định `BENCHMARK_RUN_ID` và
`BENCHMARK_OUTPUT`; đây không phải SLA hoặc validation thực địa.

Browser control hiện trả “Local browser use is disabled in Work settings” dù
ảnh người dùng cho thấy Browser bật. DOM-boundary regressions không thay thế
kiểm trực quan/rendering/thao tác thật; không chốt browser QA hoặc review B8.1
chỉ từ API tests. Không bật full CDP để né quyền đó.
- [MapLibre raster tile example](https://maplibre.org/maplibre-gl-js/docs/examples/map-tiles/).
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/): giữ attribution,
  dùng HTTPS và browser caching; không bulk download/prefetch cho offline.

### Cột công cụ tinh gọn — 19/10/2026

Kết quả, độ cao và chú giải luôn hiện. Năm nút **Mô phỏng / Bản đồ / Thống kê /
Phân tích / Minh họa** chỉ mở một nhóm tại một thời điểm; bấm lại để đóng.
Các mục phụ dùng nút có tên thay vì mũi tên xổ xuống. Bấm voxel trên bản đồ
tự mở Thống kê để xem thông tin ô và profile. Chuyển khỏi Phân tích khi đang
vẽ vùng sẽ hủy chế độ vẽ, không để bản đồ bị giữ thao tác.

Thanh độ cao có chấm theo đúng vị trí tầng. Với lưới hiện tại, các mốc là
**1 / 25 / 51 / 75 / 99 m**; bấm nhãn để chuyển nhanh hoặc kéo để chọn các tầng
ở giữa. Mốc 51 m là tâm tầng thực, không đổi nhãn thành 50 m. Tiến độ và lỗi
mô phỏng vẫn hiện khi đóng nhóm công cụ; các lưu ý khoa học quan trọng được giữ.

Kiểm tra đợt UI: web **54/54**, E2E phục vụ trang/tài nguyên **13/13** PASS;
JS syntax và diff check PASS. Browser control vẫn bị tắt nên chưa xác nhận
trực quan bố cục, kéo slider và thao tác bản đồ trên trình duyệt thật.

Icon UI dùng Bootstrap Icons 1.13.2 dạng font lưu trong `web/vendor/`, kèm
MIT license, không cần CDN icon. Các nút công cụ dùng nền xanh xám nhạt;
nút đang mở dùng nền xanh đậm/chữ trắng, kèm trạng thái aria-expanded và
focus bàn phím. Test đối chiếu glyph/font và tương phản chữ >= 4,5:1 cho
trạng thái thường, hover, đang mở. Sau đổi icon/màu: web **56/56**, E2E
trang/tài nguyên **16/16** PASS (có tải cả WOFF/WOFF2). Chưa audit trực quan.

Palette hiện tại tham khảo **Arctic Reflection** trong
[Figma Neutral Palettes](https://www.figma.com/color-palettes/neutral/):
màu gốc gồm #243C4C, #5289AD, #ACBCBF, #F4FCFB, #698696. Các màu UI được
điều chỉnh thành thang xanh lam xám/trung tính để đạt tương phản, không phải
sao chép toàn bộ palette nguyên trạng. Nền cột trắng, khung #F1F4F6, nút mở
#243C4C, thao tác chính #355D75; bỏ nền kem/nâu và xanh lá của đợt trước.
Checkbox trở về ô tick và nhãn thông thường, không viền/nền/khung dạng nút;
giữ nguyên input checkbox, click nhãn và focus bàn phím. Hover/đang mở/disabled được
tách màu tương ứng; giữ nguyên logic tải/lỗi/truy vấn. Sau chỉnh phần nội dung:
web **59/59**; E2E trang/tài nguyên **16/16** ở đợt trước (không chạy lại
trong lần chỉ đổi CSS này). Test màu kiểm tương phản
chữ/ghi chú >= 4,5:1 và viền ô nhập >= 3:1 với nền trắng; không thay thế kiểm
trực quan trong browser.

### Rà luồng thao tác và cách đọc kết quả — 19/10/2026

Phân tích tách Theo vùng/So sánh kết quả để chỉ hiện một biểu mẫu. CSV nằm trong
khung kết quả, lỗi tải CSV không xóa thống kê đã tính. Đổi vùng/run/thông số sẽ
ẩn kết quả và CSV cũ; đang truy vấn chặn gửi trùng. Giá trị 0 khác thiếu dữ liệu;
không diễn giải vùng không có khí là vùng sạch. Thẻ vượt ngưỡng là phần trăm
thể tích khí có dữ liệu, không phải phần trăm diện tích đất. Bảng độ cao chỉ tính
phần tầng giao với khoảng chọn. Tất cả là dữ liệu gốc từ API, không tạo mô phỏng.

So sánh chọn kết quả thứ hai tự bật lớp chênh lệch; chỉ hiện nút cập nhật khi cần
thử lại sau lỗi. Về Theo vùng tắt lớp so sánh để tránh nhầm dữ liệu. Thống kê ghi
rõ khoảng độ cao và chế độ minh họa; Minh họa có nút Về dữ liệu gốc chỉ khi đã
đổi thông số. Chạy xong thông báo kết quả mới đang hiển thị; tắt Tòa nhà sẽ vô
hiệu hóa checkbox Chi tiết mặt đứng.

Kiểm tra: web **67/67**, E2E trang/tài nguyên **16/16**, JS syntax và diff check
PASS. Smoke API production **5/5**, đối chiếu polygon/CSV với dữ liệu thật và
không tạo run mới. Browser vẫn trả disabled, chưa kiểm trực quan/kéo bản đồ
trong browser.

### Câu chữ và thông tin kỹ thuật — 19/10/2026

Nhập vùng thủ công dùng nhãn Tọa độ các đỉnh và ví dụ tọa độ theo dòng, không
hiện cú pháp type/Polygon/coordinates. Parser vẫn nhận GeoJSON cũ; sai tọa độ
báo dòng cần sửa, vùng tự đóng. Không thay đổi định dạng polygon gửi tới API.

Thông tin kết quả chỉ hiện phương pháp, thời gian và lưu ý chưa đối chiếu đo
đạc. Mã kết quả/hash, bảng kiểm tra số học, cảnh báo gốc và liên kết tệp nằm
sau nút Chi tiết kỹ thuật (mặc định đóng, giữ trạng thái khi refresh). Cảnh báo
bổ sung có chỉ dẫn xem chi tiết; trạng thái kiểm tra chưa đạt vẫn hiện rõ.
Không gắn nhãn kiểm tra số học đạt thành xác nhận đúng với thực địa.

Chữ hướng dẫn dùng màu đậm hơn, mô tả/ngữ cảnh có khoảng cách riêng; trạng
thái chọn vùng nằm trong khối thông báo, bỏ dòng Chưa chọn vùng trùng hướng dẫn.
Kiểm tra đợt này: web **70/70**, E2E trang/tài nguyên **17/17**, JS syntax PASS.
Chưa kiểm trực quan vì công cụ browser vẫn báo disabled; không đổi palette.

Cập nhật theo phản hồi tiếp theo: bỏ hoàn toàn Chi tiết kỹ thuật và các liên
kết/bảng định danh khỏi giao diện, không chỉ ẩn. API và số liệu gốc vẫn giữ
nguyên. Tóm tắt vẫn phân biệt kiểm tra tính toán với xác nhận thực địa và báo
có cảnh báo bổ sung khi cần. Chữ thường dùng xám than, hướng dẫn 13 px;
test tương phản chữ thường/ghi chú đạt ít nhất 7:1 trên nền trắng/xám nội dung.

Lỗi phân tích được chuyển sang tiếng Việt tại giao diện: vùng tự cắt/không có
diện tích, ngoài miền, độ cao không hợp lệ, kết quả không tương thích, mất kết
nối và lỗi hệ thống. Lỗi không biết dùng thông báo chung, không xuất nguyên
tiếng Anh từ máy chủ. Kiểm tra vùng của API không thay đổi. Đã gửi một vùng
tự cắt tới API đang chạy: HTTP 400, giao diện hướng dẫn vẽ lại bằng tiếng Việt.
Kiểm tra đợt này: web **73/73**, E2E trang/tài nguyên **17/17**, JS syntax và
diff check PASS; chưa xác nhận trực quan trong browser.

Cập nhật: bỏ toàn bộ nhập vùng bằng tọa độ và parser/callback không còn dùng;
chọn vùng bằng Vẽ vùng → Hoàn tất. API polygon giữ nguyên. Nút thao tác đơn
và hàng nút trong cột điều khiển căn phải, không đảo thứ tự DOM/Tab; các mốc
slider, checkbox và ô nhập không bị dồn theo nút. Web **73/73**, E2E trang/tài
nguyên **17/17**, JS syntax/diff check PASS; chưa kiểm trực quan qua browser.

### A8 — Nghiệm thu trực tiếp và sửa lỗi picking, 20/10/2026

Browser đã dùng được; các dòng báo disabled ở các mốc 19/10 là lịch sử, không
còn là blocker hiện tại. Đã build/start monolith theo scripts trong app/package.json;
giữ nguyên development DB. Lần start đầu diễn ra trước khi build tạo dist nên
báo thiếu dist/main; sau khi build exit 0, start thành công, không sửa source để
né lỗi startup. App để chạy phục vụ demo ở origin trong log Bootstrap, cổng 3001.

Browser QA tại viewport 887×764, không giả lập kết quả:

| Luồng | Kết quả quan sát |
|---|---|
| Vẽ trên vùng có nhà/cửa sổ | Phát hiện picking mở mục Bản đồ, callback đổi tool hủy vẽ; các click tiếp theo mở Thống kê. Đã sửa: không picking nồng độ/nhà/cửa sổ trong draw mode và guard showBuildingAppearance. Test hồi quy FAIL trước sửa, PASS sau sửa |
| Polygon 4 đỉnh và 0–15 m | Mean 0,17508; max 0,50691 µg/m³; thể tích khí 348.630 m³; bảng từng tầng và CSV hiện đúng |
| Đổi khoảng 0–10 m | Kết quả/CSV cũ bị ẩn; truy vấn lại mean 0,20514 µg/m³, thể tích khí 228.010 m³ |
| Tải CSV | Browser hiện “Đã tải bảng CSV”; smoke API đối chiếu các hàng CSV với JSON |
| Vẽ lại rồi Esc | Thoát draw mode, giữ polygon trước đó; Hoàn tất chỉ bật khi đủ 3 điểm |
| Polygon tự cắt | Trả thông báo tiếng Việt hướng dẫn vẽ lại, không hiển thị kết quả/CSV sai |
| Xóa vùng | Ẩn settings/result/CSV, trở về Vẽ vùng |
| So sánh mùa khô–mưa, 25 m | Mean gốc 0,02523; so sánh 0,025787; Δmean 0,00055683 µg/m³; 8.709 ô khí |
| Gốc/So sánh/Chênh lệch | Đổi lớp trên cùng map; hai lớp nồng độ chung thang tuyến tính; ΔC có tâm 0 |
| Tự so sánh | ΔC=0; sửa nhãn -0 thành 0, có regression riêng |

Ảnh local: `artifacts/a8-acceptance/region-0-10m.png` và
`artifacts/a8-acceptance/comparison-25m.png`. Bản ghi local ở
`artifacts/a8-acceptance/acceptance.json`. Không tạo lại docs/evidence.

Freeze: clone sạch commit `1d11064` vào thư mục tạm bằng Git với
`core.autocrlf=false`, checkout detached rồi chạy `node scripts/check-freeze.mjs`.
Windows Node 22.16.0 và Linux Node 22.23.3 (image node:22-alpine, mount checkout
read-only, không network/capabilities trong container) cùng PASS 74 files và
candidate SHA `bfe88511d6764bd0ddaf690b497d6adcf55f1fdc5f8777c4ae03df5eccbb49d8`.
Linux gọi export verifyFreeze để không ghi artifacts vào mount read-only.
Không thay lock hoặc byte nội dung mô hình; không gọi đây là máy vật lý thứ hai.

Kiểm tra lại: **76 web + 4 freeze regression PASS**, **38 E2E A8/trang-tài nguyên
PASS** (21 PostGIS spatial + 17 app shell), production API smoke **5/5 PASS**,
strict freeze/build/JS syntax/diff check PASS. SQL benchmark chạy lại trên 500.000
voxel; số đo trong DATABASE.md. Không chạy lại full Python science suite.

A8.2–A8.4 đã có kiểm browser trực tiếp. A8.1 còn xác nhận contract độc lập của
B8.1; fixture/công thức đã bàn giao trong spec. Chưa chốt M7 (B8.2/B8.3 chưa
hoàn tất), chưa thay nghiệm thu mobile/performance/máy thứ hai ở tuần 10.
