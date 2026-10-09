"""B6 comparisons and independent analytic cross-check, from verified real runs."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
import numpy as np
import xarray as xr
import yaml
from src.solver import REPO_ROOT, TRANSPORT, sha256

sys.path.insert(0,str(REPO_ROOT/'src'))
from analysis.baseline import gaussian_road_baseline
from analysis.fields import ConcentrationField
from analysis import operators as ops


def diffusion_diagnostics(path, dt, solid, grid, physical):
    """Local 1D modified-equation estimate, not a full 3D diffusion tensor."""
    result={}
    with xr.open_dataset(path) as ds:
        for axis,component,spacing in (('x','u',grid['dx_m']),('y','v',grid['dy_m']),('z','w',grid['dz_m'])):
            speed=np.abs(ds[component].values.astype(float))[~solid]
            cr=speed*dt/spacing
            estimate=.5*speed*spacing*(1-cr)
            k=physical['vertical' if axis=='z' else 'horizontal']
            result[axis]={'physical_K_m2_s':k,'numerical_K_p50_m2_s':float(np.median(estimate)),
                'numerical_K_p95_m2_s':float(np.quantile(estimate,.95)),
                'numerical_K_max_m2_s':float(estimate.max()),'p95_to_physical_ratio':float(np.quantile(estimate,.95)/k),
                'axis_courant_max':float(cr.max())}
    return {'axes':result,'method':'|u_axis|*spacing/2*(1-|u_axis|*dt/spacing)',
            'limitation':'local 1D leading-order estimate; omits multidimensional mixed terms',
            'reference':'https://faculty.washington.edu/rjl/classes/am574w2011/lectures/am574lecture7nup3.pdf'}


def analytic_cross_check():
    """Independent heat-equation identity: variance(t)=variance(0)+2Kt."""
    shape=(3,81,81); dx=2.; k=1.; dt=.1; steps=200
    c=np.zeros(shape); c[1,40,40]=1
    faces=(np.zeros((3,81,82)),np.zeros((3,82,81)),np.zeros((4,81,81)))
    source=np.zeros(shape); ledger={}
    for _ in range(steps):
        c=TRANSPORT.transport_step_faces(c,faces,source,(0,k,k),dt,dz_m=2,dy_m=dx,dx_m=dx,solid=np.zeros(shape,bool),ledger=ledger)
    x=(np.arange(81)-40)*dx
    marginal=c.sum(axis=(0,1))
    variance=float((marginal*x*x).sum()/marginal.sum())
    exact=2*k*dt*steps
    error=abs(variance-exact)/exact
    if error > .01:
        raise ValueError('Analytic diffusion benchmark failed')
    return {'reference':'heat equation fundamental solution; sigma^2=2Kt', 'measured_variance_m2':variance,
        'analytic_variance_m2':exact,'relative_error':error,'tolerance':.01,
        'claim':'verification against independent analytical solution, not field validation'}


def summarize(c,grid,thresholds):
    dz,dy,dx=(grid[n] for n in ('dz_m','dy_m','dx_m'))
    layers=[]
    for height in (1.5,15):
        k=int(height//dz)
        a=c[k]
        layers.append({'requested_z_m':height,'z_center_m':(k+.5)*dz,'k':k,
            'mean_ug_m3':float(np.nanmean(a)),'max_ug_m3':float(np.nanmax(a)),
            'exceedance_area_m2':{name:int(np.count_nonzero(a>t['value']))*dx*dy for name,t in thresholds.items()}})
    # Plume-centroid and vertical mass shares describe 3D even below thresholds.
    clean=np.nan_to_num(c)
    mass=clean.sum()
    return {'layers':layers,'mean_ug_m3':float(np.nanmean(c)),'max_ug_m3':float(np.nanmax(c)),
        'centroid_ijk':[float((clean*np.arange(c.shape[axis]).reshape(tuple(c.shape[axis] if a==axis else 1 for a in range(3)))).sum()/mass) for axis in (2,1,0)],
        'vertical_share':(clean.sum(axis=(1,2))/mass).tolist(),
        'exceedance_volume_m3':{name:int(np.count_nonzero(c>t['value']))*dx*dy*dz for name,t in thresholds.items()}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',default='artifacts/production-study')
    parser.add_argument('--include-root',default='artifacts/production-height-study')
    args=parser.parse_args(); root=REPO_ROOT/args.root
    config=yaml.safe_load((REPO_ROOT/'config/project.yaml').read_text(encoding='utf-8'))
    study=json.loads((root/'study.json').read_text(encoding='utf-8'))
    measurements={item['run_id']:item for item in study['runs']}
    thresholds=config['analysis']['thresholds_ug_m3']
    reports=[]; by_case={}
    paths=list(root.glob('*/*/manifest.json'))+list((REPO_ROOT/args.include_root).glob('*/*/manifest.json'))
    for path in sorted(paths):
        manifest=json.loads(path.read_text(encoding='utf-8'))
        if manifest['verification']['status']!='pass' or manifest['stopping']['criterion']!='steady_state':
            continue
        out=path.parent; case=out.parent.name; grid=manifest['grid']
        with xr.open_dataset(out/'concentration.nc') as ds:
            c=ds.C.values.astype(float)
            z,y,x=(ds[n].values.copy() for n in ('z','y','x'))
        result={'case':case,'run_id':manifest['run_id'],'input_hash':manifest['input_hash'],
            'manifest_sha256':sha256(path),'grid':grid,'summary':summarize(c,grid,thresholds),
            'stopping':manifest['stopping'],'verification':manifest['verification'],
            'metrics':json.loads((out/'metrics.json').read_text(encoding='utf-8'))}
        result['runtime_measurement']=measurements.get(manifest['run_id'])
        by_case[case]=(c,result); reports.append(result)
        with xr.open_dataset(REPO_ROOT/config['paths']['emission_source_transport_netcdf']) as emission:
            source=emission.S.values.astype(float)
        source_xy=[float((source*np.arange(source.shape[axis]).reshape(tuple(source.shape[axis] if a==axis else 1 for a in range(3)))).sum()/source.sum()) for axis in (2,1)]
        displacement=np.array(result['summary']['centroid_ijk'][:2])-source_xy
        displacement *= [grid['dx_m'],grid['dy_m']]
        direction=np.deg2rad(manifest['scenario']['wind_from_deg'])
        toward=np.array([-np.sin(direction),-np.cos(direction)])
        result['plume_direction']={'source_centroid_ij':source_xy,'displacement_xy_m':displacement.tolist(),
            'cosine_to_background_downwind':float(displacement@toward/max(np.linalg.norm(displacement),np.finfo(float).tiny)),
            'interpretation':'diagnostic bulk plume displacement; buildings can deflect local flow'}
        result['numerical_diffusion']=diffusion_diagnostics(out/'wind.nc',result['metrics']['dt_s'],np.isnan(c),grid,
                                                           result['metrics']['physical_diffusivity_m2_s'])
        if case in ('dry','wet'):
            scenario=config['meteorology']['scenarios'][manifest['scenario']['id']]
            field=ConcentrationField(c,np.isnan(c),z,y,x,grid['crs'],{})
            gaussian=gaussian_road_baseline(str(REPO_ROOT/config['paths']['emission_source_transport_netcdf']),field,
                wind_from_deg=scenario['direction_from_deg'],wind_speed_m_s=scenario['speed_m_s'],
                reference_height_m=config['wind']['reference_height_m'],stability=scenario.get('stability','D'))
            result['gaussian_summary']=summarize(gaussian,grid,thresholds)
            valid=np.isfinite(c)&np.isfinite(gaussian)
            result['fv_vs_gaussian']={'mae_ug_m3':float(np.mean(np.abs(c[valid]-gaussian[valid]))),
                'rmse_ug_m3':float(np.sqrt(np.mean((c[valid]-gaussian[valid])**2))),
                'interpretation':'Different wind/turbulent diffusion assumptions; neither is observed ground truth'}
            xr.Dataset({'C':(('z','y','x'),gaussian.astype(np.float32))},coords={'z':z,'y':y,'x':x},
                attrs={'model':'gaussian','source_sha256':sha256(REPO_ROOT/config['paths']['emission_source_transport_netcdf'])}).to_netcdf(out/'gaussian-comparison.nc')
    if not {'dry','wet','k_half','height_low','height_high'}.issubset(by_case):
        raise ValueError('Need all five verified production cases before B6 acceptance')
    reference=by_case['dry'][1]['summary']
    sensitivity=[]
    for case in ('k_half','height_low','height_high'):
        summary=by_case[case][1]['summary']
        sensitivity.append({'case':case,'run_id':by_case[case][1]['run_id'],
            'mean_change_pct':100*(summary['mean_ug_m3']/reference['mean_ug_m3']-1),
            'max_change_pct':100*(summary['max_ug_m3']/reference['max_ug_m3']-1)})
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(1,2,figsize=(9,4),constrained_layout=True)
    for case in ('dry','wet'):
        c,result=by_case[case]; z=(np.arange(c.shape[0])+.5)*result['grid']['dz_m']
        axes[0].plot(np.nanmean(c,axis=(1,2)),z,label=case)
        axes[1].plot(np.nanmax(c,axis=(1,2)),z,label=case)
    for ax,title in zip(axes,('Layer mean','Layer maximum')):
        ax.set(xlabel='PM2.5 (ug/m3)',ylabel='Height (m)',title=title); ax.legend(); ax.grid(alpha=.2)
    fig.savefig(root/'vertical-comparison.png',dpi=300); plt.close(fig)
    fig,ax=plt.subplots(figsize=(6,4),constrained_layout=True)
    for case in ('dry','wet'):
        history=by_case[case][1]['metrics']['convergence_history']
        ax.semilogy([row['simulated_s'] for row in history],[max(row['relative_l1_change'],1e-16) for row in history],label=case)
    ax.axhline(1e-3,color='#99534a',linestyle='--',label='tolerance')
    ax.set(xlabel='Simulated time (s)',ylabel='Relative L1 change over 30 s',title='Steady-state convergence')
    ax.legend(); ax.grid(alpha=.2)
    fig.savefig(root/'convergence.png',dpi=300); plt.close(fig)
    from matplotlib.colors import LogNorm
    fig,axes=plt.subplots(2,2,figsize=(9,8),constrained_layout=True)
    maximum=max(by_case[case][1]['summary']['max_ug_m3'] for case in ('dry','wet'))
    for row,case in enumerate(('dry','wet')):
        c,result=by_case[case]
        for col,k in enumerate((0,int(15//result['grid']['dz_m']))):
            im=axes[row,col].imshow(c[k],origin='lower',cmap='BuGn',norm=LogNorm(vmin=maximum/1e5,vmax=maximum))
            axes[row,col].set(title=f'{case} | z={(k+.5)*result["grid"]["dz_m"]:g} m',xlabel='i (east)',ylabel='j (north)')
    fig.colorbar(im,ax=axes.ravel().tolist(),label='PM2.5 (ug/m3, log scale)')
    fig.savefig(root/'height-slices.png',dpi=300); plt.close(fig)
    import pandas as pd
    from shapely import wkt
    scene=REPO_ROOT/config['paths']['scene_package_dir']; buildings=pd.read_csv(scene/'buildings.csv')
    c,result=by_case['dry']; grid=result['grid']
    fig,ax=plt.subplots(figsize=(6,6),constrained_layout=True)
    extent=[grid['origin_x_m'],grid['origin_x_m']+grid['nx']*grid['dx_m'],grid['origin_y_m'],grid['origin_y_m']+grid['ny']*grid['dy_m']]
    ax.imshow(np.isnan(c[0]),origin='lower',extent=extent,cmap='Greys',alpha=.45)
    for geometry in buildings.wkt.map(wkt.loads):
        for polygon in ([geometry] if geometry.geom_type=='Polygon' else geometry.geoms):
            x,y=polygon.exterior.xy; ax.plot(x,y,color='#4f6b5d',linewidth=.6)
    ax.set(xlim=extent[:2],ylim=extent[2:],xlabel='UTM easting (m)',ylabel='UTM northing (m)',title='LoD1 footprints / ground voxel occupancy')
    ax.ticklabel_format(useOffset=False,style='plain')
    fig.savefig(root/'geometry-overlay.png',dpi=300); plt.close(fig)
    model_files=['src/solver.py','src/03_transport.py','src/wind/core.py','src/convergence.py','src/fv_operator.py','src/wind/web_vectors.py']
    report={'runs':reports,'sensitivity':sensitivity,'analytic_cross_check':analytic_cross_check(),
            'geometry_audit':study['geometry'],'environment':study['environment'],
            'model_source_sha256':{name:sha256(REPO_ROOT/name) for name in model_files},
            'limitations':['EDGAR annual regional emission proxy, not traffic counts','LoD1/flat terrain',
            'Gaussian is a comparison model, not validation','height sensitivity rerasterises LoD1 heights; cell-centre quantisation'],
            'source_sha256':sha256(REPO_ROOT/config['paths']['emission_source_transport_netcdf'])}
    (root/'analysis.json').write_text(json.dumps(report,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'runs':len(reports),'sensitivity':sensitivity,'analytic_cross_check':report['analytic_cross_check']}))


if __name__=='__main__':
    main()
