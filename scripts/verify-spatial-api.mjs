/** Non-mutating production-data smoke. Requires an explicit running local app origin. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const {values}=parseArgs({options:{base:{type:'string'}}});
if(!values.base) throw new Error('Pass --base <running local origin from startup log>');
const origin=new URL(values.base);
assert(['localhost','127.0.0.1'].includes(origin.hostname)&&origin.protocol==='http:','Only local HTTP demo origins allowed');
const require=createRequire(new URL('../app/package.json',import.meta.url));
const {parse}=require('csv-parse/sync');
const report={generated_at:new Date().toISOString(),status:'running',checks:[],base:origin.origin};
async function api(path,options={}) {
  const response=await fetch(new URL('/api'+path,origin),{...options,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});
  assert(response.ok,`HTTP ${response.status} for ${path}: ${(await response.clone().text()).slice(0,250)}`);
  return options.csv ? response.text() : response.json();
}
const mark=name=>report.checks.push({name,status:'pass'});
try {
  const health=await api('/health');assert.equal(health.status,'ok');mark('App/DB/Python health');
  const runs=await api('/runs?status=succeeded&limit=100');
  const allBefore=await api('/runs?limit=100');
  const eligible=runs.filter(r=>r.model==='fv'&&!r.warnings.some(w=>/mock run/.test(w)));
  assert(eligible.length>=2,'Need two existing non-mock FV runs; smoke never creates simulations');
  const baseline=eligible[0],comparison=eligible.find(r=>r.scenario_id!==baseline.scenario_id)||eligible[1];
  report.baseline=baseline.run_id;report.comparison=comparison.run_id;
  const pair=await api(`/runs/${baseline.run_id}/comparison?compare_run_id=${comparison.run_id}&z_m=1`);
  const slices=await Promise.all([baseline,comparison].map(r=>api(`/runs/${r.run_id}/slices?z_m=1`)));
  const maps=slices.map(s=>new Map(s.feature_collection.features.map(f=>[`${f.properties.i}:${f.properties.j}`,f.properties.concentration_ug_m3])));
  for(const feature of pair.feature_collection.features) {
    const p=feature.properties,key=`${p.i}:${p.j}`;
    // pg's real text output is shortest-round-trip decimal, whereas the new
    // double cast exposes the stored float32 value exactly. Compare that value.
    assert.equal(p.baseline_ug_m3,Math.fround(maps[0].get(key)));
    assert.equal(p.comparison_ug_m3,Math.fround(maps[1].get(key)));
    assert(Math.abs(p.delta_ug_m3-(Math.fround(maps[1].get(key))-Math.fround(maps[0].get(key))))<1e-12);
  }
  report.air_cells=pair.stats.air_cells;mark('Production pair vs independent slice API values');
  const self=await api(`/runs/${baseline.run_id}/comparison?compare_run_id=${baseline.run_id}&z_m=1`);
  assert.equal(self.stats.delta.max_ug_m3,0);mark('Production self comparison exactly zero');
  const [area]=await api('/study-areas');const [w,s,e,n]=area.bounds;
  const polygon={type:'Polygon',coordinates:[[[w+(e-w)*.2,s+(n-s)*.2],[w+(e-w)*.8,s+(n-s)*.2],[w+(e-w)*.8,s+(n-s)*.8],[w+(e-w)*.2,s+(n-s)*.8],[w+(e-w)*.2,s+(n-s)*.2]]]};
  const body={polygon,z_min_m:1,z_max_m:15,threshold_ug_m3:15};
  const region=await api(`/runs/${baseline.run_id}/region`,{method:'POST',body:JSON.stringify(body)});
  assert(region.air_volume_m3>0);assert(region.mean_ug_m3>=0);mark('Production region weighted statistics');
  const csv=await api(`/runs/${baseline.run_id}/region/csv`,{method:'POST',body:JSON.stringify(body),csv:true});
  const rows=parse(csv,{columns:true});assert.equal(rows.length,region.layers.length);
  for(let i=0;i<rows.length;i++) {assert.equal(rows[i].run_id,baseline.run_id);assert.equal(Number(rows[i].mean_ug_m3),region.layers[i].mean_ug_m3);}
  const after=await api('/runs?limit=100');assert.deepEqual(after.map(r=>r.run_id),allBefore.map(r=>r.run_id));
  mark('CSV matches JSON; no new runs in any state');report.region={area_m2:region.area_m2,air_volume_m3:region.air_volume_m3,mean_ug_m3:region.mean_ug_m3};
  report.status='pass';
}catch(error){report.status='fail';report.error=error.message;process.exitCode=1;}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(resolve(root,'artifacts'),{recursive:true});
await writeFile(resolve(root,'artifacts/a8-production-api.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
