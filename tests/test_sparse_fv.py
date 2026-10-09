import numpy as np
import pytest
from src.fv_operator import SparseFVStepper
from src.solver import TRANSPORT
from src.wind import project_mass_consistent


def test_sparse_operator_matches_face_flux_step_and_mass_ledger():
    rng=np.random.default_rng(123)
    shape=(6,8,10); solid=np.zeros(shape,bool); solid[:3,3:5,4:6]=True
    wind=project_mass_consistent(np.ones(shape),np.ones(shape)*-.4,np.zeros(shape),solid,dx=5,dy=4,dz=2,method='cg')
    faces=(wind.uf,wind.vf,wind.wf); k=(.8,1.3,1.3)
    source=rng.uniform(0,1e-12,size=shape); source[solid]=0
    a=rng.uniform(0,1e-10,size=shape); a[solid]=0; b=a.copy()
    sparse=SparseFVStepper(faces,source,k,solid,(2,4,5),TRANSPORT)
    dt=TRANSPORT.cfl_time_step_faces(faces,k,dz_m=2,dy_m=4,dx_m=5)
    la={}; lb={}
    for _ in range(100):
        a=TRANSPORT.transport_step_faces(a,faces,source,k,dt,dz_m=2,dy_m=4,dx_m=5,solid=solid,ledger=la)
        b=sparse.step(b,dt,lb)
    np.testing.assert_allclose(a,b,rtol=1e-12,atol=1e-24)
    for key in ('emitted_kg','escaped_kg','solid_removed_kg'):
        assert la[key]==pytest.approx(lb[key],rel=1e-12,abs=1e-20)


def test_sparse_unstable_step_is_rejected_without_clipping():
    shape=(2,3,4); zero=np.zeros(shape); solid=np.zeros(shape,bool)
    faces=(np.ones((2,3,5))*2,np.zeros((2,4,4)),np.zeros((3,3,4)))
    sparse=SparseFVStepper(faces,zero,(0,0,0),solid,(1,1,1),TRANSPORT)
    c=zero.copy(); c[0,1,1]=1
    with pytest.raises(TRANSPORT.NegativeConcentrationError):
        sparse.step(c,10,{})
