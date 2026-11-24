# Scientific verification follow-up, 24 November 2026

## AIJ Case H protocol correction

The benchmark computes diagnostic wind from the measured approach profile. It
does not prescribe a measured three-dimensional wind field around the obstacle.
Concentration errors therefore include wind, mixing and transport error. Case A
remains the separate velocity comparison. The production wind model and mixing
parameters have not been calibrated to these concentration observations.

`--compare-mixing` now selects the strictest CFL limit across the three vertical
mixing factors and applies that single target step to all variants. The rerun
used 7,176 steps over 3 s, with an actual step of 0.0004180602006688963 s. The
published CSV MD5 checks still run before computation.

The concentration normalization is `Cstar = C_ppm / C0_ppm`, where
`C0_ppm = 1e6 * Q / (U_H * H^2)`, `Q = 350e-6 / 60 m³/s`, `U_H = 3.226 m/s`
and `H = 0.20 m`. This gives `C0_ppm = 45.20562099607356`. The same normalization
is used for observations and predictions.

| Vertical factor | Development wake RMSE | Held-out wake RMSE | Held-out outside-wake RMSE |
| --- | ---: | ---: | ---: |
| 0.5 | 12.769 | 18.503 | 2.756 |
| 1.0 | 10.955 | 16.290 | 2.818 |
| 2.0 | 10.248 | 14.723 | 2.957 |

All errors are on dimensionless concentration. Complete streamwise stations
are held out. Both sets are from one experiment and may remain correlated.
Improvement in the wake comes with worse outside-wake error.

Source: [AIJ Case H, Zenodo](https://zenodo.org/records/15429872), CC BY 4.0.

## Controlled building-height alternative

The three alternative heights come from the OSM records documented in
[the 19 November height review](B9_4_TRANSECT_HEIGHT.md#xác-minh-lại-tag-osm-ngày-19112026).
They are alternative input assumptions, not surveyed ground truth. The small
JSON mapping is attributed to OpenStreetMap contributors under ODbL. No claim
is made that these three tags resolve all scene-height uncertainty.

Both calculations used revision `04a7c10`, a 500 × 500 × 250 m domain and
5 × 5 × 2 m voxels. Both scenes were rerasterized by the same cell-centre rule.
The source tensor and footprints were held fixed. The alternative adds 11,646
solid voxels and removes none. Statistics use the intersection of valid air
voxels, including valid zeros.

| Height range | Shared air voxels | Baseline mean, µg/m³ | Alternative mean, µg/m³ | Mean change | Relative field L1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0–2 m | 7,683 | 0.2006306501 | 0.2006059450 | −0.0123% | 3.3717% |
| 0–100 m | 455,714 | 0.0225454046 | 0.0230545924 | +2.2585% | 6.1496% |
| 100–200 m | 491,556 | 4.834151e-8 | 7.235222e-8 | +49.6689% | 57.0141% |

The upper range has extremely small absolute concentrations. Its relative
change must not be presented as a material environmental increase. A nearly
unchanged ground-layer mean also does not establish unchanged local values.

Both runs passed all seven numerical gates. Baseline UUID:
`f074c1ef-e9b7-4f93-be57-0f3b5ca91c30`, input hash
`sha256:42b7c7d7d5804cc4a957fb019d10fbc8d190d3d86e823a267dbbbe895397283c`.
Alternative UUID: `f2787f86-53c0-4df4-b4d2-0979974d92d0`, input hash
`sha256:774160770ef2b5c90a095cf5b65476fcbb3e053ec5e15e0cf066a3cfc79ea2d6`.
The machine-readable evidence next to this review is authoritative for hashes.

## Reproduction

Start from a checkout with the Python requirements installed. Install the
packaged source and voxel inputs before the building study:

```powershell
python -m src.demo_bundle install --bundle deploy/demo-inputs
python -m scripts.benchmark_building_heights --heights docs/reviews/height-alternatives-20261119.json --top-m 250 --out artifacts/building-height-study
$env:PYTHONPATH = '.'
python scripts/benchmark-aij-case-h.py artifacts/aij-input artifacts/aij-case-h-common-step --compare-mixing
```

AIJ input requires the original `AF_caseH.csv` and `RS_caseH.csv`. Output
directories must be new. A new revision or file path can change an input hash
and numerical results should be compared with the recorded configuration.
The height study rejects unknown feature IDs, nonfinite or nonpositive roofs,
roofs reaching the top, and tops not aligned to whole additional layers.

The reusable preparation was checked against the executed study: baseline and
alternative occupancy masks and source coordinates/values match exactly.
The shipped demo scene remains unchanged. These experiments support sensitivity
analysis and do not replace local measurements of PM2.5, winds or roof heights.
