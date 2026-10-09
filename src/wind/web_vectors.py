"""Downsample corrected wind, not background metadata, for the GIS viewer."""
import json
from pathlib import Path
import numpy as np
from pyproj import Transformer


def export_vectors(path: Path, result, solid, grid, crs, run_id, stride=5):
    if not isinstance(stride, int) or stride < 1:
        raise ValueError("wind vector stride must be a positive integer")
    transformer = Transformer.from_crs(crs, 4326, always_xy=True)
    layers = []
    # Reconstruct cell vectors from the exact corrected faces used by transport.
    u = .5 * (result.uf[..., :-1] + result.uf[..., 1:])
    v = .5 * (result.vf[:, :-1, :] + result.vf[:, 1:, :])
    w = .5 * (result.wf[:-1, ...] + result.wf[1:, ...])
    for k in range(grid['nz']):
        vectors = []
        for j in range(stride // 2, grid['ny'], stride):
            for i in range(stride // 2, grid['nx'], stride):
                if solid[k, j, i]:
                    continue
                lon, lat = transformer.transform(grid['origin_x_m'] + (i + .5) * grid['dx_m'],
                                                 grid['origin_y_m'] + (j + .5) * grid['dy_m'])
                vectors.append([i, j, lon, lat, float(u[k,j,i]), float(v[k,j,i]), float(w[k,j,i])])
        layers.append({'k': k, 'z_m': (k + .5) * grid['dz_m'], 'vectors': vectors})
    path.write_text(json.dumps({'schema_version': '1.0', 'run_id': run_id, 'units': 'm s-1',
        'source': 'corrected FV face velocities', 'stride': stride,
        'columns': ['i','j','lon','lat','u','v','w'], 'layers': layers}, allow_nan=False), encoding='utf-8')
