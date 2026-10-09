import numpy as np
from src.wind.core import project_mass_consistent


def test_cg_matches_sor_corrected_faces_on_obstacle_grid():
    solid=np.zeros((6,8,10),dtype=bool)
    solid[:3,3:5,4:6]=True
    u=np.ones(solid.shape); v=np.ones(solid.shape)*.4; w=np.zeros(solid.shape)
    args=dict(dx=5,dy=5,dz=2,tolerance=1e-8,max_iter=10000)
    a=project_mass_consistent(u,v,w,solid,**args)
    b=project_mass_consistent(u,v,w,solid,method='cg',**args)
    for fa,fb in zip((a.uf,a.vf,a.wf),(b.uf,b.vf,b.wf)):
        np.testing.assert_allclose(fa,fb,atol=1e-7)
    assert np.max(np.abs(b.divergence_after[~solid])) < 1e-8
