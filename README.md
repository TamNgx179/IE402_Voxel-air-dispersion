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

## Demo candidate tuần 7

```powershell
$env:SOURCE_REVISION = (git rev-parse --short HEAD).Trim()
docker compose up -d --build --wait
```

Mở `http://localhost:3000`. Image gồm monolith + Python, input demo có checksum;
startup tự migrate/seed và dùng solver thật. Không cần cache dữ liệu trên host.
Chi tiết chạy local/API và test backend xem [app/README.md](app/README.md).

```powershell
node scripts/week7-checks.mjs
node scripts/rehearse.mjs
```

Hai lệnh trên chạy regression/clean-room. Báo cáo sinh local trong `artifacts/week7/`,
không lưu trong docs. Release và báo cáo cuối thuộc mốc tuần 10 theo lịch điều chỉnh.

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
