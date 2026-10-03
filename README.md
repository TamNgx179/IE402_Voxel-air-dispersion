# IE402 — Mô phỏng lan truyền ô nhiễm không khí đô thị bằng GIS 3D (voxel)

Đồ án xây dựng một mô hình khối không gian (voxel) để mô phỏng sự lan truyền PM2.5 theo
chiều cao trong một khu vực đô thị. Hệ thống gồm **NestJS API**, **PostgreSQL/PostGIS** và
một **Python simulation worker**. API tiếp nhận kịch bản, truy vấn dữ liệu không gian và
điều phối worker; worker là nơi chạy voxelisation, trường gió, transport và kiểm chứng.

## Tên đề tài và phạm vi chốt

Tên đề tài: **Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D (voxel)**.

Phương pháp chính: trường gió chẩn đoán bảo toàn khối lượng và phương trình tải–khuếch tán
thể tích hữu hạn trên lưới voxel. Gaussian plume là baseline để đối chiếu. Đây là mô hình
nghiên cứu/giáo dục, chưa phải hệ thống dự báo quy chuẩn hay công cụ sức khoẻ cộng đồng.

## Kiến trúc mục tiêu

```text
Web 3D / Client → NestJS API → PostgreSQL/PostGIS
                         └────→ Python Simulation Worker
                                  └→ NetCDF/JSON artifacts + metrics về DB
```

API không thực hiện vòng lặp số nặng. Worker không nhận request trực tiếp từ trình duyệt.
Mọi kết quả có `run_id`, trạng thái, phiên bản mô hình, nguồn dữ liệu và tham số.

## Chạy phần mô hình hiện tại

```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
```

Pipeline Python hiện tại là lõi tính toán; backend là lớp sản phẩm bao quanh lõi đó.

## Tài liệu chính

| Tài liệu | Mục đích |
|---|---|
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Research rút gọn, nguồn và lý do chọn mô hình |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kiến trúc API–worker–DB và luồng dữ liệu |
| [`docs/spec.md`](docs/spec.md) | Đặc tả tiếng Việt, API, dữ liệu và truy vấn |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Kế hoạch 8 tuần, phân công A/B, không seminar |

## Nguyên tắc học thuật

- Không gọi mô hình hiện tại là “Röckle” hay CFD; phải nêu rõ đây là mass-consistent
  diagnostic wind + finite-volume advection–diffusion.
- Verification không được viết thành validation thực địa.
- Mỗi kết quả phải lưu tham số, nguồn dữ liệu, phiên bản code và hạn chế của mô hình.
