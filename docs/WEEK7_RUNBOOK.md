# Tuần 7 — Đóng gói và nghiệm thu candidate

Mục tiêu là tái lập scene → solver thật → PostGIS → web, lưu bằng chứng và
chuẩn bị bản nháp báo cáo. Đây là candidate tuần 7; release tag và báo cáo
cuối kỳ vẫn thuộc tuần 8.

## 1. Hai cách chạy

### Demo Docker

Yêu cầu Docker Engine/Compose hỗ trợ `!reset`/`!override` nếu chạy nghiệm thu
clean-room, ít nhất 2 GB RAM trống, cổng 3000 và 5433 chưa có tiến trình khác.
Không cần Node, Python venv hoặc thư mục `data/` trên host cho demo Docker.

Tại repository root trong PowerShell:

```powershell
$env:SOURCE_REVISION = (git rev-parse --short HEAD).Trim()
docker compose up -d --build --wait
```

Mở `http://localhost:3000`. App mặc định `SOLVER_MODE=real`; startup kiểm
bundle, migrate và seed trước khi nhận request. Nếu startup lỗi, container
không được coi là healthy. `/api/health` phải có `status=ok`, Python OK,
DB/PostGIS up và artifact directory writable.

```powershell
docker compose ps
docker compose logs --tail 100 app
Invoke-RestMethod http://localhost:3000/api/health
```

Linux/macOS:

```bash
export SOURCE_REVISION="$(git rev-parse --short HEAD)"
docker compose up -d --build --wait
```

Nếu working tree có thay đổi, dùng suffix `-dirty` hoặc build sau commit.
Không gán revision của một bản khác cho code đang build. Nếu không truyền
revision, image báo `unknown`; đó không phải đủ bằng chứng release.

### Chạy local để phát triển

Giữ Docker cho DB; chạy app bằng Node và solver bằng venv:

```powershell
docker compose up -d db
.venv/Scripts/python.exe -m src.demo_bundle install
cd app
npm.cmd ci
$env:DATABASE_URL='postgres://ie402:ie402@localhost:5433/ie402'
$env:SOLVER_MODE='real'
npm.cmd run build
node dist/database/cli.js migrate
node dist/database/cli.js seed
node dist/main.js
```

Installer từ chối ghi đè input local khác checksum. Với người đang thử input
khoa học riêng, giữ chúng và dùng Docker/checkout khác để demo; không xoá
hoặc thay input để làm một lượt test trông xanh.

## 2. Dữ liệu nào nằm trong image?

| Thành phần | Nguồn | Kiểm tra trước khi sử dụng |
|---|---|---|
| GIS scene | `db/seeds/scene/` | SHA-256 trong scene manifest |
| Voxel mask | `deploy/demo-inputs/inputs.zip` | Archive/file digest và scene digest |
| Source transport | Cùng bundle | Source đã chuẩn hóa EDGAR, giữ nguyên byte |
| Tham số | `config/project.yaml` | Snapshot per run; candidate freeze |
| Solver runtime | `requirements-solver-lock.txt` | Phiên bản được khóa trong image |
| Web/API | Build từ checkout | Image revision và per-run model version |

Bundle không chứa raw EDGAR toàn cầu, traffic counts hoặc API key. Nó chứa
hai NetCDF production đã chuẩn hóa, dung lượng nhỏ, kèm attribution và
normalization metadata. Script installer không thay phương trình hoặc tính
lại phát thải. Thay dữ liệu/tham số phải review và tạo bộ evidence mới.

Các thư mục host `data/`, `cache/`, `.venv/`, `.env`, `artifacts/` bị loại khỏi
build context. Image không dựa vào dữ liệu ẩn trên máy người phát triển.

Nguồn/runtime có thể tải khi **build image**. Chạy seed/solver sau khi build
không tải dữ liệu khoa học. Thư viện CDN và basemap của browser vẫn cần
Internet; candidate này chưa cam kết browser chạy offline hoàn toàn.

## 3. Vòng đời volume

`pgdata` lưu DB, `artifacts` lưu file kết quả. Restart app chạy migrate/seed
idempotent và giữ completed runs. App chạy dưới user `node`, Node trực tiếp
là process chính sau entrypoint; Compose dùng `init: true`.

```powershell
docker compose stop
docker compose up -d --wait
```

Hai lệnh trên giữ dữ liệu. Không dùng `db:reset` hoặc `down --volumes` trên
stack development để nghiệm thu. Reset schema chỉ được phép trong DB test
có hậu tố `_test`; clean-room tạo project/volume riêng.

## 4. Clean-room tự động

Script cần Node 24 trên host, Docker và Chrome/Edge/Chromium. Windows tự
tìm Chrome hoặc Edge ở đường dẫn chuẩn; đường dẫn khác đặt `BROWSER_BIN`.
Browser dùng profile mới dưới `artifacts/`, không dùng profile cá nhân.

```powershell
node scripts/rehearse.mjs
```

Script thực hiện:

1. Sinh project name riêng, kiểm tra project chưa tồn tại.
2. Validate Compose, không publish DB port và không mount dữ liệu host.
3. Build app, dựng DB/artifact volume mới và chờ health.
4. Kiểm DB chưa có run, scene đúng counts, seed lần hai không nhân bản.
5. Tạo hai FV run production qua HTTP và chờ `succeeded`.
6. Kiểm gates, mass ledger, 500.000 voxel, identity và build revision.
7. Đối chiếu slice/profile/summary/exceedance bằng số liệu chính xác.
8. Download mọi artifact và kiểm size/SHA-256.
9. Capture benchmark p50/p95 và EXPLAIN cho bốn query.
10. Restart app và xác nhận completed runs/hashes còn nguyên.
11. Browser mở scene, đổi run/tầng, chọn ô, xem evidence và chụp ảnh.
12. Ghi report/log rồi dọn đúng project/volume vừa tạo.

Để giữ stack nghiệm thu lại bằng tay:

```powershell
node scripts/rehearse.mjs --keep --port 3107
```

Report ghi project name và URL; dọn sau bằng chính project name đó. Không
thay project name thành stack development. `--skip-browser` sinh trạng thái
`partial`, không đủ để chốt A7.6. `--skip-build` dùng image của project nếu
đã chuẩn bị; mặc định luôn build từ checkout.

## 5. Regression suite

Venv cần các dependency trong `requirements.txt`; app đã `npm ci`; DB dev
đang up để required E2E tạo DB riêng `_test`.

```powershell
node scripts/check-freeze.mjs
node scripts/week7-checks.mjs
```

Script regression lưu JUnit Python, JSON Vitest, logs, dependency inventory
và trạng thái từng suite dưới `artifacts/week7/checks/`. Python chạy Agg để
không phụ thuộc Tk; thư mục tạm nằm trong workspace. Required E2E thất bại
nếu DB thiếu hoặc suite skip. Một unit symlink có thể skip trên Windows
chưa bật Developer Mode; count vẫn hiển thị, không bị giấu.

Full Python không được chốt B7.1 nếu có failures/errors hoặc science tests
skip không giải thích được. Chạy `--skip-e2e` chỉ để debug local; report là
partial, không dùng để nghiệm thu.

## 6. Số liệu khoa học cuối candidate

```powershell
$env:MPLBACKEND='Agg'
.venv/Scripts/python.exe -m src.production_study --out artifacts/week7/production
.venv/Scripts/python.exe -m src.production_analysis --root artifacts/week7/production --include-root artifacts/week7/no-extra-cases
.venv/Scripts/python.exe -m src.week7_report --root artifacts/week7/production
node scripts/evidence-index.mjs
```

Năm case phải dùng cùng candidate version: khô, mưa, K×0,5, height×0,8,
height×1,2. Sensitivity geometry chỉ nằm offline, không import vào DB scene
baseline. `week7_report` kiểm lại manifest và mọi artifact trước khi sinh
CSV/caption; không lấy số từ run cũ trong tài liệu.

`production_analysis` xuất 4 hình 300 dpi: geometry overlay, hội tụ,
profile theo chiều cao và lát cắt. `report-assets.json` lưu captions,
hashes, run IDs, units và claim boundaries. `evidence-index.json` liên kết
QG-1…QG-10 với report đã kiểm; bằng chứng thiếu có trạng thái pending.

## 7. Dashboard provenance

Trong viewer mở **Tùy chọn bản đồ → Thông tin kết quả**:

- Run ID, model version, full input hash và units.
- Runtime, simulated time, steps, dt, tiêu chí dừng và residual.
- Emitted/remaining/escaped mass và correction.
- Mỗi gate: trạng thái, value và tolerance.
- Warnings và link tới JSON summary/artifact checksums.

Các giá trị trên đọc từ summary API, không decode từ uint8. Thay hệ số
nguồn/nền minh họa không thay đổi provenance/verification của solver.
Warnings được render như text; run switch không giữ dashboard của run cũ.

## 8. Bằng chứng và giới hạn

| Bằng chứng | Đường dẫn local |
|---|---|
| Regression tổng | `artifacts/week7/checks/checks.json` |
| Python JUnit | `artifacts/week7/checks/python-junit.xml` |
| Clean-room tổng | `artifacts/week7/cleanroom/rehearsal.json` |
| Browser screenshots/log | `artifacts/week7/cleanroom/browser/` |
| Production five cases | `artifacts/week7/production/study.json` |
| Figures/tables | `artifacts/week7/production/report-assets.json` |
| Ma trận gates | `artifacts/week7/evidence-index.json` |

Generated files và snapshot chỉ lưu local trong `artifacts/week7/`, không commit
vào docs. Sau khi tái lập đủ regression, production, analysis/report và clean-room:

```powershell
node scripts/evidence-index.mjs
node scripts/snapshot-week7.mjs
node scripts/verify-week7-snapshot.mjs
```

Snapshot ở `artifacts/week7/week7-candidate.json` ghi kết quả và hash của report
local. Lệnh verify chỉ kiểm snapshot/code/freeze, không chạy lại solver hoặc browser.
Checkout mới cần tái tạo reports trước; không coi thiếu snapshot là đã test PASS.
Fresh volumes trên Docker host hiện tại chưa thay thế kiểm tra máy vật lý
thứ hai ở tuần 8. Browser screenshot mobile chưa phải FPS/usability audit.
Mô hình được verification bằng nghiệm giải tích và sensitivity; chưa có
validation bằng quan trắc thực địa hoặc wind tunnel.
