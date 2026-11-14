"""Compare verified FV and Gaussian fields, then index a local candidate by SHA-256."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
import xarray as xr

from src.solver import sha256


def verified_field(directory: Path):
    manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['verification']['status'] != 'pass':
        raise ValueError(f'Unverified simulation: {directory}')
    for artifact in manifest['artifacts']:
        path = directory / artifact['path']
        if path.stat().st_size != artifact['size_bytes'] or sha256(path) != artifact['sha256']:
            raise ValueError(f'Artifact integrity mismatch: {path}')
    with xr.open_dataset(directory / 'concentration.nc') as dataset:
        return manifest, dataset['C'].load()


def compare(baseline, alternative):
    """Match XY coordinates and compare exactly the shared baseline heights."""
    candidate = alternative.sel(z=baseline.z)
    a, b = xr.align(baseline, candidate, join='exact')
    rows = []
    for height, first, second in zip(a.z.values, a.values, b.values, strict=True):
        valid = np.isfinite(first) & np.isfinite(second)
        x, y = first[valid].astype(float), second[valid].astype(float)
        rows.append(dict(height_m=float(height), air_cells=int(valid.sum()),
                         baseline_mean=float(x.mean()) if x.size else None,
                         alternative_mean=float(y.mean()) if y.size else None,
                         mean_delta=float((y-x).mean()) if x.size else None,
                         mae=float(np.abs(y-x).mean()) if x.size else None))
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    args = parser.parse_args()
    root = args.root
    cleanroom = json.loads((root / 'cleanroom-tcp' / 'rehearsal.json').read_text(encoding='utf-8'))
    grid = json.loads((root / 'grid' / 'summary.json').read_text(encoding='utf-8'))
    if cleanroom['status'] != 'pass' or not grid['all_cases_pass_verification']:
        raise ValueError('Docker and grid verification must pass before indexing the bundle')
    corridors = {season: json.loads((root / f'corridor-{season}.json').read_text(encoding='utf-8'))
                 for season in ('dry', 'wet')}
    for season, corridor in corridors.items():
        if len(corridor['cases']) != 4:
            raise ValueError(f'Missing independent corridor results for {season}')
    production = json.loads((root / 'production' / 'study.json').read_text(encoding='utf-8'))
    upper = json.loads((root / 'upper' / 'study.json').read_text(encoding='utf-8'))
    fields = {item['case']: verified_field(Path(item['directory']))
              for item in production['runs'] + upper['runs']}
    inventory = {}
    for case, (manifest, _) in fields.items():
        inventory[case] = {key: manifest[key] for key in ('run_id', 'input_hash', 'model_version')}
    gaussian_hashes = {}
    comparisons = []
    for name in ('wet', 'gaussian_dry', 'gaussian_wet', 'height_low', 'height_high', 'k_half', 'top_high'):
        season = 'wet' if name.endswith('wet') else 'dry'
        scenario = 'wet_may_oct' if season == 'wet' else 'dry_nov_apr'
        baseline_manifest, baseline = fields['wet' if name == 'gaussian_wet' else 'dry']
        if name.startswith('gaussian'):
            path = root / 'gaussian' / f'concentration_{scenario}_gaussian.nc'
            gaussian_hashes[name] = sha256(path)
            with xr.open_dataset(path) as dataset:
                candidate = dataset['C'].load()
            candidate_id = gaussian_hashes[name]
        else:
            manifest, candidate = fields[name]
            candidate_id = manifest['run_id']
        comparisons.extend(dict(case=name, baseline=baseline_manifest['run_id'], candidate=candidate_id, **row)
                           for row in compare(baseline, candidate))

    source = root / 'source-merged'
    reduction = json.loads((source / 'analysis.json').read_text(encoding='utf-8'))
    if reduction['status'] != 'pass' or len(reduction['results']) != 6:
        raise ValueError('Expected both three-run emission studies')
    for run in reduction['results']:
        manifest, _ = verified_field(source / run['run_id'])
        if run['input_hash'] != manifest['input_hash']:
            raise ValueError('Source study and manifest identities differ')
        inventory[run['run_id']] = {
            **{key: manifest[key] for key in ('run_id', 'input_hash', 'model_version')},
            'scenario': manifest['scenario'],
        }
    for season, case in corridors.items():
        run = inventory[case['run_id']]
        expected_scenario = 'dry_nov_apr' if season == 'dry' else 'wet_may_oct'
        if (run['scenario']['id'] != expected_scenario or run['scenario']['emission_multiplier'] != 1 or
                any(item['input_hash'] != run['input_hash'] for item in case['cases'])):
            raise ValueError(f'Corridor evidence does not match the baseline for {season}')
    (root / 'run-inventory.json').write_text(
        json.dumps(dict(fv_runs=inventory, gaussian_sha256=gaussian_hashes), indent=2) + '\n',
        encoding='utf-8',
    )
    with (root / 'vertical-comparisons.csv').open('w', encoding='utf-8', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(comparisons[0]))
        writer.writeheader()
        writer.writerows(comparisons)
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import pyplot as plt
    fig, ax = plt.subplots(figsize=(7, 5))
    for name in ('wet', 'gaussian_dry', 'gaussian_wet', 'height_low', 'height_high', 'top_high'):
        rows = [row for row in comparisons if row['case'] == name]
        ax.plot([r['mean_delta'] for r in rows], [r['height_m'] for r in rows], label=name)
    ax.set(xlabel='Alternative minus reference (µg/m³)', ylabel='Voxel centre height (m)')
    ax.legend()
    fig.tight_layout()
    fig.savefig(root / 'vertical-comparisons.png', dpi=300)
    plt.close(fig)
    assets = {}
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if (path.is_file() and path.name != 'sha256-index.json'
                and relative.parts[0] not in {'cleanroom', 'source', 'corridor-preview.json', 'high-parallel'}
                and not any(part.startswith('chrome-profile-') for part in relative.parts)):
            assets[relative.as_posix()] = dict(sha256=sha256(path), size_bytes=path.stat().st_size)
    (root / 'sha256-index.json').write_text(json.dumps(assets, indent=2) + '\n', encoding='utf-8')
    print(f'Compared {len(comparisons)} height/case pairs and indexed {len(assets)} artifacts')


if __name__ == '__main__':
    main()
