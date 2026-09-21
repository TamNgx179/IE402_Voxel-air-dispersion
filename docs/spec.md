# Urban air-pollution dispersion on a 3D GIS voxel grid — specification

> **Where this file lives, and why not `.harness/tasks/`.** The harness spec workflow writes a
> feature spec to `.harness/tasks/<task-id>/spec.md`. This is a **project-level** spec for the
> whole capstone, not a checkpointed feature, and everything under `.harness/` is harness-owned
> and never committed in this repository. It therefore sits in `docs/` beside `RESEARCH.md`,
> `DECISION.md`, `ROADMAP.md` and `SEMINAR.md`, which is the dominant local pattern.
>
> **On the section shape.** This project had no prior spec to match, so the skeleton is the
> harness house shape. One section is adapted: the house form has *Portal observation notes*
> for a reference product seen hands-on. There is no reference product here, so it is
> **Observation notes** — what was observed in the code and the data, against what is a project
> decision. The adaptation is named rather than silently made.

## Definition

A **voxel** is a cell of a regular three-dimensional lattice that carries a value at every
position in the volume. It is not a 2.5D raster (one `z` per `(x,y)`), not a boundary
representation (surfaces only, interior implied), and not a point cloud (irregular samples, no
space-filling occupancy). The distinction is load-bearing for this project: a pollutant
concentration is a **volumetric scalar field**, and only the voxel model stores a value at every
point in the air — including above roofs and inside street canyons.

## Objective

Produce, for one city block in Vietnam, a **three-dimensional field of PM2.5 concentration on a
voxel grid** that responds to building geometry and to wind direction, together with the spatial
analyses that field makes possible (horizontal slices at several heights, vertical sections
through a canyon, vertical profiles, threshold isosurfaces, exceedance volume, façade exposure)
and a **web viewer** in which a reader can move a height slider and watch the concentration
change. The intended demonstration is that a 2D pollution map is insufficient, and the intended
honesty is that the model's known omissions are stated rather than hidden.

## Source basis

| Source id | Kind | Supports |
| --- | --- | --- |
| `ASSIGN-1` | assignment | the seminar report must cover *bối cảnh ứng dụng thực tế, mô hình/dữ liệu GIS 3D sử dụng, quy trình xây dựng, kết quả minh hoạ (hình ảnh/demo) và đánh giá ưu-nhược điểm* |
| `ASSIGN-2` | assignment | the named technique is *Mô hình 3D Array/voxel, phân tích không gian* — a 3D array is the required data model, not one option among several |
| `ASSIGN-3` | assignment | presentation is 10–12 minutes plus 3 minutes of questions, at most 2 students per group |
| `EXT-1` | external | three documented deficiencies of 2D air-quality visualisation: no vertical information, no precise 3D location of the pollutant, poor representation of spatial wind patterns — Ridzuan et al. 2020, ISPRS Archives XLIV-4/W3-2020, 355–363 |
| `EXT-2` | external | grid-resolution sensitivity: NMSE 0.10 at 5 m, 0.25 at 10 m, **1.35 at 20 m** against wind-tunnel data — CAIRDIO v1.0, GMD 14, 1469 (2021) |
| `EXT-3` | external | Briggs **urban** dispersion coefficients and urban power-law wind exponents — EPA ISC3 User's Guide Vol. II, Tables 1-3, 1-4 and the urban `p` column |
| `EXT-4` | external | the variational mass-consistency formulation and the SOR update with **ω = 1.78** — QES-Winds documentation; URock 2023a, GMD 16, 5703 |
| `EXT-5` | external | diagnostic wind models are *"two to three orders of magnitude faster"* than LES/DNS — Front. Earth Sci. 2023, DOI 10.3389/feart.2023.1251056 |
| `EXT-6` | external | a Lagrangian solver on such a wind field reaches FAC2 = 0.59 against a cubical-array wind tunnel, and 5.91 % maximum relative error against the analytic case — QES-Plume v1.0, GMD 16, 5729 (2023) |
| `EXT-7` | external | motorcycle emission factors measured in Hanoi: PM **0.053 g/km**, CO 4.8, NOₓ 0.13, SO₂ 0.006 — Tran et al. 2024, IOP Conf. Ser. EES 1391 012007, open access |
| `EXT-8` | external | building-height product covering Vietnam, effective resolution 4 m, MAE 1.5 m **with the accuracy assessed only in North America, Europe and Japan** — Google Open Buildings 2.5D Temporal |
| `EXT-9` | external | national limit values, PM2.5 24-hour 50 µg/m³ and annual 25 µg/m³ — QCVN 05:2023/BTNMT |
| `EXT-10` | external | WHO 2021 guideline levels, PM2.5 24-hour 15 µg/m³ and annual 5 µg/m³ |
| `OBS-1` | observed | the grid contract is fixed in `config/project.yaml`: 500 × 500 m horizontal, 0–100 m vertical, `dx_m: 5.0`, `dy_m: 5.0`, `dz_m: 2.0` |
| `OBS-2` | observed | all 3D arrays are `[z, y, x]` and 2D arrays `[y, x]` — `src/voxel/models.py:25-32` |
| `OBS-3` | observed | Tier 0 writes a netCDF carrying `H` as `(y, x)` and `B` as `(z, y, x)` — `src/voxel/output.py:180-196` |
| `OBS-4` | observed | the Gaussian baseline writes `C_gaussian_ug_m3` as `(z, y, x)`, float32 — `src/gaussian.py:201-211` |
| `OBS-5` | observed | Briggs **urban** σ are implemented, including the `+0.5` exponent on σ_z for classes A–B — `src/dispersion/gaussian_model.py:21-89` |
| `OBS-6` | observed | urban power-law exponents 0.15 / 0.20 / 0.25 / 0.30 — `src/dispersion/gaussian_model.py:94-110` |
| `OBS-7` | observed | missing building height is a **hard error** by default, not a silent default — `config/project.yaml`, `voxelization.height.fallback.mode: "error"` |
| `OBS-8` | observed | `sor_poisson` in `src/02_wind.py:17` raises `NotImplementedError`; the wind field does not exist yet |
| `OBS-9` | observed | the transport solver conserves mass to 0.00e+00 % relative error on a closed domain and passes 12 verification tests — `tests/test_transport_verification.py` |
| `OBS-10` | observed | there is no `.env.example`, no CI configuration and no deployment in the repository |
| `DEC-1` | MVP decision | the empirical 7-zone Röckle parameterisation is **out of scope**; only the mass-consistency half is implemented |
| `DEC-2` | MVP decision | validation against wind-tunnel or field data is **out of scope**; the project delivers Tier-1 verification only |
| `DEC-3` | MVP decision | PM2.5 is the modelled species, treated as passive and non-reacting |
| `DEC-4` | MVP decision | traffic volume is allocated by OSM road class and normalised to a gridded inventory total, because no open traffic count exists for the study cities |
| `DEC-5` | MVP decision | the web viewer serves **downsampled, per-level** data, not all 500 000 voxels |

### Honesty callouts

Three of these need qualifying, and the qualification is part of the record.

- **`EXT-6` is cited for a benchmark, not for this model's accuracy.** QES-Plume is a Lagrangian
  solver on a *Röckle* wind field. This project has neither. The FAC2 = 0.59 figure is quoted as
  the standard this class of model reaches, and the 5.91 % figure as a target for Tier-1
  verification — never as a result this project has achieved.
- **`EXT-8` carries its own disclaimer and it is not a small one.** Google state the 1.5 m mean
  absolute error was assessed in North America, Europe and Japan, *not* in the Global South.
  Vietnamese tube houses — narrow, tall, densely packed — are a hard case for a 4 m product
  derived from Sentinel-2. The figure is reported with that sentence attached, every time.
- **`EXT-2` is cited for the resolution decision only.** CAIRDIO is a different model with a
  different building representation (volume-fraction rather than a hard mask). Its NMSE numbers
  bound where *a* voxel model stops losing skill quickly; they are not a prediction of this
  model's NMSE, and no NMSE is claimed for this model at all.

## Scope

### In scope

- A voxel occupancy mask and height field for one study block, extruded LoD1 from building
  footprints with resolved heights.
- A traffic emission field rasterised into the voxel layer nearest ground level.
- A **mass-consistent diagnostic wind field**: a power-law inflow profile, zero velocity inside
  buildings, then a Poisson solve for the Lagrange multiplier by SOR until the field is
  divergence-free.
- A **finite-volume advection–diffusion transport solver** on the same grid: first-order upwind
  advection, central diffusion, explicit time stepping to a steady state.
- An **analytic Gaussian plume baseline** with Briggs urban coefficients, serving both as a
  comparison model and as the Tier-1 verification target.
- **Tier-1 verification**: agreement with analytic answers, mass conservation, boundedness, wall
  impermeability.
- At least five **3D spatial analyses** over the resulting field.
- A **3D web viewer** with a height slider, scenario switch and threshold overlay.
- A written record of what the model omits and in which direction each omission biases the
  result.

### Out of scope

- The 7 empirical Röckle zones — cavity, wake, rooftop and street-canyon recirculation (`DEC-1`).
- Validation against wind-tunnel or field measurements (`DEC-2`).
- Atmospheric chemistry of any kind; reactive species such as NO₂ (`DEC-3`).
- Traffic-produced turbulence, which is the dominant dispersion mechanism in calm conditions.
- Thermal effects, buoyancy, stability evolution over a diurnal cycle.
- Deposition, washout and resuspension.
- Time-varying meteorology; each run uses one steady wind condition.
- Any deployment, authentication or multi-user capability.

## Constraints

- **The grid contract is fixed by `config/project.yaml` and may not be hard-coded elsewhere**
  (`OBS-1`). Domain 500 × 500 × 100 m, Δx = Δy = 5 m, Δz = 2 m, therefore 100 × 100 × 50 =
  500 000 voxels.
- **All 3D arrays are `[z, y, x]`; all 2D arrays are `[y, x]`** (`OBS-2`). A function that takes
  or returns an array in another order is a defect regardless of whether its own tests pass.
- Interchange between stages is **CF-conventions netCDF-4**, never an in-memory handoff, so each
  stage can be re-run alone.
- Concentrations are stored `float32`; the building mask is `uint8`.
- Every input dataset must be free, publicly reachable and usable without credentials. The
  repository holds no secret and needs none (`OBS-10`).
- Two people, eight calendar weeks, part-time — roughly 32 person-days for everything including
  the report.
- Modules named `NN_name.py` cannot be imported with an `import` statement; they are loaded by
  path.

## Business rules

### 5.1 What the model is, and what it is called

| | Rule | Source |
|---|---|---|
| **BR-1** | The wind model is **mass-consistent only** and is **never called a Röckle model**. Röckle is the empirical zone parameterisation *plus* mass conservation; this project implements the second half. The correct name is *mass-consistent diagnostic wind model*, of the CALMET / MATHEW family. Getting this wrong in a report is a factual error, not a wording preference | `DEC-1`; `EXT-4` |
| **BR-2** | **No momentum equation is solved.** Buildings enter the wind problem **only** through the six face coefficients, set to zero on any voxel face that is a wall. There is no body-fitted mesh and no turbulence closure. This is what buys the two-to-three order of magnitude saving over LES, and equally what removes cavity recirculation | `EXT-4`, `EXT-5`; `DEC-1` |
| **BR-3** | The modelled species is **PM2.5, treated as passive and non-reacting**. Nothing in the model is chemistry-aware, so a reactive species such as NO₂ would be wrong rather than merely approximate | `DEC-3` |

### 5.2 The transport scheme

| | Rule | Source |
|---|---|---|
| **BR-4** | **Advection uses first-order upwind. Central differencing is prohibited** for the advective term. Central is unbounded: at a sharp front it produces 2Δx oscillations and negative concentrations, which are not physical for a pollutant. This is not a preference — it was an actual defect in the first implementation | `DEC-1`; observed in the repository's own history |
| **BR-5** | Fluxes are taken **on cell faces and differenced**, so whatever leaves one cell enters its neighbour exactly. Mass is conserved to machine precision, and that is asserted rather than assumed: emitted mass equals mass still in the domain plus mass that has crossed a boundary | `OBS-9` |
| **BR-6** | The time step satisfies a **Courant number of 0.5 or less, computed from the actual velocity field** rather than passed in as a constant, and the diffusive von Neumann limit is checked alongside it. The realised Courant number is reported back so the margin is visible | `OBS-9` |
| **BR-7** | A run **terminates at a steady state, not at a wall-clock duration**. With a 500 m domain and a wind of a few m/s the crossing time is of order 100 s, so roughly 400–600 s of simulated time suffices. Running "one simulated hour" wastes nine tenths of the effort | `OBS-1` |
| **BR-8** | Face fluxes are **zero on building walls and at the ground**, and **open at the domain edge with clean inflow**. Ground is reflective, meaning no deposition is modelled | `DEC-1` |

### 5.3 Geometry, grid and data

| | Rule | Source |
|---|---|---|
| **BR-9** | The grid contract lives in the **project configuration file and nowhere else**: 500 × 500 × 100 m, Δx = Δy = 5 m, Δz = 2 m, therefore 100 × 100 × 50 = 500 000 voxels. A spacing literal anywhere in the code is a defect | `OBS-1`; `EXT-2` |
| **BR-10** | **All 3D arrays are `[z, y, x]` and all 2D arrays `[y, x]`.** A function that takes or returns an array in another order is a defect regardless of whether its own tests pass, because the error is invisible on a symmetric fixture | `OBS-2` |
| **BR-11** | **A missing building height is an error, never a default.** A building with neither a usable direct height nor a usable level count stops the run and names itself. A silently defaulted height produces plausible geometry that is wrong, which is worse than a crash | `OBS-7` |
| **BR-12** | Interchange between stages is **CF-conventions netCDF-4 on disk**, never an in-memory handoff, so every stage re-runs alone. Concentrations are stored `float32`; the building mask is `uint8` | `OBS-3`, `OBS-4` |
| **BR-13** | Every input dataset is **free, publicly reachable and usable without credentials**. The repository holds no secret and needs none | `OBS-10` |

### 5.4 Honesty about what the model does not do

| | Rule | Source |
|---|---|---|
| **BR-14** | **Numerical diffusion is measured and reported, not absorbed.** `K_num ≈ ½·u·Δx·(1−Cr)` is 3.75 m²/s at u = 3 m/s and Δx = 5 m — the same order as the physical eddy diffusivity. It is a first-class limitation and belongs in the results, not only in a footnote | `OBS-9` |
| **BR-15** | **Verification is never described as validation.** The project checks the code against analytic answers and conservation laws; it does not check the model against measurements. A passing test suite is not evidence about reality | `DEC-2` |
| **BR-16** | Results are reported against **both QCVN 05:2023 and the WHO 2021 guideline**, because the national PM2.5 limit is five times the WHO level and a single threshold hides that | `EXT-9`, `EXT-10` |
| **BR-17** | **Every quoted external figure carries its own caveat where it has one.** In particular, the building-height accuracy is never quoted without the sentence that the assessment excluded the Global South | `EXT-8` |
| **BR-18** | The model's known omissions — no cavity recirculation, no street-canyon vortex, no traffic-produced turbulence — are stated **with the direction of the resulting bias**, which is that canyon concentrations are under-estimated | `DEC-1` |

### 5.5 Repository discipline

| | Rule | Source |
|---|---|---|
| **BR-19** | **Harness-owned files are never committed and never added to `.gitignore`.** They stay untracked and visible; the protection is that every commit stages explicit paths. `git add -A`, `git add .` and `git commit -a` are prohibited in this repository | project `CLAUDE.md` |

## Edge cases

| Situation | Expected | Source |
|---|---|---|
| A building polygon has neither a direct height nor a level count | the run stops and names the building. No default height is substituted | BR-11 |
| Two building polygons overlap in one raster cell | the larger height wins, per the configured `maximum_height` overlap rule | BR-9, BR-11 |
| A building is taller than the 100 m domain | it is clipped at the domain top **and the clipping is reported** — a silently truncated building changes the flow | BR-9 |
| The seed wind field has non-zero divergence before correction | expected, and is the whole reason the Poisson solve exists. A residual **after** the solve above tolerance is a failure, not a warning | BR-2 |
| The SOR iteration hits its cap without converging | the run stops and reports the residual. It never returns a field that is not divergence-free | BR-2 |
| Wind speed is zero everywhere | advection vanishes and the result is pure diffusion. The solver stays stable and the time-step chooser does not divide by zero | BR-6 |
| An axis of the grid is one cell thick | legitimate — it is how a 2D x–z slice is run — and that axis contributes no transport. The solver must not refuse it | BR-10 |
| An emission source falls inside a building voxel | the source is rejected. Mass emitted into a solid cell can never leave it | BR-8 |
| A concentration goes negative at any step | the run fails loudly. This is the signature of the prohibited central-difference scheme | BR-4 |
| The exported web dataset exceeds the size budget | the exporter downsamples further **and records the factor**, rather than shipping a viewer that will not load | BR-12 |
| The chosen study area has very sparse OSM height tagging | the run may proceed on a raster height product, but the report states the proportion of buildings whose height was inferred | BR-11, BR-17 |
| A harness-owned file appears in `git status` | correct and expected. It stays untracked; it is never gitignored and never staged | BR-19 |

## Acceptance criteria

Each line is checkable by running something. The **Traces to** column names the rule it comes
from.

> The harness house style writes acceptance criteria as *When … then …* on one physical line,
> because `checkpoint.sh` parses them that way. This spec follows the `x-app-spec` table shape
> instead: it is a project-level document in `docs/`, not a checkpointed task artefact, so no
> parser reads it.

### 7.1 Geometry

| ID | Criterion | Traces to |
|---|---|---|
| AC-1 | The voxeliser writes a CF-conventions netCDF holding `H` with dimensions `(y, x)` and `B` with dimensions `(z, y, x)` on a 100 × 100 × 50 grid | BR-9, BR-12 |
| AC-2 | A building with no height and no level count stops the run with an error naming that building, and no output file is written | BR-11 |
| AC-3 | Opening the output in QGIS or Panoply shows the field correctly oriented, with `z` increasing upward — without running any of this project's code | BR-12 |

### 7.2 Wind field

| ID | Criterion | Traces to |
|---|---|---|
| AC-4 | After the Poisson solve, the divergence of the velocity field is below tolerance in **every air voxel** | BR-2 |
| AC-5 | Velocity is exactly zero in every solid voxel | BR-2, BR-8 |
| AC-6 | A vector plot on a horizontal slice above ground shows flow **deflected around** buildings, not passing through them | BR-2 |
| AC-7 | An unconverged solve raises rather than returning, and the message carries the residual | BR-2 |
| AC-8 | The same solver runs on a one-cell-thick `y` axis, producing the 2D x–z slice the debug notebooks use | BR-10 |

### 7.3 Transport

| ID | Criterion | Traces to |
|---|---|---|
| AC-9 | On a closed domain with no source, total mass is unchanged to within floating-point error | BR-5 |
| AC-10 | With a source and open boundaries, emitted mass equals mass remaining plus mass that has left | BR-5 |
| AC-11 | No voxel holds a negative concentration at any step, including across a step profile where central differencing would oscillate | BR-4 |
| AC-12 | A wall spanning the domain lets **no mass whatsoever** reach its downwind side | BR-8 |
| AC-13 | A blob in uniform wind travels u·t, to within one cell | BR-4 |
| AC-14 | Pure diffusion from a point release, with zero wind, matches σ² = 2Kt to better than 6 % | BR-5 |
| AC-15 | The chosen time step yields a realised Courant number of 0.5 or less, reported by the code rather than assumed | BR-6 |
| AC-16 | A run reaches steady state in roughly 400–600 s of simulated time and completes in under a minute of wall-clock | BR-7 |

### 7.4 Results and delivery

| ID | Criterion | Traces to |
|---|---|---|
| AC-17 | Running the pipeline for two wind directions produces two fields that differ in the direction the plume travels | BR-9 |
| AC-18 | Horizontal slices at 1.5 m and 15 m differ materially, demonstrating the vertical structure a 2D map cannot show | BR-10 |
| AC-19 | Exceedance volume is reported in m³ against **both** the QCVN and the WHO threshold, each naming its threshold | BR-16 |
| AC-20 | Opening the web viewer and moving the height slider changes the displayed layer without reloading the page | BR-12 |
| AC-21 | The web payload loads within the size budget, and if it was downsampled the factor is stated on the page | BR-12 |

### 7.5 Honesty

| ID | Criterion | Traces to |
|---|---|---|
| AC-22 | The report states that Tier-1 verification was performed and that validation against measurements was **not**, with the reason | BR-15 |
| AC-23 | The report quotes the measured `K_num` next to the physical K, and says what that means for plume width | BR-14 |
| AC-24 | Wherever the building-height accuracy is quoted, the Global South exclusion is quoted with it | BR-17 |
| AC-25 | The limitations section names the missing cavity and canyon physics **and the direction of the bias** | BR-18 |

### 7.6 Rules with no criterion

Two rules cannot be demonstrated by running the deployed artefact, and are declared here
rather than left looking like an oversight.

- **BR-1** — that the model is named correctly. This is a property of the prose, checked by
  reading the report and the code comments, not by executing anything.
- **BR-19** — that harness files are never committed. Checked by inspecting `git status` and the
  commit contents, which is a repository property rather than a program behaviour.

## Observation notes

*Adapted section — see the banner. The house form compares a reference product against MVP
decisions; here the left column is what the repository and the data actually show.*

| Observed in code or data | Not observed — project decision |
| --- | --- |
| Briggs **urban** σ implemented correctly, including the easily-mistaken `+0.5` exponent for classes A–B (`OBS-5`) | Whether urban σ are appropriate at 5 m resolution at all; they are a bulk area-averaged parameterisation and are used because the baseline needs *some* defensible closure (`DEC-3`) |
| Grid, domain and dtype are configuration, not constants in code (`OBS-1`) | The specific study block, which is not yet chosen and depends on OSM height coverage |
| Height resolution fails closed on missing data (`OBS-7`) | What proportion of buildings will actually carry a height in the chosen block — unmeasured until the block is picked |
| The transport solver conserves mass exactly and passes 12 tests (`OBS-9`) | Whether the resulting concentrations resemble reality; nothing in the project tests that (`DEC-2`) |
| `sor_poisson` is an unimplemented stub (`OBS-8`) | The convergence behaviour of the Poisson solve on a real building mask, which is the largest remaining technical unknown |
| No CI, no deployment, no secrets (`OBS-10`) | Whether the web viewer will be hosted anywhere, or demonstrated from a local file |

## Sources

### Existing specs and docs referenced

This project had **no prior specification**; the skeleton is the harness house shape, with the
one adaptation named in the banner. The four documents that this spec derives its content from:

- `docs/RESEARCH.md` — the sourced survey, 339 links, and the origin of every `EXT-n` above.
- `docs/DECISION.md` — the model choice, the cut scope and the trade-off analysis; `DEC-1` to
  `DEC-5` are recorded there first.
- `docs/ROADMAP.md` — the eight-week plan, the person split and the web deliverable.
- `docs/SEMINAR.md` — the presentation obligations behind `ASSIGN-1` to `ASSIGN-3`.
- `CLAUDE.md` — the project's own working rules, which outrank this spec on any conflict.

### User-provided documents

The course's seminar requirements were provided by the user as plain text and are the basis of
`ASSIGN-1` to `ASSIGN-3`. No other document, screenshot or upload was supplied.

### External links

Every `EXT-n` resolves to a link recorded in `docs/RESEARCH.md` §19, where each carries a
confidence marker. **The markers matter and are not decoration**: several central references were
reachable only as abstracts or search snippets, and `docs/RESEARCH.md` §18 lists 37 items that
could not be verified. Two bear directly on this spec:

- The Chang & Hanna acceptance thresholds circulate with **three different NMSE values** (1.5, 3
  and 4) attributed to the same paper. This spec therefore states no NMSE acceptance threshold.
- The QCVN 05:2023 table could not be extracted consistently; only the PM2.5 rows (50 / 25 µg/m³)
  were corroborated twice, and only those are used here.
