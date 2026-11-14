const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const corridor=require('../viewer-corridor.js');
const analysis=require('../viewer-analysis.js');

test('distance bands must be 1-5 strictly increasing values inside the API range',()=>{
  assert.deepEqual(corridor.parseDistances('10, 25;50'),[10,25,50]);
  assert.deepEqual(corridor.parseDistances(' 0.1 100 '),[0.1,100]);
  for(const bad of ['','10,10','25,10','0,10','10,101','a,10','1,2,3,4,5,6']) assert.throws(()=>corridor.parseDistances(bad),bad);
});
test('request validation guards roads, altitude interval and threshold before any network call',()=>{
  const ok={roadIds:['r1'],distances:'10,25',min:'0',max:'15',threshold:'15',height:250};
  assert.deepEqual(corridor.corridorRequest(ok),{road_ids:['r1'],distances_m:[10,25],z_min_m:0,z_max_m:15,threshold_ug_m3:15});
  assert.throws(()=>corridor.corridorRequest({...ok,roadIds:[]}),/ít nhất một/);
  assert.throws(()=>corridor.corridorRequest({...ok,roadIds:Array.from({length:51},(_,i)=>`r${i}`)}),/tối đa 50/);
  assert.throws(()=>corridor.corridorRequest({...ok,min:'15',max:'15'}),/độ cao/);
  assert.throws(()=>corridor.corridorRequest({...ok,max:'300'}),/độ cao/);
  assert.throws(()=>corridor.corridorRequest({...ok,max:''}),/độ cao/);
  assert.throws(()=>corridor.corridorRequest({...ok,threshold:'-1'}),/Ngưỡng/);
});
const roads=[
  {type:'Feature',geometry:{type:'LineString',coordinates:[[106.7,10.77],[106.701,10.77]]},properties:{source_feature_id:'a',road_class:'primary'}},
  {type:'Feature',geometry:{type:'LineString',coordinates:[[106.7,10.771],[106.701,10.771]]},properties:{source_feature_id:'b',road_class:'residential'}},
];
test('nearest road uses metric distance to segments and respects the click tolerance',()=>{
  // ~11 m north of road a, ~100 m south of road b.
  assert.equal(corridor.nearestRoad(roads,[106.7005,10.7701],15).properties.source_feature_id,'a');
  assert.equal(corridor.nearestRoad(roads,[106.7005,10.7701],5),null);
  assert.equal(corridor.nearestRoad(roads,[106.7005,10.7709],15).properties.source_feature_id,'b');
  assert.match(corridor.roadLabel(roads[0],0),/^Đoạn 1 · đường chính · 10\d m$/);
});
test('band geometry is lifted for display and missing means are drawn as neutral gray',()=>{
  const lifted=corridor.lift({type:'MultiPolygon',coordinates:[[[[0,0],[1,0],[1,1],[0,0]]]]},3);
  assert.deepEqual(lifted.coordinates[0][0][1],[1,0,3]);
  assert.equal(corridor.lift({type:'GeometryCollection',geometries:[]},3),null);
  assert.deepEqual(corridor.bandColor(null,0,1),[140,140,140,70]);
  assert.deepEqual(corridor.bandColor(1,0,1),[112,53,65,150]);
});

function dom() {
  const html=readFileSync(join(__dirname,'../index.html'),'utf8');
  class Element extends EventTarget {
    value='';textContent='';hidden=false;disabled=false;selected=false;style={};children=[];attrs={};
    add(x){this.children.push(x);} append(...xs){this.children.push(...xs);}
    replaceChildren(...xs){this.children=[...xs];} get options(){return this.children;}
    setAttribute(k,v){this.attrs[k]=v;} focus(){} click(){this.dispatchEvent(new Event('click'));}
  }
  const els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  for(const m of html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) els[m[1]].value=m[2];
  els['analysis-view'].value='off';
  const doc=Object.assign(new EventTarget(),{getElementById:id=>els[id],createElement:()=>new Element()});
  const events={};let zoom=true;
  const map={on:(name,fn)=>events[name]=fn,getZoom:()=>18,getCanvas:()=>({style:{}}),
    doubleClickZoom:{isEnabled:()=>zoom,disable:()=>zoom=false,enable:()=>zoom=true}};
  return {html,els,doc,events,map,zoom:()=>zoom};
}
const tick=()=>new Promise(r=>setImmediate(r));
const content=el=>[el.textContent,...el.children.map(content)].join(' ');
const band=(inner,outer,mean)=>({inner_m:inner,outer_m:outer,area_m2:100,geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]},
  air_volume_m3:1000,valid_volume_m3:mean===null?0:1000,coverage:mean===null?0:1,mean_ug_m3:mean,exceedance_volume_m3:mean>15?250:0});
const response=(request)=>({run_id:'base',units:'ug m-3',road_ids:request.road_ids,z_min_m:request.z_min_m,z_max_m:request.z_max_m,
  threshold_ug_m3:request.threshold_ug_m3,bands:[band(0,10,20),band(10,25,8),band(25,50,null)]});
function mounted(api) {
  const ui=dom();
  const ctx={id:'base',z:1,height:250,modified:false,roads,runs:[{id:'base',label:'Mùa khô'},{id:'other',label:'Mùa mưa'}]};
  const instance=analysis.mount({document:ui.doc,map:ui.map,deck:{GeoJsonLayer:class{constructor(p){this.props=p;}},PathLayer:class{constructor(p){this.props=p;}}},
    api,context:()=>ctx,redraw(){},transectModule:null,corridorModule:corridor});
  return {...ui,ctx,instance};
}

test('corridor mode picks roads on the map, queries exact server statistics and renders the band table',async()=>{
  const calls=[];
  const ui=mounted(async(path,options)=>{const body=JSON.parse(options.body);calls.push([path,body]);return response(body);});
  ui.els['analysis-corridor-mode'].click();
  assert.equal(ui.els['corridor-panel'].hidden,false);assert.equal(ui.els['region-panel'].hidden,true);
  assert.equal(ui.els['corridor-road-list'].options.length,2);
  ui.els['corridor-pick'].click();assert.equal(ui.instance.isDrawing(),true);assert.equal(ui.zoom(),false);
  ui.events.click({lngLat:{lng:106.7005,lat:10.7700}});
  assert.equal(ui.els['corridor-road-list'].options[0].selected,true);
  ui.els['corridor-pick-done'].click();assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);
  assert.equal(ui.els['corridor-settings'].hidden,false);
  ui.els['corridor-query'].click();await tick();
  assert.deepEqual(calls,[['/runs/base/road-corridor',{road_ids:['a'],distances_m:[10,25,50],z_min_m:0,z_max_m:15,threshold_ug_m3:15}]]);
  const text=content(ui.els['corridor-result-content']);
  assert.match(text,/0–10/);assert.match(text,/25%/);assert.match(text,/Không có dữ liệu/);
  assert.match(text,/cao hơn dải 10–25 m khoảng 12 µg\/m³/);
  assert.equal(ui.els['corridor-result'].hidden,false);assert.equal(ui.els['corridor-export'].disabled,false);
  const ids=ui.instance.layers(1).map(l=>l.props.id);
  assert.ok(ids.includes('corridor-bands')&&ids.includes('corridor-roads'));
  assert.deepEqual(ui.instance.exportState().corridor.request.road_ids,['a']);
});
test('list selection is keyboard-accessible and stale or illustrated results never reach the panel',async()=>{
  let resolve;const ui=mounted((path,options)=>new Promise(r=>resolve=()=>r(response(JSON.parse(options.body)))));
  ui.els['analysis-corridor-mode'].click();
  ui.els['corridor-road-list'].options[1].selected=true;ui.els['corridor-road-list'].dispatchEvent(new Event('change'));
  ui.els['corridor-query'].click();
  ui.ctx.id='other';ui.instance.sync();resolve();await tick();
  assert.equal(ui.els['corridor-result'].hidden,true);
  ui.ctx.modified=true;ui.instance.sync();
  assert.equal(ui.els['corridor-query'].disabled,true);assert.match(ui.els['corridor-feedback'].textContent,/minh họa/);
});
test('invalid distances are reported in Vietnamese without calling the API, and leaving the mode stops picking',async()=>{
  let calls=0;const ui=mounted(async()=>{calls++;});
  ui.els['analysis-corridor-mode'].click();
  ui.els['corridor-road-list'].options[0].selected=true;ui.els['corridor-road-list'].dispatchEvent(new Event('change'));
  ui.els['corridor-distances'].value='25, 10';ui.els['corridor-query'].click();await tick();
  assert.equal(calls,0);assert.match(ui.els['corridor-feedback'].textContent,/tăng dần/);
  ui.els['corridor-pick'].click();ui.els['analysis-region-mode'].click();
  assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);
  assert.deepEqual(ui.instance.layers(1).filter(l=>l.props.id.startsWith('corridor')),[]);
});
test('server-side road mismatch maps to a recoverable Vietnamese message',async()=>{
  const ui=mounted(async()=>{const e=new Error('Thông tin chưa hợp lệ.');e.status=400;e.kind='validation';e.detail='One or more road IDs are absent from the run scene';throw e;});
  ui.els['analysis-corridor-mode'].click();
  ui.els['corridor-road-list'].options[0].selected=true;ui.els['corridor-road-list'].dispatchEvent(new Event('change'));
  ui.els['corridor-query'].click();await tick();
  assert.match(ui.els['corridor-feedback'].textContent,/không thuộc cảnh/);
  assert.equal(ui.els['corridor-query'].disabled,false);
});
