"""Reproducible B5/B6 production runs. Outputs are evidence, never mock fields."""
from __future__ import annotations
import argparse
import copy
import json
import os
import platform
from pathlib import Path
import subprocess
import sys
import time
import uuid
import shutil
import numpy as np
import pandas as pd
import psutil
import xarray as xr
import yaml
from src.solver import REPO_ROOT, sha256, solid_mask


def raster_height(scene, grid, all_touched, factor=1):
    from shapely import wkt
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    buildings=pd.read_csv(scene/'buildings.csv').sort_values('height_m')
    shapes=[(wkt.loads(row.wkt),row.height_m*factor) for row in buildings.itertuples()]
    north=rasterize(shapes,out_shape=(grid['ny'],grid['nx']),fill=0,
        transform=from_origin(grid['origin_x_m'],grid['origin_y_m']+grid['ny']*grid['dy_m'],grid['dx_m'],grid['dy_m']),
        all_touched=all_touched,dtype='float32')
    return np.flipud(north)


def height_variant(config: dict, factor: float, out: Path):
    """Perturb voxel roof heights, keeping footprint and total emission fixed."""
    scene = REPO_ROOT / config['paths']['scene_package_dir']
    target = out / 'scene'
    target.mkdir()
    manifest=json.loads((scene/'scene_manifest.json').read_text(encoding='utf-8'))
    for name in manifest['files']:
        shutil.copy2(scene/name,target/name)
    cells=pd.read_csv(target/'grid_cells.csv')
    grid=manifest['grid']
    height=raster_height(scene,grid,config['voxelization']['rasterization']['all_touched'],factor)
    z=(np.arange(grid['nz'])+.5)*grid['dz_m']
    levels=(z[:,None,None]<height[None,...]).sum(axis=0)
    for row in cells.itertuples():
        count=int(levels[row.j,row.i])
        cells.loc[row.Index,'solid_from_k']=0 if count else np.nan
        cells.loc[row.Index,'solid_to_k']=count-1 if count else np.nan
    for name in ('solid_from_k','solid_to_k'):
        cells[name]=cells[name].astype('Int64')
    cells.to_csv(target/'grid_cells.csv',index=False)
    buildings=pd.read_csv(target/'buildings.csv')
    buildings['height_m'] *= factor
    buildings.to_csv(target/'buildings.csv',index=False)
    manifest['files']={name:sha256(target/name) for name in manifest['files']}
    manifest['sensitivity']={'height_factor':factor,'method':'rerasterise actual LoD1 heights; same cell-centre occupancy rule',
        'limitation':'voxel roof quantisation; same footprint and ground-source allocation'}
    (target/'scene_manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    config['paths']['scene_package_dir']=str(target)


def execute(config: dict, case: str, root: Path) -> dict:
    run_id = str(uuid.uuid4())
    out = root / case / run_id
    out.mkdir(parents=True)
    config['run'] = {'run_id': run_id, 'scenario_id': 'wet_may_oct' if case == 'wet' else 'dry_nov_apr', 'model': 'fv'}
    config['transport'].update(stopping_criterion='steady_state', implementation='sparse', max_simulated_s=1800,
        steady_state={'interval_s':30, 'minimum_s':600, 'tolerance':1e-3, 'required_checks':3})
    config['wind']['poisson_method'] = 'cg'
    if case in ('height_low','height_high'):
        height_variant(config,.8 if case=='height_low' else 1.2,out)
    if case == 'k_half':
        for name in ('horizontal_diffusivity_m2_s', 'vertical_diffusivity_m2_s'):
            config['transport'][name] *= .5
    snapshot = out / 'config.yaml'
    snapshot.write_text(yaml.safe_dump(config, sort_keys=False), encoding='utf-8')
    command = [sys.executable,'-m','src.solver','run','--run-id',run_id,'--config',str(snapshot),'--out',str(out)]
    print(json.dumps({'case':case,'run_id':run_id,'event':'started'}),flush=True)
    peak = 0
    start = time.perf_counter()
    with (out / 'progress.jsonl').open('w',encoding='utf-8') as stdout, (out / 'process.stderr').open('w',encoding='utf-8') as stderr:
        process = subprocess.Popen(command,cwd=REPO_ROOT,stdout=stdout,stderr=stderr,
            env={**os.environ, 'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'1'})
        handle = psutil.Process(process.pid)
        last_report = start
        while process.poll() is None:
            try:
                tree = [handle] + handle.children(recursive=True)
                peak = max(peak,sum(p.memory_info().rss for p in tree if p.is_running()))
            except psutil.NoSuchProcess:
                pass
            if time.perf_counter()-last_report > 30:
                print(json.dumps({'case':case,'event':'running','wall_s':round(time.perf_counter()-start),
                                  'peak_rss_mb':round(peak/1024**2,1)}),flush=True)
                last_report = time.perf_counter()
            time.sleep(.1)
    result = {'case':case,'run_id':run_id,'directory':str(out.relative_to(REPO_ROOT)),
              'exit_code':process.returncode,'wall_clock_s':time.perf_counter()-start,'peak_rss_mb':peak/1024**2}
    if (out/'manifest.json').exists():
        manifest=json.loads((out/'manifest.json').read_text(encoding='utf-8'))
        result.update(verification=manifest['verification'],stopping=manifest['stopping'],input_hash=manifest['input_hash'])
    print(json.dumps(result),flush=True)
    return result


def geometry_audit(config: dict) -> dict:
    scene = REPO_ROOT / config['paths']['scene_package_dir']
    manifest=json.loads((scene/'scene_manifest.json').read_text(encoding='utf-8'))
    for name,digest in manifest['files'].items():
        if sha256(scene/name)!=digest:
            raise ValueError(f'scene checksum mismatch: {name}')
    mask=solid_mask(scene/'grid_cells.csv',manifest['grid'])
    with xr.open_dataset(REPO_ROOT/config['paths']['voxel_netcdf']) as voxel:
        mismatch=int(np.count_nonzero(voxel['solid'].values.astype(bool)!=mask)) if 'solid' in voxel else int(np.count_nonzero(voxel['B'].values.astype(bool)!=mask))
    if mismatch:
        raise ValueError(f'scene/voxel occupancy mismatch: {mismatch}')
    buildings=pd.read_csv(scene/'buildings.csv')
    h=raster_height(scene,manifest['grid'],config['voxelization']['rasterization']['all_touched'])
    z=(np.arange(manifest['grid']['nz'])+.5)*manifest['grid']['dz_m']
    rebuilt=z[:,None,None]<h[None,...]
    footprint_difference=int(np.count_nonzero(rebuilt[0]!=mask[0]))
    roof_difference=int(np.count_nonzero(rebuilt!=mask))
    if footprint_difference or np.max(np.abs(rebuilt.sum(axis=0)-mask.sum(axis=0)))>1:
        raise ValueError('LoD1 scene geometry differs from voxel mask beyond roof rounding')
    return {'scene_manifest_sha256':sha256(scene/'scene_manifest.json'),'occupancy_mismatch_voxels':mismatch,
            'independent_footprint_mismatch_cells':footprint_difference,'independent_roof_rounding_voxels':roof_difference,
            'grid':manifest['grid'],'solid_voxels':int(mask.sum()),'buildings':len(buildings),
            'height_sources':buildings.height_source.value_counts().to_dict(),
            'limitation':'LoD1, voxel roof quantisation, flat terrain; not facade reconstruction'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',default='config/project.yaml')
    parser.add_argument('--out',default='artifacts/production-study')
    parser.add_argument('--cases',nargs='+',choices=['dry','wet','k_half','height_low','height_high'],default=['dry','wet','k_half','height_low','height_high'])
    args=parser.parse_args()
    config=yaml.safe_load((REPO_ROOT/args.config).read_text(encoding='utf-8'))
    root=REPO_ROOT/args.out
    root.mkdir(parents=True,exist_ok=True)
    report={'environment':{'platform':platform.platform(),'python':platform.python_version()},
            'geometry':geometry_audit(config),'runs':[]}
    for case in args.cases:
        report['runs'].append(execute(copy.deepcopy(config),case,root))
        (root/'study.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        if report['runs'][-1]['exit_code']:
            raise SystemExit('Production gate failed; inspect manifest/log before proceeding')


if __name__=='__main__':
    main()
