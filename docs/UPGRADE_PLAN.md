# IE402 upgrade proposal

This proposal maps the Chapter 7 and Chapter 8 lectures to an upgrade of the Nguyễn Huệ PM2.5 project. The demo uses a NestJS modular monolith, PostGIS and a Python subprocess. The road corridor analysis and the React viewer (`frontend/`, served at `/`; the previous viewer remains at `/legacy/`) are implemented. The modular monolith is the submission architecture.

## What the lectures add

| Course reference | Project decision | Evidence for assessment |
| --- | --- | --- |
| Chapter 7, PDF pp. 5–7 | Document the conceptual, logical and physical models separately. | Show entities and relations first, then keys, voxel indexing and finally SQL types and indexes. |
| Chapter 7, PDF pp. 9–12 | Describe WebGIS presentation, application and data layers. Run numerical jobs asynchronously inside the application deployment. | Explain why solver jobs and interactive queries have different resource needs. Demonstrate that interactive queries remain usable during a solver run. |
| Chapter 7, PDF pp. 18–22 | Use geometry types and SRIDs deliberately. Demonstrate relationship, measurement and processing operations. | Show the SQL, its plan and the corresponding map result. Document actual format and index support. |
| Chapter 8, PDF pp. 5–11 | Separate a lookup, an analysis and a simulation. Use the six-step workflow to design the study. | Trace one question from inputs and CRS through method, verification and presentation. |
| Chapter 8, PDF pp. 13–19 and 22 | Combine multiple road buffer bands with voxel overlay and altitude ranges. | Verify disjoint bands, partial intersections and air volume. Report the sensitivity to band widths. |

The PDF references use page numbers starting at the cover.

## Data models

| Level | Representation |
| --- | --- |
| Conceptual | A study area contains roads, buildings and a voxel grid. Each simulation run produces a concentration field. A corridor band intersects part of that field at a selected elevation range. |
| Logical | Keep vector footprints and road centerlines, a regular 3D array for the field, and relational links between scene, run and artifacts. Grid neighbors follow the six faces of a cell. Store provenance and the solid mask with a defined scene revision. |
| Physical | Store projected geometry in EPSG:32648, concentration profiles by `(run_id, i, j)` and NetCDF for full fields. Use GiST for spatial candidate selection and B-tree keys for run and grid joins. Convert to WGS84 at the web boundary. |

A regular 3D array fits the FV stencil and altitude profiles. B-Rep is useful for detailed building surfaces but adds geometry work at voxelization. CSG is useful for composing designed solids. The hybrid vector/voxel model keeps urban feature identity and efficient field computation. Display LoD and solver resolution should be measured separately. The [architecture document](ARCHITECTURE.md) has a 2×2×4 example for demonstrating the indexing and partial-volume calculation.

## Priority analysis: road proximity and PM2.5 by altitude

The first implementation exposes `POST /api/runs/:id/road-corridor` and the corresponding `/csv` route. Use road `source_feature_id` values from the run's scene and send increasing outer distances, a height interval and an optional threshold. Repeat the query at different height intervals to compare altitude bands. The response includes band geometry, valid coverage and volume-weighted statistics. Both viewers expose it under Analysis → Road corridor (React: `frontend/src/panels/analysis/corridor/`; legacy: `web/viewer-corridor.js`). Roads are picked on the map or from a keyboard-accessible list, and bands are drawn on the map with a per-band table and CSV download.

Run `npm run db:benchmark:spatial` from `app/` with a verified FV run in the target database. The benchmark uses the endpoint's SQL for one-road and broad corridor requests.

The local benchmark on FV run `2a3ab50e-2202-4b14-9209-3ab1fba4fd92` recorded SQL p50/p95 of 51/81 ms for one road at 1–15 m and 1994/2265 ms for 50 roads at 0–100 m. These are 20 samples per query after three warmups on the 100 × 100 × 50 grid. The report with execution plans is in `artifacts/road-corridor-benchmark.json`.

1. **Question.** Within one modeled run, how do average concentration and volume above a selected reference value vary with distance from selected roads and elevation?
2. **Data.** Use verified run outputs, centerlines and the matching scene. Validate geometries, transform inputs to the projected CRS, and keep missing data distinct from zero and solid cells.
3. **Method.** Begin with illustrative bands 0–10, 10–25 and 25–50 m. Dissolve overlapping buffers from the selected roads and form disjoint bands with differences of cumulative buffers. Clip to the study area. Select candidate cells using their XY footprints, then compute exact XY overlap and intersect the requested altitude interval with each cell's vertical interval.
4. **Execute.** Weight each valid air value by its intersected volume, calculated as XY overlap area times vertical overlap thickness. Report air volume, valid coverage, volume-weighted mean and volume strictly above the chosen value. Bands without valid volume have no mean. Apply the same masks and bands when comparing runs.
5. **Verify.** Use an independent hand-calculated fixture for touching boundaries, partial XY and z overlap, overlapping road buffers, missing values, zero values, solid cells and threshold equality. Compare the aggregate and CSV against a reference. Measure SQL with `EXPLAIN (ANALYZE, BUFFERS)` for narrow and wide requests and report dataset size, candidate counts and repeated latency. A large query may legitimately choose a sequential scan.
6. **Present.** Show a band map, altitude chart and table with units, run ID, band widths and valid coverage. Repeat with alternative widths. Report sensitivity and uncertainty. The modeled difference describes the chosen inputs and scenario.

Use `ST_DWithin` for distance-based filtering, `ST_Buffer` for constructing areas, and `ST_Intersection` and `ST_Area` for overlap weights. The calculation combines planar geometry and vertical interval math. [PostGIS distance queries](https://postgis.net/documentation/tips/st-dwithin/).

## Submission architecture and delivery order

React calls NestJS REST. NestJS owns the run lifecycle, spatial queries and imports. PostgreSQL/PostGIS persists the queue and GIS data. The executor runs the existing Python CLI in a supervised child process and validates its artifacts before import. Docker Compose deploys the application and database. One active solver is the submission default.

| Part | Owner | Remaining work and acceptance |
| --- | --- | --- |
| 1. PostgreSQL/PostGIS | Tâm | Audit the actual schema through 3NF for core relational tables. Explain physical voxel storage and historical snapshots. Verify historical run/scene/threshold consistency. Review indexes against the production SQL, benchmark narrow and broad cases, and publish the query plans and correctness checks. The corridor API, CSV and initial benchmark already exist. |
| 2. React WebGIS | Tâm | Accept the implemented React UI in a real browser and a clean Compose build. Exercise both locales, mobile, selection and exports. Confirm locale switching preserves run, layer and map state. |
| 3. Solver reliability | Tâm | Retain the existing PostgreSQL claim lock and Python executor. Verify one active child under concurrent requests, lost POST response, timeout, restart, DB interruption and failed import. Fix gaps found by those checks. |
| 4. Technical release | Tâm | Run independent CI and clean Compose from one pinned revision. Check inputs, migrations, actual FV runs, API/CSV parity and shipped notices. Complete A10.5 with the ERD, query plans and verified deployable demo. |

### Database normalization and index acceptance

- Identify candidate keys and functional dependencies from migrations and domain rules. For core relational tables, record scalar domain values for 1NF, absence of partial dependencies on candidate keys for 2NF, and for 3NF require each nontrivial dependency to have a superkey determinant or a prime dependent attribute. Document any justified exception. Check PK, FK, UNIQUE, NOT NULL and CHECK coverage with positive and negative cases.
- Audit how result columns resolve the study area through the run and scenario, and distinguish live grid metadata from run snapshots. Document what is authoritative and what is a frozen historical snapshot or an intentional physical optimization. Explain vertical arrays as dense numerical fields with fixed length and k-to-array indexing. Check shape, mask, units and precision against NetCDF. Show a logical per-voxel representation and explain the physical layout separately.
- Inventory existing indexes and map each to a real predicate or join. Check the result key `(run_id, i, j)`, grid joins, foreign-key access paths, road lookup by study area and feature ID, and GiST on projected spatial footprints. Keep indexed geometry in its stored CRS and transform inputs. Check for redundant indexes before adding any. Evaluate partial indexes for the queue only if plans justify them.
- Run `ANALYZE` on a representative dataset, then capture `EXPLAIN (ANALYZE, BUFFERS)` for slice, profile, region, transect, comparison and road corridor. Record rows estimated and returned, scan type, buffer activity, p50/p95, dataset size, query parameters and index size. Measure before and after any change with the same inputs and check import cost and result parity. Explain sequential scans when most rows qualify. See [PostgreSQL indexes](https://www.postgresql.org/docs/current/indexes.html) and [PostGIS spatial indexing](https://postgis.net/workshops/postgis-intro/indexing.html).

### Solver recovery acceptance

| Trigger | Expected behavior |
| --- | --- |
| Concurrent claims or lost HTTP response | Claim at most one run at a time. Reuse the existing run for the same request identifier and payload. |
| Timeout, shutdown or restart | Terminate and reap the old child before starting a replacement. Persist a clear outcome for an interrupted run and allow a controlled retry. |
| Incomplete artifacts or failed model checks | Reject publication, retain diagnostics and keep attempt outputs separate. |
| Database interruption or import failure | Do not publish partial results. Verify rollback or the committed state before retrying. |

Use real PostGIS for claims and import checks, controlled child processes for failure cases, and the release FV runs for scientific parity.

### PostGIS query contract

| Operation | Implementation to demonstrate | Acceptance |
| --- | --- | --- |
| Viewport slice and point profile | Project the request to EPSG:32648. Use indexed footprint candidates for a slice and deterministic grid indexing for a profile. Read array index `k + 1`. | Correct shared edges, upper boundary and out-of-domain behavior. Compare both results with the same NetCDF run. |
| Road proximity and overlay | Generate dissolved distance bands, clip to the domain, select grid candidates with `ST_Intersects` and compute exact XY overlap. Combine it with vertical interval overlap. | Disjoint bands and correct partial-volume weights, coverage and threshold equality. |
| Region and transect | Use overlap-weighted region stats. Sample transects at measured distances in the projected CRS with an explicit boundary rule. | Hand-check region volume and sample coordinates. Match CSV and API results for solid, missing and zero values. |
| Run comparison | Match scene, grid and mask before comparing by `(i,j,k)`. Use common bands and valid cells for corridor comparisons. | Reject incompatible inputs. Verify self-difference equals zero and export a signed difference with run metadata. |

Document input/output SRIDs, units, indexes and null semantics for each operation. Record `EXPLAIN (ANALYZE, BUFFERS)` and repeated timings against the exact production SQL at representative scales. Chapter 7 evidence is the three-level model, deployment diagram, ERD, SQL and plans. Chapter 8 evidence is one complete buffer/overlay study with a stated question, reproducible inputs, checks, sensitivity and presentation.

## Tóm tắt tiếng Việt

Ưu tiên bổ sung phân tích **khoảng cách đến đường × độ cao** và kiểm số liệu trên PostGIS. Đây là bài toán dùng trực tiếp buffer, overlay và quy trình kiểm chứng của Chương 8. Chương 7 được thể hiện bằng mô hình ba mức, ERD, SRID, chỉ mục và sơ đồ triển khai.

Giữ modular monolith, nghiệm thu React song ngữ và kiểm tra vòng đời tiến trình Python. Tâm chốt chuẩn hóa, chỉ mục và benchmark. Thanh đối chiếu số liệu độc lập và chốt bộ kết quả khoa học. Báo cáo mức 9–10 cần lập luận, số liệu, minh họa và kiểm chứng nhất quán. Xem [đối chiếu rubric](ROADMAP.md#đối-chiếu-rubric-ie402--cập-nhật-01112026) để chốt bản nộp.
