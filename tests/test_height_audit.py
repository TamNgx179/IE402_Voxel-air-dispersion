import pytest

from src.analysis.height_audit import audit, positive_number


def building(height, osm=None):
    return {"properties": {"resolved_height_m": height, "osm_height_raw": osm}}


def test_top_boundary_and_osm_conflict_are_separate():
    report = audit([building(91, "186"), building(100, "50"), building(0.5)], top_m=100, dz_m=2)
    assert report["summary"]["minimum_top_clearance_m"] == 0
    assert report["summary"]["resolved_reaches_or_exceeds_top"] == 1
    assert report["summary"]["osm_reaches_or_exceeds_top"] == 1
    assert report["summary"]["below_first_voxel_center"] == 1
    tower = report["buildings"][1]
    assert tower["top_clearance_m"] == 9
    assert tower["clearance_in_layers"] == 4.5
    assert tower["osm_minus_resolved_m"] == 95


@pytest.mark.parametrize("value", [None, "12 ft", "10;20", "nan", float("inf"), -1, 0, True])
def test_no_guessed_or_nonfinite_heights(value):
    assert positive_number(value) is None


def test_invalid_resolved_height_fails_instead_of_omitting_building():
    with pytest.raises(ValueError, match="resolved_height_m"):
        audit([building(None)], top_m=100, dz_m=2)


def test_unsupported_osm_height_is_visible():
    report = audit([building(20, "60 ft")], top_m=100, dz_m=2)
    assert report["summary"]["unparsed_osm_heights"] == 1
    assert report["buildings"][0]["osm_reaches_or_exceeds_top"] is None


def test_explicit_metre_suffix_is_accepted():
    assert positive_number("26 m") == 26
