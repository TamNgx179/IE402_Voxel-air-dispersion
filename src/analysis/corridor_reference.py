"""Independent road-band integration using scene WKT and the solver's NetCDF."""
from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
import xarray as xr
from shapely import wkt
from shapely.geometry import MultiLineString, box


def integrate(lines, domain, grid, field, solid, radii, low, high, threshold):
    """Integrate cells against independently constructed planar distance bands."""
    dx, dy, dz = (grid[f'd{axis}_m'] for axis in 'xyz')
    x0, y0 = (grid[f'origin_{axis}_m'] for axis in 'xy')
    # Pin arc resolution to the public query's 8 segments per quarter circle.
    route = MultiLineString(lines)
    inner = domain.difference(domain)
    for radius in radii:
        outer = route.buffer(radius, quad_segs=8).intersection(domain)
        band = outer.difference(inner)
        inner = outer
        air = valid = mass = above = 0.0
        for j, i in np.ndindex(field.shape[1:]):
            x, y = x0 + i * dx, y0 + j * dy
            area = band.intersection(box(x, y, x + dx, y + dy)).area
            if area == 0:
                continue
            for k, value in enumerate(field[:, j, i]):
                depth = min(high, (k + 1) * dz) - max(low, k * dz)
                if depth <= 0 or solid[k, j, i]:
                    continue
                volume = area * depth
                air += volume
                if np.isfinite(value):
                    valid += volume
                    mass += volume * float(value)
                    if value > threshold:
                        above += volume
        yield dict(area_m2=band.area, air_volume_m3=air, valid_volume_m3=valid,
                   coverage=valid / air if air else None, mean_ug_m3=mass / valid if valid else None,
                   exceedance_volume_m3=above)


def main():
    from src.solver import sha256, solid_mask

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--netcdf', type=Path, required=True)
    parser.add_argument('--scene', type=Path, default=Path('db/seeds/scene'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    origin = urlparse(args.base)
    if origin.scheme != 'http' or origin.hostname not in ('127.0.0.1', 'localhost') or origin.username:
        parser.error('Use a local HTTP app')

    def api(suffix, body=None):
        request = Request(f'{args.base.rstrip("/")}/api/runs/{args.run}{suffix}',
                          data=None if body is None else json.dumps(body).encode(),
                          headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=30) as response:
            return response.read()

    artifacts = json.loads(api('/artifacts'))['artifacts']
    digest = sha256(args.netcdf)
    if not any(a['kind'] == 'concentration' and a['sha256'] == digest for a in artifacts):
        raise ValueError('NetCDF is not the artifact for the selected run')
    scene = json.loads((args.scene / 'scene_manifest.json').read_text(encoding='utf-8'))
    for name, expected in scene['files'].items():
        if sha256(args.scene / name) != expected:
            raise ValueError(f'Invalid scene checksum: {name}')
    grid = scene['grid']
    summary = json.loads(api('/summary'))
    if any(summary['grid'][key] != value for key, value in grid.items()):
        raise ValueError('Scene grid does not match the run')
    with xr.open_dataset(args.netcdf) as dataset:
        if dataset['C'].dims != ('z', 'y', 'x') or dataset['C'].attrs['units'] != 'ug m-3':
            raise ValueError('Unexpected NetCDF axes or concentration units')
        field = dataset['C'].values
    solid = solid_mask(args.scene / 'grid_cells.csv', grid)
    with (args.scene / 'roads.csv').open(encoding='utf-8', newline='') as handle:
        roads = list(csv.DictReader(handle))
    ids = list(dict.fromkeys(road['source_feature_id'] for road in roads))[:3]
    lines = [wkt.loads(road['wkt']) for road in roads if road['source_feature_id'] in ids]
    domain = wkt.loads(scene['study_area']['wkt'])
    cases = []
    for heights in [(1, 15), (15, 31)]:
        for distances in [[10, 25, 50], [15, 30, 60]]:
            request = dict(road_ids=ids, distances_m=distances, z_min_m=heights[0],
                           z_max_m=heights[1], threshold_ug_m3=0.15)
            actual = json.loads(api('/road-corridor', request))
            if actual['run_id'] != args.run or actual['input_hash'] != summary['input_hash']:
                raise ValueError('Corridor response identity differs from the run')
            rows = list(csv.DictReader(io.StringIO(api('/road-corridor/csv', request).decode())))
            expected = list(integrate(lines, domain, grid, field, solid, distances, *heights, 0.15))
            for ref, band, row in zip(expected, actual['bands'], rows, strict=True):
                if row['run_id'] != args.run or row['input_hash'] != actual['input_hash']:
                    raise ValueError('Export identity differs from API')
                for key, value in ref.items():
                    exported = float(row[key]) if row[key] else None
                    if exported != band[key]:
                        raise ValueError(f'API/CSV mismatch for {key}')
                    if value is None or band[key] is None:
                        if value != band[key]:
                            raise ValueError(f'Missing value mismatch for {key}')
                    else:
                        np.testing.assert_allclose(band[key], value, rtol=1e-7, atol=1e-7,
                                                   err_msg=f'Independent corridor mismatch for {key}')
            cases.append(dict(request=request, bands=expected, input_hash=actual['input_hash']))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(dict(run_id=args.run, netcdf_sha256=digest, cases=cases),
                                   indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(f'Independent NetCDF, API and CSV matched for {len(cases)} requests')


if __name__ == '__main__':
    main()
