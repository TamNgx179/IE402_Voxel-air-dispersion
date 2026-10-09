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

Hướng dẫn thao tác viewer, test tự động và demo production: [TEST_DEMO.md](docs/TEST_DEMO.md).

| Tài liệu | Mục đích |
|---|---|
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Research rút gọn, nguồn và lý do chọn mô hình |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kiến trúc modular monolith và luồng dữ liệu |
| [`docs/spec.md`](docs/spec.md) | Đặc tả tiếng Việt, API, dữ liệu, truy vấn và hợp đồng v1 monolith ↔ solver |
| [`docs/DATABASE.md`](docs/DATABASE.md) | ERD, index và bốn query PostGIS bắt buộc |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Kế hoạch 8 tuần, phân công A/B, không seminar |

## Nguyên tắc học thuật

- Không gọi mô hình hiện tại là “Röckle” hay CFD; phải nêu rõ đây là mass-consistent
  diagnostic wind + finite-volume advection–diffusion.
- Verification không được viết thành validation thực địa.
- Mỗi kết quả phải lưu tham số, nguồn dữ liệu, phiên bản code và hạn chế của mô hình.
