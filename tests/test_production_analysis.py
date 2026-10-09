import numpy as np
from src.production_analysis import analytic_cross_check, summarize


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
