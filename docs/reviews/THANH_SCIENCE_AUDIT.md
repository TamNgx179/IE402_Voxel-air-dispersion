# Packaged science audit and urban resolution sensitivity

## Provenance and existing benchmarks

- The demo ZIP, both NetCDF members and the linked scene-manifest digest
  matched [the package manifest](../../deploy/demo-inputs/manifest.json).
  All five scene CSVs matched [the scene manifest](../../db/seeds/scene/scene_manifest.json):
  62 buildings, 67 roads, 1 water feature, 17 green features, and 10,000 columns.
  The manifest records OSM footprints and other features, and Google Open
  Buildings 2.5D Temporal heights (62/62). The exact upstream raster year per
  feature is unavailable in the frozen scene. The maximum recorded height is
  91 m. This is a flat-terrain LoD1 scene.
- Scene CSV ranges, the packaged NetCDF mask and rerasterized footprints and
  heights agree on all 500,000 voxel classifications (41,084 solid). Both
  bundled NetCDFs share the same unrounded coordinates. Relative to the scene
  manifest, their centre coordinates differ by 0.282 mm in x, 0.260 mm in y and
  zero in z; the study uses the scene-manifest grid and aligned cell indices.
  Separately, exact polygon union and height slabs give 58,235.14 m² of plan
  area and 2,094,057.83 m³ of solid for the supplied LoD1 geometry. These are
  geometry references calculated from the same footprints and heights.
- The packaged PM2.5 source is EDGAR v8.1 2022 road transport (TRO), allocated
  by a road proxy. The local raw ZIP member matched its extracted NetCDF.
  The projected domain corners all fall within the same EDGAR cell
  (centre 106.75° E, 10.75° N). Its flux of 1.2293387662e-11 kg m⁻² s⁻¹
  times 250,000 m² gives 3.0733469155e-6 kg s⁻¹; directly integrating the
  packaged tensor gives 3.0733469136e-6 kg s⁻¹ over 1,341 cells, all at
  the 1 m centre of the lowest layer. The difference is about 6.2e-10
  relative. The audit checks the local upstream copy; it does not authenticate
  the upstream server or independently recreate the road allocation. The
  demo ZIP contains neither the raw meteorology nor an observational
  validation dataset. Source notices and unresolved redistribution decisions
  are listed in [LICENSING.md](../LICENSING.md).
- The old technical bundle was read in place: all 203 indexed hashes/sizes,
  12 passing FV manifests and their declared artifacts, and both Gaussian
  field hashes matched. Saved evidence includes four corridor cases per
  season and the analytical grid/time suite. Existing references include
  [region overlap and comparison](B8_1_REGION_COMPARISON.md) (independent
  polygon/vertical overlap and prior NetCDF/API comparisons),
  [transect sampling](B9_4_TRANSECT_HEIGHT.md) (chainage, half-open voxels,
  and prior NetCDF checks), and [road corridors](../TECHNICAL_HANDOFF.md)
  (projected, clipped Shapely bands and NetCDF volume integration against
  PostGIS/API). The [Gaussian puff suite](B8_B9_GRID_STUDY.md) has an analytical
  cell-average reference for the obstacle-free case. The saved production
  Gaussian road plume is a separate model comparison. The historical API
  comparisons and analytical sweep were inspected, not rerun for this audit.

## Urban experiment

Same Nguyen Hue 500 × 500 × 100 m domain, EPSG:32648; horizontal spacings
5, 10 and 20 m with dz = 2 m. The same LoD1 footprints and heights were
rasterized onto each grid by cell centre. Runs start at zero concentration
and use the dry-season wind (1.62 m/s from 112° at the reference height),
the same mass-consistent wind method, diffusivities (horizontal 2 and
vertical 1 m²/s), and the same sparse FV transport and boundary rules:
blocked building and ground flux; clean inflow, advective outflow, and
zero exterior diffusive flux at sides/top. End time is 300 s. The
wind is projected separately on each grid.

To hold the forcing fixed, remove original 5 m source pixels that are
solid at any resolution (46 of 1,341; 3.13% of mass), then normalize the
retained support once to the packaged total. Treat the result as piecewise
constant over each 5 × 5 × 2 m source voxel and integrate it conservatively
into the coarser ground layers. No run injects into solids. Each coarse
grid is also run with the same time step as the 5 m case to check whether
the native CFL step explains the differences.

Fields were compared as piecewise constant over their voxels, on air common
to all grids (22,416,350 m³ overall; 354,100 m³ in the lowest 2 m).
The table uses the matched time step of 0.124062 s (2,419 steps per run
including the final partial step). MAE and relative L2 are volume weighted
against 5 m on this common support.

| XY spacing | Grid (x × y × z) | Voxel solid volume (m³) | Mean at 0–2 m (µg/m³) | MAE at 0–2 m (µg/m³) | Domain relative L2 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 5 m | 100 × 100 × 50 | 2,054,200 | 0.194993 | reference | reference |
| 10 m | 50 × 50 × 50 | 2,063,400 | 0.196293 | 0.020937 | 10.37% |
| 20 m | 25 × 25 × 50 | 2,190,400 | 0.198394 | 0.040762 | 22.77% |

All five solver runs (model label `0.1.0+6b27847-dirty`) passed CFL, positivity, wall flux, divergence, wind
projection and mass balance checks. Maximum relative mass imbalance was
1.19e-14; each emitted 9.22004074e-4 kg. The native CFL time steps at 10
and 20 m were 0.210355 and 0.360670 s. Changing only the time step on
these grids changed domain MAE by 2.68e-6 and 7.18e-6 µg/m³ between each
pair of fields; the domain MAE against 5 m at matched dt was 0.001614
and 0.003862 µg/m³. Native-step solver times in this run were 106.2,
10.8, and 3.7 s respectively, including setup and export.

The spatial differences are much larger than the time step effect in
this experiment. The lowest-layer mean is relatively insensitive, while
local differences and occupancy change substantially at 20 m. The sweep
combines voxelized geometry, projected wind, source averaging and
transport discretization. The 5 m run is a numerical reference only.
No urban convergence rate, steady state, wet-season result or observational
accuracy follows from this experiment.

New run snapshots, manifests, fields, logs and local scripts are in ignored
artifacts/thanh-science-20261115 (sweep-summary.json, input-audit.json,
bundle-audit.json, local-edgar-audit.json). The original evidence was
preserved. Existing Python code was reused without production changes.

To reproduce from this checkout without altering the original evidence, copy
run.py, analyze.py and audit_edgar.py from that artifact directory into a new
ignored artifact directory. Run the copies from the repository root with
PYTHONPATH=. and OPENBLAS_NUM_THREADS=1, using the project's Python environment.
Run run.py before analyze.py. The raw EDGAR check requires the local
data/raw/edgar archive and extracted file.

Verification: the full Python suite returned 330 passed, 9 skipped and
14 warnings (NumPy/netCDF4 runtime and deprecation warnings). The sweep
also checked equal integrated source, no emissions in solids, identical end
time and matching artifact hashes. Live API, PostGIS and Compose were
outside this rerun.
