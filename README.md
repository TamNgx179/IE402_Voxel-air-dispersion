# IE402 — Voxel Air Dispersion

Mô phỏng lan truyền ô nhiễm không khí đô thị bằng **mô hình GIS 3D (voxel)**: trường gió bảo toàn khối lượng + phương trình tải–khuếch tán giải bằng thể tích hữu hạn trên lưới voxel. Địa bàn nghiên cứu ở Việt Nam.

Đồ án môn IE402 — GIS 3D.

## Bắt đầu

```bash
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m pytest
```

**Cần Python ≥ 3.10.** Python 3.9 hệ thống của macOS **không chạy được** — `scipy>=1.14` yêu cầu 3.10, và khi một gói không resolve thì pip huỷ toàn bộ lệnh cài. Cài bằng `brew install python@3.12`.

Trong VS Code: **Select Kernel → Python Environments → `.venv`**. Đừng chọn `/opt/homebrew/bin/python3.12` — đó là Python gốc, không có thư viện của project.

## Mô hình

Hai mô hình ghép lại trên cùng một lưới voxel:

1. **Trường gió** — mô hình chẩn đoán bảo toàn khối lượng (biến phân Sasaki, giải Poisson bằng SOR, ω = 1,78). Họ CALMET / MATHEW.
2. **Phát tán** — `∂C/∂t + ∇·(uC) − ∇·(K∇C) = S`, thể tích hữu hạn, upwind bậc 1, sơ đồ hiện.

Kèm **chùm khói Gaussian giải tích** (hệ số Briggs đô thị) làm baseline và chuẩn kiểm chứng.

> Đây **không phải** mô hình Röckle. Röckle = tham số hoá thực nghiệm 7 vùng **cộng** bảo toàn khối lượng; project chỉ cài vế thứ hai. Xem [`docs/DECISION.md`](docs/DECISION.md) §0.1.

**Lưới:** 500 × 500 × 100 m · Δx = Δy = 5 m, Δz = 2 m · 100 × 100 × 50 = **500.000 voxel**.
**Mọi mảng 3D là `[z, y, x]`.**

## Tài liệu

| File | Nội dung |
|---|---|
| [`docs/spec.md`](docs/spec.md) | Đặc tả: 25 business rule, 19 edge case, 30 acceptance criteria |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Kiến trúc, luồng dữ liệu, **các phương án bị loại và lý do** |
| [`docs/DECISION.md`](docs/DECISION.md) | Chọn mô hình nào, trade-off, so sánh với 8 họ mô hình khác |
| [`docs/RESEARCH.md`](docs/RESEARCH.md) | Khảo sát có nguồn, 339 link |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Kế hoạch 8 tuần, phân vai, output từng tuần |
| [`docs/SEMINAR.md`](docs/SEMINAR.md) | Nội dung và kịch bản seminar |

## Cấu trúc

```
src/
├── 01_voxelize.py        Tầng 0 — voxel hoá thành phố          [xong]
├── emissions.py          nguồn phát thải giao thông            [stub]
├── gaussian.py           baseline Gaussian giải tích           [xong]
├── 02_wind.py            Tầng 1 — trường gió, SOR Poisson      [stub]
├── 03_transport.py       Tầng 2 — thể tích hữu hạn             [xong]
├── 04_analysis.py        Tầng 3 — phân tích không gian         [stub]
├── 05_viz.py             hình cho báo cáo                      [stub]
├── 06_export_web.py      netCDF → JSON cho web                 [stub]
├── voxel/                lưới, chiều cao, raster, GIS, output
│   └── gob_heights.py    chiều cao từ Google Open Buildings 2.5D
└── dispersion/           Gaussian + vẽ hình
tests/                    50 test, chạy bằng pytest
notebooks/                debug 2D — viết và sửa ở 2D TRƯỚC khi lên 3D
config/project.yaml       miền, bước lưới, quy tắc chiều cao, dtype
```

Module tên `NN_name.py` **không import bằng `import` được** — tên không phải identifier hợp lệ. Nạp bằng `importlib.util.spec_from_file_location`, như test và notebook đang làm.

## Trạng thái

Tầng 0, baseline Gaussian và Tầng 2 đã xong và có test. Tầng 1 và Tầng 3 còn stub. Sản phẩm cuối là một **web 3D** (deck.gl + MapLibre) và chưa bắt đầu.

**Địa bàn:** Nguyen Hue, TP.HCM — 62 toà nhà, chốt ngày 21/09/2026 vì khối nhà trung vị phân giải được ở Δ = 5 m (4,82 voxel/cạnh), không phải vì độ phủ thẻ chiều cao.

**Chiều cao nhà:** Google Open Buildings 2.5D Temporal (2023) phủ **62/62 toà nhà** — không toà nào phải suy ra. OSM cấp hình học footprint và đóng vai đối chứng chéo, đúng [`docs/DECISION.md`](docs/DECISION.md) §5. Truy cập ẩn danh qua HTTPS, **không cần tài khoản Earth Engine**.

> 🔴 **Đừng trích con số MAE 1,5 m của Google.** Google ghi rõ độ chính xác đó *"chỉ đánh giá ở Bắc Mỹ, châu Âu và Nhật Bản — không phải Global South"*. Đối chứng tại chỗ với 21 toà nhà có thẻ OSM cho **MAE 23,2 m** (sai lệch tuyệt đối trung vị 7,0 m, r = 0,74). **Dùng 23,2 m trong báo cáo.** Sản phẩm cũng **chặn trần 100 m**, nên ba toà tháp mà OSM ghi 154 / 164,9 / 186 m trả về 88,5 / 62,5 / 91,0 m — đó là cận dưới, không phải phép đo.

**Kiểm định:** mới ở mức verification — so với nghiệm giải tích và các định luật bảo toàn. **Chưa validation** với số liệu hầm gió hay hiện trường; lý do ghi ở [`docs/DECISION.md`](docs/DECISION.md) §6.

## Quy ước git

**Không bao giờ `git add -A`, `git add .` hay `git commit -a`.** Harness ghi các file `.harness/`, `.claude/`, `CLAUDE.md`, `command-aliases.md` vào đây và chúng **cố ý không nằm trong `.gitignore`** — phải để chúng untracked và nhìn thấy được. Mỗi commit stage đường dẫn cụ thể, và chạy `git status --short` trước khi commit để chắc không có file nào của harness bị stage.
