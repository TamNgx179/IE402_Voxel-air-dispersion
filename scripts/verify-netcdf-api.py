"""Check published PostGIS slices and profiles against the original float32 NetCDF."""
import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from urllib.request import urlopen

import numpy as np
import xarray as xr


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--run', required=True, action='append')
    args = parser.parse_args()
    origin = urlsplit(args.base)
    require(origin.scheme == 'http' and origin.hostname in {'localhost', '127.0.0.1'} and
            not (origin.username or origin.password or origin.query or origin.fragment) and
            origin.path in {'', '/'}, 'Use the HTTP origin of a local demo')
    base = args.base.rstrip('/')

    def request(path):
        require(path.startswith('/api/'), 'Expected a same-origin API path')
        with urlopen(base + path, timeout=30) as response:
            return response.read()

    def read(path):
        return json.loads(request(path))

    results = []
    for run in args.run:
        prefix = f'/api/runs/{run}'
        summary = read(prefix + '/summary')
        require(summary['run_id'] == run and summary['verification']['status'] == 'pass',
                f'{run}: expected a verified run')
        catalog = read(prefix + '/artifacts')
        netcdf = next(artifact for artifact in catalog['artifacts'] if artifact['kind'] == 'concentration')
        binary = request(netcdf['download_url'])
        digest = hashlib.sha256(binary).hexdigest()
        require(digest == netcdf['sha256'] and len(binary) == netcdf['size_bytes'],
                f'{run}: concentration checksum or size differs')

        # netCDF4 opens a verified local file. Reopen within the same request scope
        # so the two coordinates and the published floats have a single oracle.
        with TemporaryDirectory() as temporary:
            path = Path(temporary) / 'concentration.nc'
            path.write_bytes(binary)
            with xr.open_dataset(path) as dataset:
                concentration = dataset['C'].transpose('z', 'y', 'x').to_numpy()

        count = 0
        profiles = set()
        for height in (1, 15):
            slice_payload = read(prefix + f'/slices?z_m={height}')
            k = slice_payload['k']
            seen = set()
            for feature in slice_payload['feature_collection']['features']:
                item = feature['properties']
                i, j = item['i'], item['j']
                require((i, j) not in seen and float(concentration[k, j, i]) == item['concentration_ug_m3'],
                        f'{run}: slice mismatch at ({i}, {j}, {k})')
                seen.add((i, j))
            require(len(seen) == np.count_nonzero(np.isfinite(concentration[k])),
                    f'{run}: slice misses air cells or includes solids')
            count += len(seen)
            profiles.add(min(seen))
            # Verify a column with at least one solid level as well.
            solid = np.argwhere(~np.isfinite(concentration[k]))
            if len(solid):
                j, i = map(int, solid[0])
                profiles.add((i, j))

        for i, j in sorted(profiles):
            profile = read(prefix + f'/profile?i={i}&j={j}')
            expected = [float(value) if np.isfinite(value) else None for value in concentration[:, j, i]]
            actual = [item['concentration_ug_m3'] for item in profile['levels']]
            require(actual == expected, f'{run}: profile mismatch at ({i}, {j})')
        results.append({'run_id': run, 'model_version': summary['model_version'],
                        'input_hash': summary['input_hash'], 'netcdf_sha256': digest,
                        'slice_values_checked': count, 'profile_levels_checked': len(profiles) * concentration.shape[0]})

    print(json.dumps({'status': 'pass', 'runs': results}, indent=2))


if __name__ == '__main__':
    main()
