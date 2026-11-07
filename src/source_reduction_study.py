"""B8.4/B9.2: six real HTTP runs; paired-field and mass-rate verification.

Run against an isolated real-mode app. Never rewrite an existing study directory.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path
import time
import uuid
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
import xarray as xr
import yaml

MULTIPLIERS = (1.0, 0.8, 0.6)


def artifact_filename(manifest, kind):
    """Use the checksum contract's name; API kind and filename are not interchangeable."""
    matches = [item['path'] for item in manifest['artifacts'] if item['kind'] == kind]
    if len(matches) != 1:
        raise ValueError('Missing/duplicate artifact kind')
    name = matches[0]
    if not name or name in ('.','..') or '/' in name or '\\' in name or ':' in name:
        raise ValueError('Unsafe artifact path')
    return name


def paired_metrics(baseline, reduced, multiplier):
    """Same valid voxels, including zero; no ratio at zero and no uint8 data."""
    if baseline.shape != reduced.shape or not np.array_equal(np.isfinite(baseline), np.isfinite(reduced)):
        raise ValueError('Different grid or solid/no-data masks')
    valid = np.isfinite(baseline)
    if not valid.any():
        raise ValueError('No paired air voxels')
    a, b = baseline[valid].astype(float), reduced[valid].astype(float)
    scale = max(float(np.max(a)), np.finfo(float).tiny)
    return {'air_voxels': int(valid.sum()), 'baseline_mean_ug_m3': float(a.mean()),
        'mean_ug_m3': float(b.mean()), 'max_ug_m3': float(b.max()),
        'mean_delta_ug_m3': float((b-a).mean()),
        'linearity_linf_relative_to_baseline_max': float(np.max(np.abs(b-multiplier*a))/scale),
        'zero_baseline_voxels': int((a == 0).sum())}


def physics_signature(config):
    """Identity/run source preset are the only allowed changes within a seasonal triplet."""
    canonical = {**config, 'run': {k:v for k,v in config['run'].items()
        if k not in ('run_id', 'emission_multiplier')}}
    # YAML dates are native date objects after safe_load; preserve their type
    # rather than dropping temporal inputs from the physics identity.
    return hashlib.sha256(yaml.safe_dump(canonical, sort_keys=True).encode()).hexdigest()


def analyze_triplet(paths):
    records = []
    for path in paths:
        manifest = json.loads((path/'manifest.json').read_text(encoding='utf-8'))
        config = yaml.safe_load((path/'config.yaml').read_text(encoding='utf-8'))
        metrics = json.loads((path/'metrics.json').read_text(encoding='utf-8'))
        multiplier = config['run']['emission_multiplier']
        if manifest['scenario'].get('emission_multiplier') != multiplier:
            raise ValueError('Manifest/config source multiplier differs')
        if manifest['verification']['status'] != 'pass' or any(
                item['status'] != 'pass' for item in manifest['verification']['checks'].values()):
            raise ValueError('Failed verification gate')
        if manifest['stopping']['criterion'] != 'steady_state' or metrics['correction_kg'] != 0:
            raise ValueError('Study requires steady state without mass correction')
        for item in manifest['artifacts']:
            data = (path/item['path']).read_bytes()
            if len(data) != item['size_bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Artifact integrity failure')
        with xr.open_dataset(path/'concentration.nc') as ds:
            field = ds['C'].values.copy()
        with xr.open_dataset(path/'wind.nc') as ds:
            wind = [ds[name].values.copy() for name in ('uf','vf','wf')]
        records.append((multiplier, path, manifest, config, metrics, field, wind))
    if sorted(item[0] for item in records) != [0.6,0.8,1.0]:
        raise ValueError('Expected exactly baseline, -20%, -40%')
    records.sort(key=lambda item: -item[0])
    base = records[0]
    if len({item[2]['input_hash'] for item in records}) != 3:
        raise ValueError('Reduced runs must have distinct input hashes')
    rows = []
    for multiplier, path, manifest, config, metrics, field, wind in records:
        if physics_signature(config) != physics_signature(base[3]) or manifest['model_version'] != base[2]['model_version']:
            raise ValueError('Mixed physics/config/model version in source-only experiment')
        if any(not np.array_equal(a,b) for a,b in zip(base[6],wind)):
            raise ValueError('Wind changed in source-only experiment')
        rate = metrics['emitted_kg']/metrics['simulated_s']
        base_rate = base[4]['emitted_kg']/base[4]['simulated_s']
        if not np.isclose(rate, multiplier*base_rate, rtol=1e-8, atol=1e-18):
            raise ValueError('Emission rate does not match requested multiplier')
        mass_error = abs(metrics['emitted_kg']-metrics['remaining_kg']-metrics['escaped_kg'])/metrics['emitted_kg']
        paired = paired_metrics(base[5],field,multiplier)
        if mass_error > 1e-6 or paired['linearity_linf_relative_to_baseline_max'] > 5e-5:
            raise ValueError('Mass budget or controlled source linearity check failed')
        rows.append({'scenario':manifest['scenario']['id'], 'emission_multiplier':multiplier,
            'run_id':manifest['run_id'], 'model_version':manifest['model_version'],
            'input_hash':manifest['input_hash'], 'physics_signature':physics_signature(config),
            'manifest_sha256':hashlib.sha256((path/'manifest.json').read_bytes()).hexdigest(),
            'source_rate_kg_s':rate, 'emitted_kg':metrics['emitted_kg'],
            'remaining_kg':metrics['remaining_kg'], 'escaped_kg':metrics['escaped_kg'],
            'mass_error_relative':mass_error, 'simulated_s':metrics['simulated_s'],
            'wall_clock_s':metrics['wall_clock_s'], **paired})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--resume', action='store_true', help='Verify and reuse completed bundles in this study only')
    args = parser.parse_args()
    origin = urlparse(args.base)
    if origin.scheme != 'http' or origin.hostname not in ('localhost','127.0.0.1') or origin.username or origin.query:
        parser.error('Use a local isolated HTTP app origin')
    args.out.mkdir(parents=True, exist_ok=args.resume)
    if args.resume and (args.out/'analysis.json').exists():
        (args.out/('analysis.previous-'+uuid.uuid4().hex+'.json')).write_bytes((args.out/'analysis.json').read_bytes())
    def api(path, body=None):
        request = Request(args.base.rstrip('/')+'/api'+path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Content-Type':'application/json'})
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    report = {'schema_version':1, 'status':'running', 'base':args.base, 'results':[],
        'analysis_code_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'limitations':['Controlled EDGAR proxy source experiment; not measured air quality or a policy forecast.',
            'Linearity holds for these fixed wind/geometry/K, homogeneous initial/boundary settings only.']}
    try:
        for scenario in ('dry_nov_apr','wet_may_oct'):
            paths = []
            for multiplier in MULTIPLIERS:
                # An explicit resume never rewrites bundles or infers source settings from a UI label.
                matches = []
                if args.resume:
                    for directory in args.out.iterdir():
                        if directory.is_dir() and (directory/'manifest.json').exists():
                            saved = json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
                            if saved['scenario']['id']==scenario and saved['scenario'].get('emission_multiplier')==multiplier:
                                matches.append(saved['run_id'])
                if len(matches)>1:
                    raise ValueError('Ambiguous completed bundles; use a fresh output directory')
                run_id = matches[0] if matches else api('/runs',
                    {'scenario_id':scenario, 'model':'fv', 'emission_multiplier':multiplier})['run_id']
                print(f'{scenario} source={multiplier:g} run={run_id}', flush=True)
                deadline = time.monotonic()+930
                while True:
                    run = api('/runs/'+run_id)
                    if run['status'] in ('succeeded','failed','stale'):
                        break
                    if time.monotonic() > deadline:
                        raise TimeoutError('Run did not finish')
                    time.sleep(2)
                if run['status'] != 'succeeded' or any('mock run' in w for w in run['warnings']):
                    raise ValueError('Need successful real run: '+run_id)
                target = args.out/run_id
                target.mkdir(exist_ok=args.resume)
                items = api('/runs/'+run_id+'/artifacts')['artifacts']
                downloaded_manifest = None
                for item in sorted(items, key=lambda item: item['kind']!='manifest'):
                    if item['kind'] not in ('manifest','config','concentration','wind','metrics','columns','log','wind_vectors'):
                        continue
                    with urlopen(args.base.rstrip('/')+f'/api/runs/{run_id}/artifacts/{item["kind"]}/download', timeout=30) as response:
                        data = response.read()
                    if hashlib.sha256(data).hexdigest() != item['sha256'] or len(data) != item['size_bytes']:
                        raise ValueError('Downloaded artifact mismatch')
                    if item['kind']=='manifest':
                        downloaded_manifest=json.loads(data)
                        name='manifest.json'
                    else:
                        name=artifact_filename(downloaded_manifest,item['kind'])
                    destination=target/name
                    if destination.exists() and destination.read_bytes()!=data:
                        raise ValueError('Refusing to overwrite changed study artifact')
                    if not destination.exists():
                        destination.write_bytes(data)
                paths.append(target)
            report['results'].extend(analyze_triplet(paths))
        report['status'] = 'pass'
        with (args.out/'comparison.csv').open('w', newline='', encoding='utf-8') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(report['results'][0]))
            writer.writeheader(); writer.writerows(report['results'])
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(7,4))
        for scenario in ('dry_nov_apr','wet_may_oct'):
            rows = [row for row in report['results'] if row['scenario']==scenario]
            ax.plot([round((1-row['emission_multiplier'])*100) for row in rows],
                [row['mean_ug_m3'] for row in rows], marker='o', label=scenario)
        ax.set(xlabel='Source reduction (%)', ylabel='Air-voxel mean concentration (µg/m³)', xticks=[0,20,40])
        ax.legend(); fig.tight_layout(); fig.savefig(args.out/'source-reduction.png',dpi=300); plt.close(fig)
    except Exception as error:
        report['status']='fail'; report['error']=str(error)
        raise
    finally:
        (args.out/'analysis.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'runs':len(report['results']),'out':str(args.out)}),flush=True)


if __name__ == '__main__':
    main()
