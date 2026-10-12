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

### Dọn tài liệu và mã không dùng — 12/10/2026

Sơ đồ SVG và Mermaid thống nhất Python là subprocess nội bộ của monolith.
Các tài liệu kiểm thử riêng đã bỏ khỏi `docs/`; hướng dẫn và số liệu chính được
gom tại đây và `DATABASE.md`. Gỡ helper `cellCentre`, CSS UI cũ không có caller
và registry texture rỗng; giữ pipeline khoa học/export còn được test sử dụng.
Kiểm lại: web 35/35; unit API 96 pass + 1 skip symlink Windows; required E2E
53/53, 0 skip; build/lint, JS syntax, XML SVG và diff check đều pass.
Không chạy lại full Python science suite trong đợt dọn mã này.

- [MapLibre raster source](https://maplibre.org/maplibre-style-spec/sources/).
- [MapLibre raster tile example](https://maplibre.org/maplibre-gl-js/docs/examples/map-tiles/).
- [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/): giữ attribution,
  dùng HTTPS và browser caching; không bulk download/prefetch cho offline.
