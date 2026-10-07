# app — NestJS modular monolith

Ứng dụng deployable duy nhất của dự án (ROADMAP A1.3): phục vụ API dưới `/api` và web viewer
tĩnh tại `/`. Python solver **không** phải service; `SimulationModule` spawn nó như một tiến
trình con (BR-18), mỗi lúc một tiến trình (BR-19).

## Cấu trúc module

Mỗi feature dùng cùng một quy ước để tránh trộn HTTP, nghiệp vụ và SQL:

```text
src/modules/<feature>/
├── <feature>.module.ts       # đăng ký dependency của feature
├── controllers/             # route, pipe và HTTP status; không chứa SQL
├── dto/                     # validate request/query bằng class-validator
├── schemas/                 # kiểu domain/response và state contract
├── services/                # use case và quy tắc nghiệp vụ
├── repositories/            # toàn bộ SQL/PostGIS và transaction persistence
└── infrastructure/          # adapter solver/file/manifest nếu feature cần
```

Tên file/lớp phải nêu rõ đối tượng, ví dụ `SimulationRunsService`,
`SimulationResultsRepository`, không dùng tên chung như `RunsService`. Dự án dùng PostgreSQL
thuần nên `schemas/` không phải Mongoose schema; database schema thật nằm trong
`db/migrations/`.

## Chạy

```bash
# 1. PostGIS (repo root). Mật khẩu ie402/ie402 chỉ dùng cho máy dev.
docker compose up -d db          # cổng host mặc định 5433 (đổi bằng DB_HOST_PORT)

# 2. App
cd app
npm install
cp .env.example .env             # DATABASE_URL trỏ tới container ở trên
npm run db:reset                 # xoá schema public + chạy mọi migration (máy dev)
npm run db:seed                  # nạp db/seeds/scene/ + config/project.yaml
npm run start:dev                # watch mode
# hoặc: npm run build && npm run start:prod
```

| URL | Nội dung |
|---|---|
| `http://localhost:3000/` | Web viewer 3D (phục vụ từ `<REPO_ROOT>/web`) |
| `http://localhost:3000/api/health` | Trạng thái app, thư mục artifact, Python, DB (+ phiên bản PostGIS) |
| `http://localhost:3000/api/docs` | Swagger UI |

`/api/health` luôn trả HTTP 200; `status` là `degraded` nếu Python không chạy được, thư mục
artifact chưa tồn tại / không ghi được, hoặc `DATABASE_URL` đã đặt mà DB không kết nối được
(`database.status = 'down'`). Không đặt `DATABASE_URL` thì `database.status = 'not_configured'`,
các route cần DB trả `503` và executor đứng yên.

## Cơ sở dữ liệu

SQL thuần, driver `pg`, không ORM (để `EXPLAIN` đúng câu query đã viết, BR-27). Schema:
[`docs/DATABASE.md`](../docs/DATABASE.md); migration: `db/migrations/NNNN_*.sql`.

| Lệnh | Việc |
|---|---|
| `npm run db:migrate` | áp các migration chưa chạy; ghi vào `schema_migrations` kèm checksum; chạy lại là no-op; từ chối nếu file migration đã áp bị sửa |
| `npm run db:reset` | `DROP SCHEMA public CASCADE` rồi migrate — "dựng lại sạch", **xoá mọi dữ liệu** |
| `npm run db:seed` | nạp scene package (`db/seeds/scene/`, kiểm SHA-256 từng file theo `scene_manifest.json`, sai là từ chối) và `scenarios`/`thresholds` từ `config/project.yaml` (`config_hash` = SHA-256 của file). Idempotent |
| `npm run db:seed -- --scene test/fixtures/scene` | nạp scene giả 2 × 2 ô dùng cho test |

Các lệnh đọc `app/.env` (biến môi trường thật được ưu tiên). Trong image production (không có
`tsx`): `node dist/database/cli.js migrate|reset|seed`.

## Vòng đời một run

`POST /api/runs {scenario_id, model?}` → `202 {run_id, status: "queued", attempt: 1}`; snapshot
YAML tại `PROJECT_CONFIG_PATH` (mặc định `<REPO_ROOT>/config/project.yaml`) + khối
`run: {run_id, scenario_id, model}` được lưu vào
`simulation_runs.config_snapshot` ngay lúc này, nên retry chạy lại đúng cấu hình cũ.

Executor nội bộ (`SimulationExecutorService`, không broker) poll DB mỗi `EXECUTOR_POLL_MS`, nhận run
`queued` cũ nhất bằng `FOR UPDATE SKIP LOCKED` (chỉ khi không có run nào `running`), ghi
`artifacts/<run_id>/config.yaml` rồi spawn

```text
<SOLVER_CMD…> run --run-id <uuid> --config <artifacts/<id>/config.yaml> --out <artifacts/<id>> [--mock]
```

với `cwd = REPO_ROOT`, `shell: false`. Mỗi dòng stdout JSON `{"event":"progress","stage","fraction"}`
cập nhật `progress` (fraction theo từng stage `setup|wind|transport|export`, quy về một thanh
0–1 không lùi); dòng không phải JSON bị bỏ qua. Lỗi dùng 4 KB cuối của stderr (hoặc `solver.log`).

| Kết thúc | Trạng thái |
|---|---|
| exit 0 + manifest khớp `config/manifest.schema.json` + `run_id`/model/scenario khớp + mọi artifact nằm trong thư mục run, đúng size và SHA-256 + `config.yaml` không bị đổi + `verification.status = pass` | `succeeded`; `run_metrics`, `verification_checks`, `artifacts` (kể cả `manifest`) ghi trong **một** transaction |
| exit 0 nhưng manifest/checksum sai | `failed` · `system` |
| exit 0 nhưng verification `fail` | `failed` · `model` |
| exit 2 / 3 / 4 hoặc khác | `failed` · `input` / `model` / `system` (exit 3 vẫn lưu các check để biết gate nào trượt) |
| quá `SOLVER_TIMEOUT_S` | process bị kill → `failed` · `timeout` |
| app khởi động lại khi run đang `running` | `stale` (BR-21) |

`POST /api/runs/:id/retry`: chỉ từ `failed`/`stale` → `queued`, `attempt + 1`; còn lại `409`.
`columns.csv.gz` được kiểm tra checksum rồi nạp theo batch vào `concentration_columns` trong
cùng transaction với metrics, verification checks và artifacts. Run chỉ chuyển sang
`succeeded` khi toàn bộ bước persist hoàn tất.

## Biến môi trường

Sao chép `.env.example` thành `.env` (đã gitignore). Cấu hình được kiểm tra khi khởi động
(`src/config/env.validation.ts`); giá trị sai sẽ dừng app với thông báo lỗi rõ ràng. Đường dẫn
tương đối được tính từ thư mục `app/`.

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `PORT` | `3000` | số nguyên 1–65535 |
| `REPO_ROOT` | `..` | phải là thư mục tồn tại |
| `PROJECT_CONFIG_PATH` | `<REPO_ROOT>/config/project.yaml` | config duy nhất được snapshot cho mỗi run; real E2E dùng fixture riêng |
| `ARTIFACT_DIR` | `<REPO_ROOT>/artifacts` | không bắt buộc tồn tại lúc khởi động |
| `PYTHON_BIN` | `<REPO_ROOT>/.venv/Scripts/python.exe` (Windows), `<REPO_ROOT>/.venv/bin/python` (khác) | |
| `DATABASE_URL` | — | `postgres://` / `postgresql://`; compose dev: `postgres://ie402:ie402@localhost:5433/ie402` |
| `TEST_DATABASE_URL` | `<DATABASE_URL>` đổi tên DB thành `<tên>_test` | chỉ dùng cho e2e; DB được tạo nếu chưa có |
| `SOLVER_MODE` | `mock` | `mock` thêm `--mock`; `real` chạy solver thật |
| `SOLVER_MOCK_FAIL` | — | chỉ với `mock`: `input`/`model`/`system` → `--mock-fail …` |
| `SOLVER_TIMEOUT_S` | `900` | giây, > 0 |
| `SOLVER_CMD` | `[PYTHON_BIN, "-m", "src.solver"]` | mảng JSON; chỉ từ môi trường, không bao giờ từ request |
| `EXECUTOR_ENABLED` | `true` | `false`: chỉ API, run nằm ở `queued` |
| `EXECUTOR_POLL_MS` | `1000` | ≥ 10 |

## Cấu trúc

```text
src/
├── main.ts, setup.ts        bootstrap, prefix /api, ValidationPipe toàn cục, Swagger
├── config/                  validate() cho biến môi trường
├── common/                  hash, đọc config/project.yaml
├── database/                Pool (pg), migrate.ts, seed.ts, scene-package.ts, cli.ts (db:*)
└── modules/
    ├── health/              GET /api/health
    ├── study-areas/         GET /api/study-areas
    ├── scenarios/           GET /api/scenarios
    ├── simulation/          POST /api/runs, GET /api/runs/:id, POST /api/runs/:id/retry,
    │                        executor, kiểm manifest/checksum
    └── results/             DTO → controller → service cho slices, exceedance, profile,
                             summary, volume và artifact download
test/
├── fixtures/scene/          scene package giả 2 × 2 ô (checksum thật; .gitattributes -text)
├── fixtures/fake-solver.mjs solver giả cùng CLI/contract (FAKE_SOLVER_BEHAVIOR, FAKE_SOLVER_DELAY_MS)
├── support/test-db.ts       tạo/reset/migrate/seed DB test, dựng app
└── *.e2e-spec.ts            e2e (supertest) + tích hợp PostGIS
```

## Kiểm tra

```bash
npm test           # unit (vitest)
npm run test:e2e   # e2e; các suite DB cần `docker compose up -d db`, nếu không sẽ skip kèm lý do
npm run lint       # oxlint
npm run build
```
