import numpy as np
from src.production_analysis import analytic_cross_check, summarize, paired_height_comparison


def test_independent_heat_equation_cross_check():
    result=analytic_cross_check()
    assert result['relative_error'] < 1e-8


def test_report_uses_containing_height_and_real_units():
    c=np.ones((10,2,2)); c[0,0,0]=np.nan; c[7]*=3
    result=summarize(c,dict(dz_m=2,dy_m=5,dx_m=5),{'test':{'value':2}})
    assert result['layers'][0]['k']==0
    assert result['layers'][1]['z_center_m']==15
    assert result['layers'][1]['exceedance_area_m2']['test']==100
    assert result['exceedance_volume_m3']['test']==200


def test_height_comparison_uses_same_air_columns_and_keeps_zero():
    c = np.ones((10, 1, 4))
    c[0, 0] = [2, np.nan, 0, 4]
    c[7, 0] = [1, 100, 3, np.nan]
    result = paired_height_comparison(c, 2)
    assert result['paired_air_columns'] == 2
    assert result['lower_mean_ug_m3'] == 1
    assert result['upper_mean_ug_m3'] == 2
    assert result['upper_greater_fraction'] == .5
    assert result['ratio_columns'] == 1
    assert result['median_upper_over_lower'] == .5
    assert result['layer_centres_m'] == [1, 15]


def test_height_comparison_empty_pair_is_missing_not_zero():
    result = paired_height_comparison(np.full((10, 1, 1), np.nan), 2)
    assert result['paired_air_columns'] == 0
    assert result['lower_mean_ug_m3'] is None
    assert result['median_upper_over_lower'] is None
