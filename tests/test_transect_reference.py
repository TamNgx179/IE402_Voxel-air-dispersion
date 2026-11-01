"""
B9.4 - independent reference for the vertical cross-section (A9.3).

The fixture mirrors the API e2e fixture (app/test/fixtures/scene + the
concentration rows in app/test/transect.e2e-spec.ts) so A's expected numbers
can be checked against an implementation written from the spec, not from A's
code. A second part ports A's TypeScript sampling loop line by line
(``_a_port``) and runs it differentially against the reference on random
routes over the production grid.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

pyproj = pytest.importorskip("pyproj")

from analysis.transect_reference import (  # noqa: E402
    MAX_SAMPLES,
    TransectConflict,
    TransectError,
    TransectGrid,
    cell_index,
    layer_index,
    sample_transect,
    select_layers,
    solid_from_ranges,
)

TO_WGS = pyproj.Transformer.from_crs("EPSG:32648", "EPSG:4326", always_xy=True)
FROM_WGS = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:32648", always_xy=True)


def wgs(points):
    """UTM 48N metres -> WGS84 lon/lat, the way the e2e test builds requests."""

    return [list(TO_WGS.transform(x, y)) for x, y in points]


# ---------------------------------------------------------------------------
# Fixture 2x2x4, identical to the A9.3 e2e fixture
# ---------------------------------------------------------------------------

FIX = TransectGrid(686000.0, 1191300.0, 5.0, 5.0, 2.0, 2, 2, 4)
N = float("nan")


def c_linear(z):
    return 2.0 + 3.0 * z


@pytest.fixture()
def fixture_fields():
    # e2e rows: (i, j) -> c_ug_m3[k=0..3]
    rows = {
        (0, 0): [N, N, N, 23],
        (1, 0): [5, 11, 0, 23],
        (0, 1): [0, N, 17, 23],
        (1, 1): [N, N, N, N],
    }
    conc = np.full((4, 2, 2), np.nan)
    for (i, j), col in rows.items():
        conc[:, j, i] = col
    solid = solid_from_ranges(FIX, {(0, 0): (0, 2), (1, 1): (0, 3)})
    return conc, solid


def run(points, conc, solid, z_min=0.0, z_max=3.0, step=None, grid=FIX):
    return sample_transect(
        wgs(points), grid, conc, solid, z_min_m=z_min, z_max_m=z_max, step_m=step
    )


def cells(sample):
    return [(c.k, c.status, c.concentration_ug_m3) for c in sample.cells]


# --- A's e2e expectations, recomputed independently -------------------------


def test_fixture_values_follow_c_equals_2_plus_3z_at_cell_centres(fixture_fields):
    conc, solid = fixture_fields
    # Every finite value except the two deliberate zeros equals 2+3*z_centre.
    for k in range(4):
        for j in range(2):
            for i in range(2):
                v = conc[k, j, i]
                if np.isfinite(v) and v != 0:
                    assert v == c_linear(FIX.z_center(k))


def test_e2e_case_1_layers_centres_overlap_and_values(fixture_fields):
    conc, solid = fixture_fields
    r = run([(686006, 1191302.5), (686009, 1191302.5)], conc, solid)
    assert r.layers == (0, 1)
    c0, c1 = r.samples[0].cells
    assert (c0.z_center_m, c0.overlap_min_m, c0.overlap_max_m) == (1.0, 0.0, 2.0)
    assert (c1.z_center_m, c1.overlap_min_m, c1.overlap_max_m) == (3.0, 2.0, 3.0)
    assert r.length_m == pytest.approx(3.0, abs=1e-6)
    assert len(r.samples) == 2  # ceil(3/5) = 1 interval, both endpoints
    for s in r.samples:
        assert (s.i, s.j) == (1, 0)
        assert cells(s) == [(0, "air", 5.0), (1, "air", 11.0)]
    # No interpolation: requested band top is 3 m but value is the centre value.
    assert r.samples[0].cells[1].concentration_ug_m3 != c_linear(2.5)
    assert r.actual_step_m <= r.requested_step_m


def test_e2e_case_2_zero_missing_and_solid_are_distinct(fixture_fields):
    conc, solid = fixture_fields
    r = run([(686000.5, 1191307.5), (686009.5, 1191307.5)], conc, solid)
    assert len(r.samples) == 3
    assert [(s.i, s.j) for s in r.samples] == [(0, 1), (1, 1), (1, 1)]
    assert cells(r.samples[0]) == [(0, "air", 0.0), (1, "no_data", None)]
    assert cells(r.samples[-1]) == [(0, "solid", None), (1, "solid", None)]


def test_e2e_case_3_internal_face_goes_to_upper_cell_outer_face_rejected(fixture_fields):
    conc, solid = fixture_fields
    r = run([(686005, 1191302), (686007, 1191302)], conc, solid)
    assert r.samples[0].i == 1
    with pytest.raises(TransectError):
        run([(686010, 1191302), (686009, 1191302)], conc, solid)


def test_e2e_case_4_bent_route_reversal(fixture_fields):
    conc, solid = fixture_fields
    pts = [(686001, 1191301), (686009, 1191301), (686009, 1191309)]
    a = run(pts, conc, solid)
    b = run(pts[::-1], conc, solid)
    assert a.length_m == pytest.approx(16.0, abs=1e-6)
    assert len(a.samples) == len(b.samples) == 5  # ceil(16/5)=4 intervals
    for x, y in zip(a.samples, reversed(b.samples)):
        assert x.x_m == pytest.approx(y.x_m, abs=1e-6)
        assert x.y_m == pytest.approx(y.y_m, abs=1e-6)
        assert (x.i, x.j) == (y.i, y.j)
        assert cells(x) == cells(y)
        assert x.distance_m + y.distance_m == pytest.approx(a.length_m, abs=1e-6)


def test_e2e_case_6_endpoints_and_custom_step(fixture_fields):
    conc, solid = fixture_fields
    r = run([(686006, 1191302.5), (686009, 1191302.5)], conc, solid, step=1.0)
    assert len(r.samples) == 4
    assert r.samples[0].distance_m == 0.0
    assert r.samples[-1].distance_m == r.length_m
    assert r.actual_step_m <= 1.0


def test_concentration_in_solid_is_a_conflict(fixture_fields):
    conc, solid = fixture_fields
    conc = conc.copy()
    conc[0, 0, 0] = 1.0
    with pytest.raises(TransectConflict):
        run([(686001, 1191302), (686002, 1191302)], conc, solid)


# --- Spec rules not covered by fixture numbers ------------------------------


def test_spacing_rules(fixture_fields):
    conc, solid = fixture_fields
    pts = [(686006, 1191302.5), (686009, 1191302.5)]
    for bad in (0.0, -1.0, 5.000001, math.inf, math.nan):
        with pytest.raises(TransectError):
            run(pts, conc, solid, step=bad)
    assert run(pts, conc, solid, step=5.0).requested_step_m == 5.0
    assert run(pts, conc, solid).requested_step_m == 5.0  # default min(dx,dy)
    # Exact multiple: L=3, step=1.5 -> 2 intervals, realised spacing == step.
    r = run(pts, conc, solid, step=1.5)
    assert len(r.samples) == 3
    assert r.actual_step_m == pytest.approx(1.5, abs=1e-6)


def test_default_step_uses_min_dx_dy():
    g = TransectGrid(686000.0, 1191300.0, 5.0, 3.0, 2.0, 2, 4, 2)
    conc = np.ones((2, 4, 2))
    solid = np.zeros_like(conc, dtype=bool)
    r = sample_transect(
        wgs([(686001, 1191301), (686001, 1191311)]), g, conc, solid,
        z_min_m=0, z_max_m=2,
    )
    assert r.requested_step_m == 3.0
    assert len(r.samples) == 5  # ceil(10/3)=4 intervals
    with pytest.raises(TransectError):
        sample_transect(
            wgs([(686001, 1191301), (686001, 1191311)]), g, conc, solid,
            z_min_m=0, z_max_m=2, step_m=4.0,
        )


def test_uniform_spacing_is_across_vertices_not_per_segment(fixture_fields):
    conc, solid = fixture_fields
    # 3 m then 4 m: per-segment sampling would put a sample on the corner.
    pts = [(686001, 1191301), (686004, 1191301), (686004, 1191305)]
    r = run(pts, conc, solid, step=2.0)
    d = np.array([s.distance_m for s in r.samples])
    assert r.length_m == pytest.approx(7.0, abs=1e-6)
    assert len(d) == 5  # ceil(7/2)=4 intervals of 1.75 m
    assert np.allclose(np.diff(d), 1.75, atol=1e-9)
    # sample at 3.5 m sits 0.5 m past the corner on the second segment
    s = r.samples[2]
    assert s.x_m == pytest.approx(686004.0, abs=1e-6)
    assert s.y_m == pytest.approx(1191301.5, abs=1e-6)


def test_vertex_count_limits(fixture_fields):
    conc, solid = fixture_fields
    one = wgs([(686001, 1191301)])
    with pytest.raises(TransectError):
        sample_transect(one, FIX, conc, solid, z_min_m=0, z_max_m=3)
    zig = [(686001 + (n % 2) * 8, 1191301 + n * 0.08) for n in range(100)]
    r = run(zig, conc, solid, z_min=6, z_max=8)
    assert len(r.samples) > 100
    with pytest.raises(TransectError):
        run(zig + [(686001, 1191309.5)], conc, solid, z_min=6, z_max=8)


def test_zig_zag_route_visits_columns_in_order():
    # Bigger synthetic grid with a unique value per voxel so i/j/k are checked.
    g = TransectGrid(686000.0, 1191300.0, 5.0, 5.0, 2.0, 6, 6, 5)
    k, j, i = np.meshgrid(range(5), range(6), range(6), indexing="ij")
    z = (k + 0.5) * 2.0
    conc = 1000.0 * i + 100.0 * j + (2.0 + 3.0 * z)
    solid = np.zeros_like(conc, dtype=bool)
    zig = [(686002.5, 1191302.5), (686027.5, 1191302.5),
           (686002.5, 1191317.5), (686027.5, 1191327.5)]
    r = sample_transect(wgs(zig), g, conc, solid, z_min_m=1.0, z_max_m=5.0)
    assert r.layers == (0, 1, 2)
    for s in r.samples:
        expected_i = math.floor((s.x_m - g.origin_x_m) / 5.0)
        expected_j = math.floor((s.y_m - g.origin_y_m) / 5.0)
        assert (s.i, s.j) == (expected_i, expected_j)
        for c in s.cells:
            assert c.concentration_ug_m3 == 1000 * s.i + 100 * s.j + c_linear(c.z_center_m)
    rev = sample_transect(wgs(zig[::-1]), g, conc, solid, z_min_m=1.0, z_max_m=5.0)
    assert [(s.i, s.j) for s in r.samples] == [(s.i, s.j) for s in reversed(rev.samples)]
    assert [cells(s) for s in r.samples] == [cells(s) for s in reversed(rev.samples)]


def test_boundary_heights_half_open():
    g = TransectGrid(0, 0, 5, 5, 2.0, 1, 1, 50)
    assert layer_index(0.0, g) == 0
    assert layer_index(1.999999, g) == 0
    assert layer_index(2.0, g) == 1  # BR-48: 2 m belongs to layer starting at 2 m
    assert layer_index(1.5, g) == 0
    assert layer_index(15.0, g) == 7  # 15 m -> [14,16), centre 15
    assert g.z_center(layer_index(1.5, g)) == 1.0
    assert layer_index(99.999, g) == 49
    with pytest.raises(TransectError):
        layer_index(100.0, g)  # top face outside
    with pytest.raises(TransectError):
        layer_index(-0.001, g)
    # band: z_max exclusive, top face allowed as band end
    assert [k for k, *_ in select_layers(2.0, 4.0, g)] == [1]
    assert [k for k, *_ in select_layers(1.0, 4.0, g)] == [0, 1]
    assert [k for k, *_ in select_layers(0.0, 100.0, g)] == list(range(50))
    for lo, hi in ((0, 0), (3, 2), (0, 100.01), (-1, 2)):
        with pytest.raises(TransectError):
            select_layers(lo, hi, g)


def test_single_height_returns_requested_and_centre(fixture_fields):
    conc, solid = fixture_fields
    r = run([(686006, 1191302.5), (686009, 1191302.5)], conc, solid, z_min=2.0, z_max=None)
    assert r.layers == (1,)
    c = r.samples[0].cells[0]
    assert (c.overlap_min_m, c.z_center_m, c.concentration_ug_m3) == (2.0, 3.0, 11.0)
    with pytest.raises(TransectError):
        run([(686006, 1191302.5), (686009, 1191302.5)], conc, solid, z_min=8.0, z_max=None)


def test_cell_face_round_trip_noise_is_snapped_not_clipped():
    assert cell_index(5.0 - 1e-10, 0.0, 5.0, 2) == 1
    assert cell_index(5.0 - 1e-6, 0.0, 5.0, 2) == 0
    with pytest.raises(TransectError):
        cell_index(-1e-6, 0.0, 5.0, 2)
    with pytest.raises(TransectError):
        cell_index(10.0, 0.0, 5.0, 2)


def test_sample_limit_rejected_before_reading(fixture_fields):
    conc, solid = fixture_fields
    pts = [(686006, 1191302.5), (686009, 1191302.5)]  # L = 3 m

    class Exploding(np.ndarray):
        def __getitem__(self, item):  # pragma: no cover - must not be hit
            raise AssertionError("concentration read before limit check")

    boom = conc.view(Exploding)
    # 2 layers; step -> positions = ceil(3/step)+1
    with pytest.raises(TransectError, match="exceeds"):
        sample_transect(wgs(pts), FIX, boom, solid, z_min_m=0, z_max_m=3, step_m=3 / 10000)
    # exactly at the limit: 9999 intervals -> 10000 positions x 2 = 20000
    r = run(pts, conc, solid, step=3 / 9999 * (1 + 1e-9))
    assert r.sample_count <= MAX_SAMPLES


def test_route_outside_domain(fixture_fields):
    conc, solid = fixture_fields
    for pts in (
        [(685999, 1191302), (686001, 1191302)],
        [(686001, 1191302), (686001, 1191310)],
        [(686001, 1191302), (686011, 1191302)],
    ):
        with pytest.raises(TransectError):
            run(pts, conc, solid)
    with pytest.raises(TransectError):
        sample_transect([[0, 0], [1, 0]], FIX, conc, solid, z_min_m=0, z_max_m=3)
    with pytest.raises(TransectError):
        sample_transect([[181, 10], [106, 10]], FIX, conc, solid, z_min_m=0, z_max_m=3)


def test_zero_length_route_rejected_duplicate_vertex_tolerated(fixture_fields):
    conc, solid = fixture_fields
    with pytest.raises(TransectError):
        run([(686001, 1191301), (686001, 1191301)], conc, solid)
    r = run([(686001, 1191301), (686001, 1191301), (686009, 1191301)], conc, solid)
    assert r.length_m == pytest.approx(8.0, abs=1e-6)


# ---------------------------------------------------------------------------
# Differential check against a line-by-line port of A's TypeScript loop
# (app/src/modules/results/services/transect.service.ts:72-148)
# ---------------------------------------------------------------------------

EPS = 1e-7


def _a_index(v, origin, spacing, count):
    offset = v - origin
    nearest = round(offset / spacing) * spacing  # JS Math.round, ties differ only at .5
    snapped = nearest if abs(offset - nearest) <= EPS else offset
    value = math.floor(snapped / spacing)
    if value < 0 or value >= count:
        raise TransectError("outside")
    return value


def _a_port(xy, g, z_min, z_max, step):
    for x, y in xy:
        _a_index(x, g.origin_x_m, g.dx_m, g.nx)
        _a_index(y, g.origin_y_m, g.dy_m, g.ny)
    dist = [0.0]
    for n in range(1, len(xy)):
        a, b = xy[n - 1], xy[n]
        length = math.hypot(b[0] - a[0], b[1] - a[1])
        if length <= EPS:
            raise TransectError("duplicate")
        dist.append(dist[-1] + length)
    length = dist[-1]
    first, last = math.floor(z_min / g.dz_m), math.ceil(z_max / g.dz_m) - 1
    intervals = math.ceil(length / step)
    if (intervals + 1) * (last - first + 1) > MAX_SAMPLES:
        raise TransectError("limit")
    out, seg = [], 1
    for n in range(intervals + 1):
        d = length if n == intervals else (n * length) / intervals
        while seg < len(dist) - 1 and d > dist[seg]:
            seg += 1
        t = (d - dist[seg - 1]) / (dist[seg] - dist[seg - 1])
        a, b = xy[seg - 1], xy[seg]
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        out.append((d, x, y, _a_index(x, g.origin_x_m, g.dx_m, g.nx),
                    _a_index(y, g.origin_y_m, g.dy_m, g.ny)))
    return list(range(first, last + 1)), out


PROD = TransectGrid(686012.538, 1191324.79, 5.0, 5.0, 2.0, 100, 100, 50)


def test_reference_matches_port_of_a_on_random_routes():
    rng = np.random.default_rng(94)
    conc = np.zeros((PROD.nz, PROD.ny, PROD.nx))
    solid = np.zeros_like(conc, dtype=bool)
    compared = mismatches = 0
    for trial in range(300):
        nv = int(rng.integers(2, 8))
        # include points exactly on internal faces in a third of the trials
        if trial % 3 == 0:
            xs = PROD.origin_x_m + 5.0 * rng.integers(1, 99, nv)
            ys = PROD.origin_y_m + 5.0 * rng.integers(1, 99, nv) + rng.uniform(0.1, 4.9, nv)
        else:
            xs = PROD.origin_x_m + rng.uniform(0.01, 499.99, nv)
            ys = PROD.origin_y_m + rng.uniform(0.01, 499.99, nv)
        lonlat = [list(TO_WGS.transform(x, y)) for x, y in zip(xs, ys)]
        xy = [FROM_WGS.transform(lo, la) for lo, la in lonlat]
        zlo = float(rng.choice([0.0, 1.5, 2.0, 14.0]))
        zhi = zlo + float(rng.choice([1.0, 2.0, 6.5, 20.0]))
        step = float(rng.choice([5.0, 2.5, 1.0, 0.7]))
        try:
            layers_a, samples_a = _a_port(xy, PROD, zlo, zhi, step)
        except TransectError:
            with pytest.raises(TransectError):
                sample_transect(lonlat, PROD, conc, solid, z_min_m=zlo, z_max_m=zhi, step_m=step)
            continue
        r = sample_transect(lonlat, PROD, conc, solid, z_min_m=zlo, z_max_m=zhi, step_m=step)
        assert list(r.layers) == layers_a
        assert len(r.samples) == len(samples_a)
        for s, (d, x, y, i, j) in zip(r.samples, samples_a):
            compared += 1
            assert s.distance_m == pytest.approx(d, abs=1e-6)
            assert s.x_m == pytest.approx(x, abs=1e-6)
            assert s.y_m == pytest.approx(y, abs=1e-6)
            if (s.i, s.j) != (i, j):
                mismatches += 1
    assert compared > 1000
    assert mismatches == 0
