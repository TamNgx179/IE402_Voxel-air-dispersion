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
Việc tiếp theo là review khoa học của B, nghiên cứu lưới/dt, export ảnh có chú giải và LoD
hiển thị giảm geometry thật; các phần đó chưa được nghiệm thu chỉ nhờ hoàn tất A9.3.
LoD2 chỉ xem xét khi có nguồn mái kiểm chứng; không mặc định làm đẹp sẽ tăng độ chính xác.
Điểm số do giảng viên đánh giá, không được bảo đảm bằng số tính năng hoặc mức LoD.

## Nguyên tắc học thuật

- Không gọi mô hình hiện tại là “Röckle” hay CFD; phải nêu rõ đây là mass-consistent
  diagnostic wind + finite-volume advection–diffusion.
- Verification không được viết thành validation thực địa.
- Mỗi kết quả phải lưu tham số, nguồn dữ liệu, phiên bản code và hạn chế của mô hình.
