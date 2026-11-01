# IE402 — Mô phỏng lan truyền ô nhiễm không khí đô thị bằng GIS 3D (voxel)

Đồ án xây dựng một mô hình khối không gian (voxel) để mô phỏng sự lan truyền PM2.5 theo
chiều cao trong một khu vực đô thị. Sản phẩm dùng kiến trúc **modular monolith**: một ứng dụng
NestJS duy nhất phục vụ web/API, truy vấn **PostgreSQL/PostGIS**, quản lý run và gọi pipeline
Python dưới dạng tiến trình con nội bộ. Không tách API, queue và mô phỏng thành microservice.

## Tên đề tài và phạm vi chốt

Tên đề tài: **Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D (voxel)**.

Phương pháp chính: trường gió chẩn đoán bảo toàn khối lượng và phương trình tải–khuếch tán
thể tích hữu hạn trên lưới voxel. Gaussian plume là baseline để đối chiếu. Đây là mô hình
nghiên cứu/giáo dục, chưa phải hệ thống dự báo quy chuẩn hay công cụ sức khoẻ cộng đồng.

## Kiến trúc mục tiêu

```text
Web GIS 3D
    └→ NestJS modular monolith
         ├→ PostgreSQL/PostGIS
         └→ Python solver subprocess → NetCDF/JSON artifacts
```

HTTP request không giữ kết nối cho tới khi mô phỏng xong. `SimulationModule` ghi `run_id`,
chạy Python ở nền trong cùng ứng dụng và cập nhật trạng thái. Mọi kết quả có phiên bản mô
hình, nguồn dữ liệu, tham số và provenance.

## Chạy phần mô hình hiện tại

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
```

Pipeline Python hiện tại là lõi tính toán; backend là lớp sản phẩm bao quanh lõi đó.

## Tài liệu chính

Hướng dẫn chạy và kiểm thử ở mục Demo bên dưới; ma trận ca kiểm thử tại [spec.md §5–6](docs/spec.md).

| Tài liệu | Mục đích |
|---|---|
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Research rút gọn, nguồn và lý do chọn mô hình |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kiến trúc modular monolith và luồng dữ liệu |
| [`docs/spec.md`](docs/spec.md) | Đặc tả tiếng Việt, API, dữ liệu, truy vấn và hợp đồng v1 monolith ↔ solver |
| [`docs/DATABASE.md`](docs/DATABASE.md) | ERD, index và bốn query PostGIS bắt buộc |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 10 mốc tuần có lịch sử và đợt nâng cấp, phân công A/B, không seminar |

## Chuẩn bị và chạy demo (A10.1/A10.2)

Máy chạy Compose cần Git, Docker Desktop đang dùng Linux containers, Docker Compose v2,
và cổng app/DB còn trống (mặc định 3000/5433). Cần mạng ở lần build đầu để tải image,
npm và Python packages. Input khoa học và scene đã đóng gói; không cần tải lại EDGAR/OSM.
Nền bản đồ ngoài vẫn cần mạng; không gọi toàn bộ web là offline.

Nếu có Node.js 22 và Python, kiểm tra checkout trước khi build:

```powershell
node scripts/demo-preflight.mjs
```

Lệnh chỉ đọc: kiểm ZIP và từng input bằng verifier Python hiện có, checksum các CSV scene,
revision Git, hash file runtime và tình trạng freeze cũ. Không cài input, reset DB hay sửa lock.
Kết quả lưu tại `artifacts/demo/preflight.json`; không đưa file này vào Git. Có thể chọn Python:
`node scripts/demo-preflight.mjs --python .venv/Scripts/python.exe`.

`pass` nghĩa các bước đã yêu cầu đều qua; `warning` cần đọc từng cảnh báo;
`fail` trả exit code 1. Không truyền `--url` thì API chưa được kiểm và báo `warning`.
Trước khi chốt demo, thêm `--require-clean` để checkout còn thay đổi sản phẩm trở thành lỗi;
file Harness local không được dùng làm lý do đánh dấu source sản phẩm là dirty.

**Tình trạng hiện tại:** freeze B7 là candidate lịch sử, chưa khóa lại cho writer/source mới.
Cảnh báo này thuộc B10.1 và phải được review, chạy lại bundle nghiên cứu trước khi chốt release.
Không chạy lại script tạo freeze chỉ để làm mất cảnh báo. Preflight không thay thế QG/XG,
không kiểm bitwise kết quả của một run và không chứng minh image đang chạy được build từ HEAD.

### Khởi động

```powershell
$env:SOURCE_REVISION = (git rev-parse --short HEAD).Trim()
docker compose up -d --build --wait
```

Mở `http://localhost:3000`. Image gồm monolith + Python, input demo có checksum;
startup tự migrate/seed và dùng solver thật. Không cần cache dữ liệu trên host.
Nếu cổng 3000 đang được dùng, đặt `$env:APP_HOST_PORT = '3001'` trước lệnh Compose;
kiểm tra đúng URL của stack đó, tránh mở nhầm app local cũ. Sau khởi động:

```powershell
node scripts/demo-preflight.mjs --url http://localhost:3000
```

Probe chỉ dùng GET, kiểm DB/Python/thư mục kết quả, catalog, hash/lưới scene và số lượng
nhà/đường/nước/cây trong DB so với checkout. Health HTTP 200 vẫn bị từ chối nếu DB chưa cấu hình.
Không ghi mật khẩu, URL kết nối DB hoặc đường dẫn Python/artifact từ health vào báo cáo.
Chi tiết chạy local/API và test backend xem [app/README.md](app/README.md); không dùng
`db:reset` cho dữ liệu demo đang giữ.

### Luồng trình diễn

| Bước | Thao tác | Kết quả cần thấy |
|---|---|---|
| 1 | Mở Bản đồ, xoay và phóng to/thu nhỏ | Nhà 3D từ scene; LoD đổi chi tiết, không đổi dữ liệu mô phỏng |
| 2 | Chạy kịch bản mùa khô, chờ hoàn tất | Run thành công, có kiểm tra tính toán và thời gian; không coi trạng thái queued là kết quả |
| 3 | Đổi độ cao, chuyển Chọn ô và bấm một ô | Lát ngang và profile đứng có đơn vị; NULL trong nhà khác nồng độ 0 |
| 4 | Vẽ vùng, chọn khoảng cao độ, phân tích | Trung bình/cực đại/thể tích theo vùng, tải CSV khớp kết quả đang xem |
| 5 | Vẽ tuyến và xem mặt cắt | Trục khoảng cách–cao độ, các tầng và ô solid/no-data phân biệt rõ |
| 6 | Chạy mùa mưa và so sánh hai run | Gốc/So sánh/Chênh lệch đúng dấu; khác biệt nhỏ hoặc 0 vẫn là kết quả hợp lệ |
| 7 | Tải Ảnh, CSV và JSON | Ảnh có chú giải; CSV/JSON giữ số gốc và nguồn/version, không lấy số từ màu render |

Chạy trước hai kịch bản để có kết quả dự phòng; giữ artifact gốc cùng DB, không tạo lại run khi
chỉ cần đổi góc nhìn. Trình bày rõ: đây là nồng độ mô hình theo kịch bản, không phải số đo/AQI.
Một run mất thời gian tính; chuẩn bị góc nhìn và bản xuất trước buổi demo.

### Khi gặp lỗi

| Hiện tượng | Cách kiểm và xử lý |
|---|---|
| Docker chưa kết nối | Mở Docker Desktop, chờ engine chạy; kiểm `docker compose ps` |
| App không khởi động hoặc cổng bị chiếm | Xem `docker compose logs --tail 100 app`; đổi `APP_HOST_PORT` và URL preflight |
| Health lỗi DB/Python/storage | Xem log app/DB; kiểm dung lượng và volume; không reset dữ liệu để thử |
| Checksum input/scene sai | Giữ nguyên file lỗi để đối chiếu, so với checkout đúng revision; không sửa manifest/hash cho khớp file lạ |
| Run thất bại | Mở trạng thái run và log; phân biệt input/model/timeout/system trước khi thử lại; không sửa kết quả thành công bằng tay |
| Mất mạng nền bản đồ | Dùng run và CSV/PNG/JSON đã xuất; dữ liệu khoa học local không đồng nghĩa basemap đã cache |

`docker compose stop` dừng demo và giữ volume; `docker compose up -d --wait` mở lại stack đã build.
Không dùng `down --volumes` hoặc `npm run db:reset` trên stack đang giữ kết quả.

### Kiểm trên máy vật lý thứ hai

Checkout đúng commit đã chốt, chạy cùng các bước trên, rồi lưu JSON preflight riêng:

```powershell
node scripts/demo-preflight.mjs --require-clean --url http://localhost:3000 --out artifacts/demo/second-machine.json
```

Chạy regression/clean-room độc lập khi đã chuẩn bị thời gian và dung lượng Docker:

```powershell
node scripts/week7-checks.mjs
node scripts/rehearse.mjs
```

Tên script tuần 7 được giữ để tái sử dụng. Rehearsal tạo project/volumes riêng, chạy hai run thật,
kiểm restart/query/browser rồi dọn stack nó tạo; không phải kiểm tra nhanh. Báo cáo sinh local
trong `artifacts/week7/`. Bỏ qua browser thì chỉ được coi là partial. Trên máy thứ hai còn cần
thực hiện bảng thao tác web, lưu ảnh/video dự phòng, đối chiếu run/version/hash và số liệu.
Hai container hoặc hai lần clean-room trên cùng laptop không được ghi là hai máy vật lý.

## Hướng hoàn thiện sau rà soát 27/10/2026

Yêu cầu giảng viên tập trung vào **voxel/3D Array, phát tán theo độ cao và phân tích
không gian**. LoD1 dựa trên footprint/height là baseline; không bắt buộc texture thật,
LoD2 hoặc microservice. Các yêu cầu và test liên kết tại spec §4–6.

Profile/lát ngang, phân tích vùng, comparison và mặt cắt đứng A9.3 đã có. Vào **Phân tích
→ Mặt cắt đứng → Vẽ tuyến → Hoàn tất tuyến → Xem mặt cắt**; chọn ô màu hoặc dùng phím
mũi tên để đọc giá trị, bấm Tải CSV để lấy số liệu gốc. Đóng mặt cắt để chỉnh cao độ/vẽ lại.
Icon thông tin cạnh từng mục mở giải thích ngắn khi hover, focus bằng Tab hoặc bấm;
Esc đóng trợ giúp. Nhãn, đơn vị, kết quả và lỗi vẫn hiển thị trực tiếp.
A9.2/A9.4 đã có xuất ảnh có chú giải và LoD giảm geometry (28/10). Việc tiếp theo là
review khoa học của B, nghiên cứu lưới/dt, chốt UX/chất lượng dữ liệu và bàn giao tuần 10.
LoD2 chỉ xem xét khi có nguồn mái kiểm chứng; không mặc định làm đẹp sẽ tăng độ chính xác.
Điểm số do giảng viên đánh giá, không được bảo đảm bằng số tính năng hoặc mức LoD.

## Nguyên tắc học thuật

- Không gọi mô hình hiện tại là “Röckle” hay CFD; phải nêu rõ đây là mass-consistent
  diagnostic wind + finite-volume advection–diffusion.
- Verification không được viết thành validation thực địa.
- Mỗi kết quả phải lưu tham số, nguồn dữ liệu, phiên bản code và hạn chế của mô hình.

## Xuất kết quả và LoD hiển thị (A9.2/A9.4)

- Vào **Bản đồ → Tải ảnh bản đồ** để lấy PNG của góc nhìn hiện tại, kèm legend, cao độ, run/hash, attribution và trạng thái minh họa. Chờ nền tải xong và dừng camera trước khi xuất. Khi tô ngưỡng, ảnh dùng chú giải màu ngưỡng; khi so sánh, dùng đúng thang màu/chênh lệch hiện tại.
- **Tải số liệu CSV** xuất thống kê gốc của tất cả tầng. Trong chế độ so sánh đã tải xong, nút này xuất từng ô của hai run và ΔC, kèm hai version/hash. Hệ số/nền minh họa không sửa số liệu CSV. CSV vùng và mặt cắt vẫn nằm tại kết quả phân tích tương ứng.
- **Tải thông tin kết quả JSON** lưu snapshot: đơn vị, grid, nguồn, camera, layer, điều chỉnh minh họa và dữ liệu comparison khi có. Ảnh là minh họa; CSV/JSON dùng số khoa học gốc, không giải mã ngược màu uint8.
- LoD tự đổi theo zoom: tổng quan bỏ cửa sổ/khung; trung gian giữ khoảng 1/4 cửa sổ; gần giữ đầy đủ chi tiết trong vùng nhìn. Mốc danh định 16,5/17,5, hysteresis ±0,15; culling có padding theo chiều cao/pitch. LoD này không phải hình học mái LoD2 và không đổi voxel/DB. Geometry chi tiết vẫn được giữ trong RAM để tái sử dụng; không tuyên bố giảm bộ nhớ CPU.

Đo lại CPU và kiểm bất biến số liệu khi app/DB đã chạy:

```powershell
node scripts/benchmark-lod.cjs
node --test web/tests/*.test.cjs
```

Mở `/lod-benchmark.html`, bấm **Chạy phép đo**, chờ xong rồi **Tải kết quả JSON** để đo 6 cấu hình trước/sau trên cùng camera và viewport. Mỗi cấu hình làm nóng 5 khung, đo 40 khung; tắt gió ở viewer khi đo. Đây là thời gian wall từ cập nhật camera đến `onAfterRender` trong cảnh nhà độc lập, không phải FPS toàn ứng dụng hay thời gian GPU riêng. Ghi lại môi trường/viewport và không suy rộng sang máy khác.

Lượt đo 28/10: 62 nhà, 99.280 đỉnh mặt đứng ban đầu; mức tổng quan 0, trung gian 12.468 (giảm 87,44%), chi tiết tối đa 99.280 trước culling. Miền một phần trong benchmark CPU còn 18.328 đỉnh. Browser 1280×720, DPR 1,5: p95 trước/sau lần lượt 10,4/8,5 ms (xa), 13/8,4 ms (giữa), 10,6/8 ms (gần). Kết quả từng lượt nằm local tại `artifacts/a9/lod-cpu.json` và `lod-render.json`; không coi đây là cam kết hiệu năng. Trong lượt kiểm cuối, PostgreSQL AVG có dao động round-off tối đa 5,55e-17 giữa request; raw profile và CSV lấy lại trực tiếp từ API khớp tuyệt đối. CSV từ snapshot cũng giữ nguyên.

Thông tin nguồn và chiều cao nằm trong **Bản đồ → Thông tin kết quả**. Số nhà
được tính từ thuộc tính scene; chiều cao vệ tinh/số tầng/thay thế không được coi
là đo đạc thực địa. JSON xuất giữ nguồn đầy đủ và thống kê này trong `metadata.scene_quality`.

Writer cột mới dùng cùng float32 như NetCDF và 9 chữ số có nghĩa; API đọc float8
để giữ giá trị đã lưu. Các run cũ xuất `.6g` giữ nguyên artifact/hash và giới hạn
làm tròn lịch sử; tạo run mới nếu cần bộ dữ liệu demo theo contract precision mới.

Đối chiếu đề cương IE402 và rubric A4 (nội dung, so sánh/lập luận/số liệu; slide và báo cáo giấy)
nằm trong [ROADMAP §2](docs/ROADMAP.md), yêu cầu nghiệm thu ở [spec §4–6](docs/spec.md).
Bảng lựa chọn mô hình GIS ở [RESEARCH §1](docs/RESEARCH.md), ánh xạ điểm/đường/mặt/khối vào DB
ở [ARCHITECTURE §3](docs/ARCHITECTURE.md). Báo cáo/slide cuối chưa hoàn thành chỉ bằng việc có web;
A2/A3 được đánh giá riêng. Không khôi phục seminar hoặc các file nháp đã bỏ.
