import json
from types import SimpleNamespace
import numpy as np
from src.wind.web_vectors import export_vectors


def test_export_uses_corrected_faces_and_excludes_solid(tmp_path):
    grid=dict(nx=4,ny=4,nz=2,dx_m=5,dy_m=5,dz_m=2,origin_x_m=686000,origin_y_m=1191300)
    solid=np.zeros((2,4,4),bool); solid[0,1,1]=True
    faces=SimpleNamespace(uf=np.ones((2,4,5))*2,vf=np.ones((2,5,4))*3,wf=np.ones((3,4,4))*.5)
    path=tmp_path/'vectors.json'
    export_vectors(path,faces,solid,grid,'EPSG:32648','test-run',stride=2)
    data=json.loads(path.read_text())
    assert data['run_id']=='test-run'
    assert len(data['layers'][0]['vectors'])==3
    assert len(data['layers'][1]['vectors'])==4
    for layer in data['layers']:
        for row in layer['vectors']:
            assert row[4:]==[2.,3.,.5]
            assert 106<row[2]<107 and 10<row[3]<11
