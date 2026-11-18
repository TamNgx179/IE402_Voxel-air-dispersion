# NestJS backend

The application serves the WebGIS and the REST API on the same origin. PostGIS stores the study area, run state and concentration arrays. The internal executor launches one Python solver child process at a time.

## Module layout

```text
src/modules/<feature>/
├── controllers/  HTTP routes and response status
├── dto/          validated request and query inputs
├── models/       SQL, typed database access and transactions
├── schemas/      TypeScript contracts for domain and response data
└── services/     use cases and boundary adapters
```

Each feature declares its providers in its Nest module. Folders are present where the feature needs them. SQL migrations in [db/migrations](../db/migrations) define the database schema. PostgreSQL access uses `pg` and parameterized SQL.

| Module | Responsibility |
| --- | --- |
| Health | Application, artifact storage, Python and database diagnostics |
| Study areas | Study grid and vector scene layers |
| Scenarios | Seasonal wind and emission configuration |
| Simulation | Run creation, idempotency, status, retry, executor and artifact verification |
| Results | Slices, profiles, regions, vertical sections, road corridors, comparisons and downloads |

## Run locally

From the repository root, start PostGIS and build the viewer. The default database listener is port 5433.

```bash
docker compose up -d --wait db
npm ci --prefix frontend
npm --prefix frontend run build
cd app
npm ci
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run start:dev
```

In PowerShell, use `Copy-Item .env.example .env` for the environment file. Use `npm run build` and `npm run start:prod` to run the compiled server. The root [README](../README.md) covers the full Docker setup and Python dependencies for real simulations.

| URL | Purpose |
| --- | --- |
| `http://localhost:3000/` | React build from `frontend/dist`, or the fallback viewer before a build |
| `http://localhost:3000/legacy/` | Compatibility viewer from `frontend/legacy` |
| `http://localhost:3000/api/health` | Health details returned as HTTP 200 with `ok` or `degraded` status |
| `http://localhost:3000/api/docs` | Swagger UI and request schemas |

With no database configured, the health response reports `not_configured`, database routes return HTTP 503, and the executor remains idle.

## Database commands

- `npm run db:migrate` applies pending migrations and checks the hashes of applied files.
- `npm run db:seed` verifies scene checksums, then upserts the scene, scenarios and thresholds.
- `npm run db:seed -- --scene test/fixtures/scene` loads the small test scene.
- `npm run db:reset` drops and recreates the public schema. It deletes all data in the selected development database.
- `npm run db:benchmark:spatial` records PostGIS plans and timings when `BENCHMARK_RUN_ID` points to a completed run.

The runtime image runs `node dist/database/cli.js migrate|reset|seed`. See the [database design](../docs/DATABASE.md) for tables, vertical arrays and spatial indexes.

## Simulation and result queries

`POST /api/runs` returns HTTP 202 and saves the configuration snapshot before the executor claims the run. Reuse the same `request_id` and body after a lost response. The executor claims the oldest queued run under a transaction-scoped advisory lock. The [Python adapter](src/modules/simulation/services/python-solver.adapter.ts) launches the configured CLI with an argument array and translates its progress and exit status.

The executor verifies the manifest, run identity, configuration hash and artifact checksums before publishing. Column import, metrics, checks, artifact records and success state are persisted in one transaction. A timeout records a timeout failure. A run interrupted by restart can become stale. Only failed and stale runs can be retried, using the stored snapshot.

The results modules read saved values. A profile uses indices `i,j`. A transect accepts a WGS84 LineString and a height interval, samples the line at metric spacing and looks up the containing voxel. Region and corridor statistics use horizontal intersection area and vertical overlap. The [specification](../docs/spec.md) covers limits and response contracts.

## Environment variables

The application reads `app/.env` and process environment variables. Relative paths resolve from `app/`.

| Variable | Default or purpose |
| --- | --- |
| `PORT` | `3000` |
| `REPO_ROOT` | `..` |
| `PROJECT_CONFIG_PATH` | `<REPO_ROOT>/config/project.yaml` |
| `ARTIFACT_DIR` | `<REPO_ROOT>/artifacts` |
| `PYTHON_BIN` | Python executable in the repository's `.venv` |
| `DATABASE_URL` | PostgreSQL connection URL |
| `TEST_DATABASE_URL` | Integration database whose name must end in `_test` |
| `SOLVER_MODE` | `mock` locally. Docker sets `real`. |
| `SOLVER_MOCK_FAIL` | Optional `input`, `model` or `system` failure in mock mode |
| `SOLVER_CMD` | JSON array defaulting to `[PYTHON_BIN, "-m", "src.solver"]` |
| `SOLVER_TIMEOUT_S` | `900` seconds |
| `EXECUTOR_ENABLED` | `true` |
| `EXECUTOR_POLL_MS` | `1000` milliseconds |

## Tests

```bash
npm test
npm run build
npm run test:e2e:required
```

`npm test` runs the unit specs next to the sources. They mock the models and the `pg` pool, so they need neither PostgreSQL nor Python: request DTOs through the global `ValidationPipe`, the migration runner against the real `db/migrations`, the connection pool and health probe, and the run, region, comparison, corridor and transect services.

The required integration suite uses PostGIS, Supertest and the Python test fixture. It rebuilds a separate test database and fails when database-dependent tests are skipped. See the root [README](../README.md#verify-and-reproduce) for the clean Compose rehearsal.
