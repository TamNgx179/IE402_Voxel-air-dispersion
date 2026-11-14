# IE402 requirements specification

The project models passive PM2.5 dispersion in a 3D voxel array for Nguyễn Huệ Walking Street. Users can inspect concentration by location and altitude and compare compatible simulation runs. The [Vietnamese baseline specification](spec-baseline.vi.md) preserves existing BR, EC and AC identifiers and acceptance cases. Those requirements continue to apply unless the target deployment below explicitly supersedes them.

## 1. Objectives

Demonstrate 3D data modeling, spatial query design and a reproducible GIS analysis. The assessment evidence includes a conceptual model, logical ERD, physical PostGIS schema, working SQL, numerical checks, and figures and tables traceable to one verified revision.

## 2. Constraints

- Use a diagnostic mass-consistent wind field and finite-volume transport. Gaussian is a labeled baseline.
- The reference domain is 500 × 500 × 100 m. Read grid dimensions from configuration. Store the field in `[z,y,x]` order with explicit units and coordinates.
- Use EPSG:32648 for metric area and distance in the study area and WGS84 at the browser boundary. Distinguish cell centers from boundaries and distinguish solid, missing and zero values.
- Preserve NetCDF and checksummed manifests as scientific artifacts. Keep indexed query data in PostGIS. Use the same scene revision, grid and mask for compatible comparisons.
- Record version, source, transformations, attribution and redistribution terms for each input. Review actual packaged dependencies and data before publishing a release. See [licensing](LICENSING.md).

## 3. Scope and deployment

The current demo uses a NestJS subprocess executor and the existing viewer. The target replaces the viewer with React and moves solver execution into one separately deployed Python gRPC service. The browser calls NestJS REST. Scene, simulation and spatial analysis remain NestJS modules. PostGIS owns the durable queue and GIS data. The target architecture supersedes the baseline single deployment constraint once migration acceptance passes.

Include run creation and recovery, 3D scene, slices, profiles, region and transect analysis, run comparison, road corridor statistics and exports. English is the default UI language with Vietnamese selectable. Switching language preserves map, run and analysis state. Full momentum CFD, health predictions, and unsupported LoD2 roof geometry are outside scope.

## 4. Business rules

| ID | Target requirement |
| --- | --- |
| BR-67 | NestJS creates a durable run and returns its ID. A repeated request with the same ID and parameters returns the same run. A conflicting payload is rejected. |
| BR-68 | Reserve capacity and claim jobs in one short PostGIS transaction. Use one active solver child by default. Allow a limit of two only after measuring memory, CPU and interactive query latency. |
| BR-69 | The worker uses separate artifact directories per attempt and persists receipts. Short gRPC calls have deadlines independent of solver runtime. Reconcile ambiguous acceptance using the same attempt identity. |
| BR-70 | Import and publish results atomically after manifest validation. Guard updates by attempt and owner. Keep capacity reserved until the old child is confirmed stopped. |
| BR-71 | Analyze selected roads with disjoint, clipped distance bands. Compute weights from exact XY overlap and vertical interval overlap. Report valid air coverage, volume-weighted mean and volume strictly above the threshold. |
| BR-72 | Localize user-facing text and numbers in English and Vietnamese. Preserve stable machine-readable keys and units. |
| BR-73 | Keep source data and library notices with the artifacts they cover. Review combined derivative datasets and archive/image contents before external distribution. |

## 5. Edge cases

| Case | Expected outcome |
| --- | --- |
| Duplicate dispatch or lost acknowledgement | Recover the existing attempt and preserve the concurrency limit. |
| Solver hangs, worker dies or DB disconnects | Preserve run state and reconcile. Terminate and reap the child before freeing its slot. Retry only recoverable failures within a durable budget. |
| Late result, failed verification or corrupt artifact | Reject publication and retain diagnostics. |
| Overlapping road buffers, boundary contact or a partial-height cell | Count each positive-volume intersection once. Use a defined boundary convention. |
| Missing, zero, solid or threshold-equal cell | Exclude missing and solid values from valid weights, include zero and use a strict greater-than test. |
| Different scene revision or unsupported geometry | Return a clear validation error. Preserve compatible historical results. |

## 6. Acceptance criteria

- **AC-54**. The Compose target deploys API, solver and PostGIS. Worker fault tests cover duplicate dispatch, ambiguous replies, worker crash, timeout and late completion at both supported limits.
- **AC-55**. Baseline and gRPC execution agree on masks, units and numerical outputs within documented tolerances. Run IDs, artifact checksums and provenance are traceable.
- **AC-56**. An independent hand-calculated fixture verifies corridor buffers, overlap volumes and statistics. API and CSV agree. The same production SQL is benchmarked with `EXPLAIN (ANALYZE, BUFFERS)` for selective and broad requests.
- **AC-57**. Both locales pass browser acceptance for simulation, error recovery, analysis and exports. Locale switching retains the selected run and layer.
- **AC-58**. The assessed revision includes verified source and dependency notices, a clean deployment record, and consistent evidence across report, slides and demo.

See [architecture](ARCHITECTURE.md), [implementation order](UPGRADE_PLAN.md) and [roadmap](ROADMAP.md).
