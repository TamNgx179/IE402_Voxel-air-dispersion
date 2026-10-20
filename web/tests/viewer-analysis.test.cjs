const {test}=require('node:test');
const assert=require('node:assert/strict');
const {latestTask,color,closePolygon}=require('../viewer-analysis.js');
const {request}=require('../viewer-api.js');
const {mount}=require('../viewer-analysis.js');
const {polygonShape}=require('../viewer-analysis.js');
const {regionSummary}=require('../viewer-analysis.js');
const {analysisError}=require('../viewer-analysis.js');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

test('signed delta colors are symmetric around a neutral zero and do not hide zero values',()=>{
  assert.deepEqual(color(0,-5,5,true),[245,242,232,205]);
  assert.deepEqual(color(-5,-5,5,true),[75,111,140,205]);
  assert.deepEqual(color(5,-5,5,true),[157,83,78,205]);
  assert.equal(color(NaN,0,1)[3],0);assert.equal(color(0,0,0)[3],205);
  assert.deepEqual(color(2,0,10),color(2,0,10));
});
test('pointer polygon closes without mutating points and rejects undersized/invalid input',()=>{
  const points=[[106,10],[107,10],[107,11]];
  const polygon=closePolygon(points);
  assert.equal(polygon.coordinates[0].length,4);assert.equal(points.length,3);
  assert.deepEqual(polygon.coordinates[0][0],polygon.coordinates[0].at(-1));
  assert.throws(()=>closePolygon(points.slice(0,2)));assert.throws(()=>closePolygon([[NaN,0],[0,1],[1,0]]));
});
test('malformed keyboard GeoJSON cannot crash a map layer before server validation',()=>{
  for(const coordinates of [[],[null],['abc'],[[[106,10],[106,11],[107,11]]],[[[190,10],[190,11],[191,11],[190,10]]],Array(21).fill([[106,10],[106,11],[107,11],[106,10]])]) {
    assert.throws(()=>polygonShape({type:'Polygon',coordinates}));
  }
  assert.throws(()=>polygonShape({type:'Polygon',coordinates:[Array(501).fill([106,10])]}));
});
test('late success and late error cannot overwrite a new analysis selection',async()=>{
  const task=latestTask(),values=[];let resolve,reject;
  const old=task.run(()=>new Promise(r=>resolve=r),data=>values.push(data),e=>values.push(e));
  await task.run(()=>Promise.resolve('new'),data=>values.push(data),()=>{});
  resolve('old');await old;assert.deepEqual(values,['new']);
  const failed=task.run(()=>new Promise((_,r)=>reject=r),()=>{},e=>values.push(e.message));
  task.invalidate();reject(new Error('late failure'));await failed;assert.deepEqual(values,['new']);
});
test('read-only CSV preserves raw text while error responses retain structured status',async()=>{
  const text='run_id,mean\r\na,0\r\n';let calls=0;
  assert.equal(await request(async()=>{calls++;return new Response(text);},'/api/runs/a/region/csv',{method:'POST',responseType:'text'}),text);
  assert.equal(calls,1);
  await assert.rejects(request(async()=>new Response('{"message":"invalid polygon"}',{status:400}),'/api/runs/a/region/csv',{responseType:'text'}),e=>e.kind==='validation'&&e.message==='invalid polygon');
});

// Lightweight DOM boundary for state/event regression, not a browser/layout audit.
function controls(api) {
  const html=readFileSync(join(__dirname,'../index.html'),'utf8');
  class Element extends EventTarget {
    value='';textContent='';hidden=false;disabled=false;style={};children=[];attrs={};
    add(x){this.children.push(x);} append(...xs){this.children.push(...xs);}
    replaceChildren(...xs){this.children=[...xs];} get options(){return this.children;}
    setAttribute(k,v){this.attrs[k]=v;} focus(){} click(){this.dispatchEvent(new Event('click'));}
  }
  const els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  for(const [id,v] of Object.entries({'analysis-view':'off','region-min':'0','region-max':'15','region-threshold':'15'})) els[id].value=v;
  const doc=Object.assign(new EventTarget(),{getElementById:id=>els[id],createElement:()=>new Element()});
  const events={};let zoom=true;
  const map={on:(name,fn)=>events[name]=fn,getCanvas:()=>({style:{}}),doubleClickZoom:{isEnabled:()=>zoom,disable:()=>zoom=false,enable:()=>zoom=true}};
  const ctx={id:'base',z:1,height:100,modified:false,runs:[{id:'base',label:'Mùa khô'},{id:'other',label:'Mùa mưa'}]};
  const instance=mount({document:doc,map,deck:{},api,context:()=>ctx,redraw(){}});
  const namedLabel=text=>{
    const match=[...html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([^<]+)/g)].find(m=>m[2]===text);
    assert.ok(match,`label ${text}`);return els[match[1]];
  };
  const button=text=>{
    const match=[...html.matchAll(/<button[^>]*id="([^"]+)"[^>]*>([^<]+)<\/button>/g)].find(m=>m[2]===text);
    assert.ok(match,`button ${text}`);return els[match[1]];
  };
  const change=(el,value)=>{el.value=value;el.dispatchEvent(new Event('change'));};
  return {els,ctx,instance,events,doc,button,namedLabel,change,zoom:()=>zoom};
}
const tick=()=>new Promise(r=>setImmediate(r));
const content=el=>[el.textContent,...el.children.map(content)].join(' ');
test('drawn region queries exact baseline and clears stale region on run switch',async()=>{
  const calls=[];let resolve;
  const ui=controls((path,options)=>{calls.push([path,JSON.parse(options.body)]);return new Promise(r=>resolve=r);});
  chooseRegion(ui);ui.button('Phân tích vùng').click();
  assert.equal(calls[0][0],'/runs/base/region');assert.equal(calls[0][1].z_max_m,15);
  ui.ctx.id='other';ui.instance.sync();
  resolve({mean_ug_m3:999,layers:[]});await tick();
  assert.equal(ui.els['region-result'].hidden,true);assert.equal(ui.button('Tải CSV').disabled,true);
});
test('drawing requires finish, preserves zoom setting, supports cancel and never creates a simulation',async()=>{
  const calls=[];
  const ui=controls(async(path)=>{calls.push(path);return {z_min_m:0,z_max_m:15,air_volume_m3:0,mean_ug_m3:null,max_ug_m3:null,threshold_ug_m3:15,exceedance_volume_m3:0,layers:[]};});
  ui.button('Vẽ vùng').click();assert.equal(ui.instance.isDrawing(),true);assert.equal(ui.zoom(),false);
  for(const [lng,lat] of [[106,10],[106.1,10],[106,10.1]]) ui.events.click({lngLat:{lng,lat}});
  ui.button('Hoàn tất').click();assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);
  ui.button('Phân tích vùng').click();await tick();
  assert.match(content(ui.els['region-result-content']),/Không có dữ liệu/);
  assert.deepEqual(calls,['/runs/base/region']);
  ui.button('Vẽ vùng').click();const escape=new Event('keydown');Object.defineProperty(escape,'key',{value:'Escape'});ui.doc.dispatchEvent(escape);
  assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);
});
test('changing region inputs invalidates export and display multipliers refuse exact analysis',async()=>{
  let calls=0;const ui=controls(async()=>{calls++;throw new Error('should not send');});
  chooseRegion(ui);ui.ctx.modified=true;ui.instance.sync();ui.button('Phân tích vùng').click();await tick();
  assert.equal(calls,0);assert.match(ui.els['region-feedback'].textContent,/hệ số/);
  ui.namedLabel('Đến độ cao (m)').value='10';ui.namedLabel('Đến độ cao (m)').dispatchEvent(new Event('input'));
  assert.equal(ui.els['region-result'].hidden,true);assert.equal(ui.button('Tải CSV').disabled,true);
});
test('comparison error clears busy state and keeps a recoverable labelled action',async()=>{
  let calls=0;const ui=controls(async()=>{calls++;throw new Error('Không tương thích lưới');});
  ui.change(ui.namedLabel('Kết quả so sánh'),'other');ui.change(ui.namedLabel('Hiển thị trên bản đồ'),'delta');
  ui.button('Cập nhật so sánh').click();await tick();
  assert.ok(calls>0);assert.equal(ui.els['comparison-note'].attrs['aria-busy'],'false');
  assert.match(ui.els['comparison-note'].textContent,/Không tương thích/);
  ui.change(ui.namedLabel('Hiển thị trên bản đồ'),'off');
});

const regionData={z_min_m:0,z_max_m:15,area_m2:100,air_volume_m3:1000,mean_ug_m3:.12494,max_ug_m3:.49481,threshold_ug_m3:15,exceedance_volume_m3:0,layers:[{z_center_m:1,mean_ug_m3:.12,max_ug_m3:.49},{z_center_m:3,mean_ug_m3:.1,max_ug_m3:.4}]};
function chooseRegion(ui) {
  ui.button('Vẽ vùng').click();
  for(const [lng,lat] of [[106,10],[106.1,10],[106,10.1]]) ui.events.click({lngLat:{lng,lat}});
  ui.button('Hoàn tất').click();
}
test('region flow shows only relevant actions, guards finish until three points and restores selection on cancel',()=>{
  const ui=controls(async()=>regionData),e=ui.els;
  assert.equal(e['region-settings'].hidden,true);assert.equal(e['region-clear'].hidden,true);
  assert.equal(e['region-export'].hidden,true);assert.equal(e['region-finish'].hidden,true);
  chooseRegion(ui);assert.equal(e['region-settings'].hidden,false);
  ui.button('Vẽ vùng').click();
  assert.equal(e['region-draw'].hidden,true);assert.equal(e['region-clear'].hidden,true);
  assert.equal(e['region-settings'].hidden,true);
  assert.equal(e['region-finish'].disabled,true);assert.equal(e['region-cancel'].hidden,false);
  for(const [lng,lat] of [[106,10],[106.1,10],[106,10.1]]) ui.events.click({lngLat:{lng,lat}});
  assert.equal(e['region-finish'].disabled,false);
  ui.button('Hủy vẽ').click();assert.equal(ui.instance.isDrawing(),false);
  assert.equal(e['region-settings'].hidden,false);assert.equal(e['region-clear'].hidden,false);
  ui.button('Xóa vùng').click();assert.equal(e['region-settings'].hidden,true);assert.equal(e['region-draw'].hidden,false);
});

test('analysis selection separates forms and exits drawing without leaving map gestures locked',()=>{
  const ui=controls(async()=>regionData);
  ui.button('Vẽ vùng').click();ui.button('So sánh kết quả').click();
  assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);
  assert.equal(ui.els['region-panel'].hidden,true);assert.equal(ui.els['compare-panel'].hidden,false);
  ui.els['analysis-view'].value='delta';ui.button('Theo vùng').click();
  assert.equal(ui.els['compare-panel'].hidden,true);assert.equal(ui.els['analysis-view'].value,'off');
});

test('region results show metric values, units, interpretation and per-layer table before CSV appears',async()=>{
  let resolve,calls=0;
  const ui=controls(()=>{calls++;return new Promise(r=>resolve=r);});chooseRegion(ui);
  ui.button('Phân tích vùng').click();ui.button('Phân tích vùng').click();assert.equal(calls,1);
  assert.equal(ui.els['region-query'].disabled,true);assert.equal(ui.els['region-export'].hidden,true);
  resolve(regionData);await tick();
  const text=content(ui.els['region-result-content']);
  for(const value of ['Mùa khô','Nồng độ trung bình','0,12494','µg/m³','Nồng độ cao nhất','Thể tích vượt ngưỡng','Không ghi nhận','Nồng độ theo độ cao','Tâm tầng (m)']) assert.ok(text.includes(value),value);
  assert.equal(ui.els['region-result'].hidden,false);assert.equal(ui.els['region-export'].hidden,false);assert.equal(ui.els['region-query'].disabled,false);
  ui.namedLabel('Đến độ cao (m)').value='20';ui.namedLabel('Đến độ cao (m)').dispatchEvent(new Event('input'));
  assert.equal(ui.els['region-result'].hidden,true);assert.equal(ui.els['region-export'].hidden,true);
});

test('validation and API failure keep selection and a retryable action without stale output',async()=>{
  let calls=0;const ui=controls(async()=>{calls++;throw new Error('Mất kết nối');});chooseRegion(ui);
  ui.namedLabel('Đến độ cao (m)').value='0';ui.button('Phân tích vùng').click();await tick();
  assert.equal(calls,0);assert.match(ui.els['region-feedback'].textContent,/khoảng độ cao/);
  ui.namedLabel('Đến độ cao (m)').value='15';ui.button('Phân tích vùng').click();await tick();
  assert.equal(calls,1);assert.match(ui.els['region-feedback'].textContent,/Mất kết nối/);
  assert.equal(ui.els['region-settings'].hidden,false);assert.equal(ui.els['region-query'].disabled,false);
  assert.equal(ui.els['region-result'].hidden,true);assert.equal(ui.els['region-export'].hidden,true);
});

test('result interpretation distinguishes zero, missing air and fractional exceedance',()=>{
  const ui=controls(async()=>regionData),box=ui.els['region-result-content'];
  regionSummary(ui.doc,box,{...regionData,mean_ug_m3:0,max_ug_m3:0},'Gốc');
  assert.match(content(box),/Nồng độ trung bình 0 µg\/m³/);
  regionSummary(ui.doc,box,{...regionData,air_volume_m3:0,mean_ug_m3:null,max_ug_m3:null},'Gốc');
  assert.match(content(box),/Không có dữ liệu không đồng nghĩa với nồng độ bằng 0/);
  regionSummary(ui.doc,box,{...regionData,exceedance_volume_m3:250},'Gốc');
  assert.match(content(box),/25% thể tích khí vượt/);
});

test('CSV failure leaves computed metrics intact and export available for retry',async()=>{
  const ui=controls(async(path)=>{if(path.endsWith('/csv'))throw new Error('Offline');return regionData;});chooseRegion(ui);
  ui.button('Phân tích vùng').click();await tick();
  const before=content(ui.els['region-result-content']);ui.button('Tải CSV').click();await tick();
  assert.equal(content(ui.els['region-result-content']),before);
  assert.match(ui.els['region-feedback'].textContent,/Chưa tải được bảng số liệu\. Mất kết nối/);
  assert.equal(ui.els['region-export'].disabled,false);assert.equal(ui.els['region-result'].hidden,false);
});

test('comparison auto-selects difference, explains direction and hides redundant retry after success',async()=>{
  const ui=controls(async()=>({z_center_m:1,feature_collection:{features:[]},stats:{air_cells:3,baseline:{mean_ug_m3:1},comparison:{mean_ug_m3:2},delta:{mean_ug_m3:1,min_ug_m3:0,max_ug_m3:2}}}));
  ui.change(ui.namedLabel('Kết quả so sánh'),'other');
  assert.equal(ui.els['analysis-view'].value,'delta');
  await new Promise(resolve=>setTimeout(resolve,210));
  assert.match(content(ui.els['comparison-result']),/cao hơn gốc 1 µg\/m³/);
  assert.match(content(ui.els['comparison-result']),/Chênh lệch trung bình/);
  assert.equal(ui.els['comparison-retry'].hidden,true);
});

test('self-comparison legend formats zero without a misleading negative-zero label',async()=>{
  const ui=controls(async()=>({z_center_m:1,feature_collection:{features:[]},stats:{air_cells:3,baseline:{mean_ug_m3:1},comparison:{mean_ug_m3:1},delta:{mean_ug_m3:0,min_ug_m3:0,max_ug_m3:0}}}));
  ui.change(ui.namedLabel('Kết quả so sánh'),'base');
  await new Promise(resolve=>setTimeout(resolve,210));
  assert.match(content(ui.els['comparison-result']),/ΔC: 0 → 0 → 0/);
  assert.doesNotMatch(content(ui.els['comparison-result']),/-0/);
});


test('analysis errors translate server validation into actionable Vietnamese without raw English',()=>{
  const cases=[
    ['Polygon must be valid with positive area (no self intersections)',/các cạnh cắt nhau/],
    ['Polygon must be fully inside the study area',/bên trong khu vực/],
    ['Require 0 <= z_min_m < z_max_m <= domain height',/Khoảng độ cao/],
    ['Runs must share study area, CRS, grid, scene and model',/không cùng lưới/],
    ['unknown validation from database',/Thông tin phân tích chưa hợp lệ/],
  ];
  for(const [message,expected] of cases) {
    const translated=analysisError({message,status:400,kind:'validation'});
    assert.match(translated,expected);assert.doesNotMatch(translated,/Polygon|must|study area|database|CRS/);
  }
  assert.match(analysisError({status:500,message:'SQL internal detail'}),/Hệ thống chưa xử lý/);
  assert.match(analysisError({kind:'timeout'}),/quá nhiều thời gian/);
});

test('invalid drawn-region response is entirely Vietnamese and leaves redraw/retry usable',async()=>{
  const ui=controls(async()=>{throw Object.assign(new Error('Polygon must be valid with positive area (no self intersections)'),{status:400,kind:'validation'});});
  chooseRegion(ui);ui.button('Phân tích vùng').click();await tick();
  assert.match(ui.els['region-feedback'].textContent,/Hãy vẽ lại/);
  assert.doesNotMatch(ui.els['region-feedback'].textContent,/Polygon|positive area|self intersections/);
  assert.equal(ui.els['region-draw'].disabled,false);assert.equal(ui.els['region-query'].disabled,false);
  assert.equal(ui.els['region-result'].hidden,true);
});
