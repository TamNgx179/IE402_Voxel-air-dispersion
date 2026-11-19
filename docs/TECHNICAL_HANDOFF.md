# Technical handoff

The submission runs React, NestJS with a supervised Python subprocess, and
PostgreSQL/PostGIS. The checked application baseline is merge revision
`62db6c7`. Local runs record their actual revision label, including a dirty
suffix when the follow-up changes are present.

## Spatial and scientific verification

- `python -m src.analysis.corridor_reference` builds projected bands from the
  scene WKT and integrates a checksummed NetCDF field independently of the SQL.
  The hand-calculated fixture covers overlapping roads, partial XY/z, solid,
  missing, zero and threshold equality. Production checks use three road IDs,
  the ranges 1–15 and 15–31 m, and distance endpoints 10/25/50 and 15/30/60 m.
  In the selected 1–15 m corridor, the innermost dry-season mean changed from
  0.22033 to 0.21609 µg/m³ when its outer edge moved from 10 to 15 m. The
  corresponding wet-season mean changed from 0.14377 to 0.14291 µg/m³.
  The domain, run, roads and threshold remain the same within each comparison.
- `python -m src.production_study --cases top_high --out artifacts/technical-close/upper`
  adds 25 air layers above the original 100 m domain. It preserves the original
  horizontal grid, voxel occupancy and emission tensor below 100 m. The
  dry-season mean at 1 m changed from 0.200461 to 0.200553 µg/m³ and the mean
  at 15 m from 0.062825 to 0.063140 µg/m³. These are changes of about 0.046%
  and 0.50% for this scenario. The test does not validate roof heights.
- The frozen scene has 62 GOB heights. Its tallest estimate is 91 m, leaving
  9 m to the original boundary. The earlier audit found three OSM tags of at
  least 100 m. On 19 November 2026 the current OSM versions were read again
  and still give 186, 154 and 164.9 m. Wikidata lists 40 floors for two of the
  towers. The towers are therefore likely taller than the 100 m domain, and GOB
  underestimates them. The scene keeps GOB under BR-61. The effect of the
  missing tower volume above about 60 m has not been simulated. See
  [the height review](reviews/B9_4_TRANSECT_HEIGHT.md#xác-minh-lại-tag-osm-ngày-19112026).
- For the dry run at 15 m, scaling roof heights to 80% and 120% changed the
  mean over shared air cells by −0.00317 and +0.00301 µg/m³, respectively.
  This separate experiment uses the original top boundary. Tall roofs can be
  clipped at 100 m in the 120% case, so the result combines height sensitivity
  with that geometric limitation.
- The full grid/time benchmark passed all ten verification cases. The analytical
  grid sequence reduced relative L2 error from 0.462663 to 0.305247 to 0.178177.
  The analytical case does not establish grid convergence for the urban scene.
- Gaussian uses the same road source and scenario winds with buildings masked
  after the plume calculation. At 1 m the dry-season mean was 0.21637 µg/m³
  versus 0.20046 for FV. At 15 m it was 0.05314 versus 0.06283. Use the common
  valid-air mask and per-layer MAE to distinguish pointwise differences from
  differences in domain means.

## Local artifacts and deployment

The candidate directory is `artifacts/technical-close`. It contains the
clean Docker checks, production plans, scientific fields, configuration
snapshots and manifests. Use `python -m src.analysis.technical_bundle --root artifacts/technical-close`
to verify the run manifests and generate a per-file SHA-256 index, a run
inventory and the comparison CSV/figure. The artifact directory is local.
The candidate contains six verified FV source-reduction runs, six verified FV
production/sensitivity runs, two Gaussian baselines and 350 paired height
comparisons. The SHA-256 index covers 203 files from these checks.

Compose checks PostgreSQL over TCP to avoid marking the socket-only server
healthy during first-time PostGIS initialization. The old database volumes
can be kept when starting a new revision with different seed inputs.

See [data rights and notices](LICENSING.md) for open redistribution decisions.

## Integrated verification on 15 November 2026

The clean reference is `6b27847`. The two real FV runs, query benchmark,
CSV and verified manifests are under
`artifacts/full-review/baseline-checkout/artifacts/baseline/`.
See the rehearsal JSON for the run IDs, input hashes, verification status
and layer statistics. Run IDs change on a fresh install.

The follow-up working tree passed a second isolated Compose rehearsal
at label `6b27847-dirty`. The report records eight orchestration checks
and thirteen browser checks. The rehearsal removed its own stack. Seed,
solver and import were exercised on fresh volumes and the application
re-read the results after restart. PostgreSQL E2E covered 126 cases
without skips. The report distinguishes this local candidate from the
clean reference and from the GitHub-hosted CI at the previous revision.

Use `scripts/verify-netcdf-api.py --base http://127.0.0.1:3115 --run <id>`
with a running reference stack and the project's locked Python environment.
The tool checks published float32 values at 1 and 15 m and selected complete
vertical profiles using the checksummed NetCDF. The audit and fixed-time
urban sensitivity are described in [the scientific review](reviews/THANH_SCIENCE_AUDIT.md).

The three tallest GOB estimates in the frozen scene are 91 m
(`way/402859385`), 88.5 m (`way/741084351`) and 81 m (`way/263502876`).
The OSM tags for these towers were reverified against the OSM API on
19 November 2026. They are community-edited values, not surveyed heights,
and are not used as ground truth.
