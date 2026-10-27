const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const analysis=require('../viewer-analysis.js');
const transect=require('../viewer-transect.js');

const result={run_id:'base',length_m:10,z_min_m:0,z_max_m:3,units:'ug m-3',
  layers:[{k:0,z_center_m:1,overlap_min_m:0,overlap_max_m:2},{k:1,z_center_m:3,overlap_min_m:2,overlap_max_m:3}],
  samples:[{distance_m:0,i:0,j:1,cells:[{k:0,status:'air',concentration_ug_m3:0},{k:1,status:'no_data',concentration_ug_m3:null}]},
    {distance_m:10,i:1,j:1,cells:[{k:0,status:'solid',concentration_ug_m3:null},{k:1,status:'air',concentration_ug_m3:11}]}]};
function setup(api=async()=>result) {
  const html=readFileSync(join(__dirname,'../index.html'),'utf8');
  const paints=[];
  const painter={setTransform(){},clearRect(){},fillRect(){paints.push(this.fillStyle);},strokeRect(){},fillText(){}};
  class Element extends EventTarget {
    value='';hidden=false;disabled=false;textContent='';children=[];attrs={};style={};
    append(...nodes){this.children.push(...nodes);}add(x){this.children.push(x);}replaceChildren(...nodes){this.children=nodes;}
    get options(){return this.children;}setAttribute(k,v){this.attrs[k]=v;}
    click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}focus(){this.focused=true;}
    getBoundingClientRect(){return {left:0,top:0,width:600,height:250};}getContext(){return painter;}
  }
  const els=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  for(const [id,v] of Object.entries({'analysis-view':'off','region-min':'0','region-max':'15','region-threshold':'15','transect-min':'0','transect-max':'3'}))els[id].value=v;
  const doc=Object.assign(new EventTarget(),{getElementById:id=>els[id],createElement:()=>new Element()});
  const events={};let zoom=true;
  const map={on:(name,fn)=>events[name]=fn,getCanvas:()=>({style:{}}),doubleClickZoom:{isEnabled:()=>zoom,enable:()=>zoom=true,disable:()=>zoom=false}};
  const ctx={id:'base',z:1,height:100,modified:false,runs:[{id:'base',label:'Mùa khô'},{id:'other',label:'Mùa mưa'}]};
  const instance=analysis.mount({document:doc,map,deck:{PathLayer:class {constructor(options){Object.assign(this,options);}}},api,context:()=>ctx,redraw(){},transectModule:transect});
  const button=(name,scope)=>{
    const markup=scope?html.slice(html.indexOf(`id="${scope}"`)).split('</section>')[0]:html;
    const found=[...markup.matchAll(/<button[^>]*id="([^"]+)"[^>]*>([^<]+)<\/button>/g)].find(m=>m[2]===name);
    assert.ok(found,`button ${name}`);return els[found[1]];
  };
  const point=(lng,lat)=>events.click({lngLat:{lng,lat}});
  function choose(){button('Mặt cắt đứng').click();button('Vẽ tuyến').click();point(106.70,10.77);point(106.71,10.78);button('Hoàn tất tuyến').click();}
  return {els,ctx,instance,doc,button,point,choose,paints,zoom:()=>zoom};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function key(target,value){const e=new Event('keydown',{cancelable:true});Object.defineProperty(e,'key',{value});target.dispatchEvent(e);}

test('drawing shares the map picking guard, only enables finish at two points and restores zoom on Escape',()=>{
  const ui=setup();ui.button('Mặt cắt đứng').click();ui.button('Vẽ tuyến').click();
  assert.equal(ui.instance.isDrawing(),true);assert.equal(ui.zoom(),false);assert.equal(ui.button('Hoàn tất tuyến').disabled,true);
  ui.point(106.7,10.77);ui.point(106.7,10.77);assert.equal(ui.button('Hoàn tất tuyến').disabled,true);
  ui.point(106.71,10.78);assert.equal(ui.button('Hoàn tất tuyến').disabled,false);
  key(ui.doc,'Escape');assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);assert.equal(ui.els['transect-settings'].hidden,true);
});
test('query creates a large readable result and draws distinct zero, solid and missing states',async()=>{
  const calls=[],ui=setup(async(path,options)=>{calls.push([path,JSON.parse(options.body)]);return result;});
  ui.choose();ui.button('Xem mặt cắt').click();await tick();
  assert.equal(calls[0][0],'/runs/base/transect');assert.equal(calls[0][1].line.type,'LineString');assert.equal(calls[0][1].z_max_m,3);
  assert.equal(ui.els['transect-result'].hidden,false);assert.match(ui.els['transect-context'].textContent,/Mùa khô.*10 m.*0–3 m/);
  assert.match(ui.els['transect-reading'].textContent,/0 µg\/m³/);
  assert.ok(ui.paints.includes('#929fa9'));assert.ok(ui.paints.includes('#ffffff'));assert.ok(ui.paints.some(v=>/^rgb/.test(v)));
  assert.equal(ui.els['transect-empty'].hidden,true);assert.equal(ui.els['transect-export'].disabled,false);
  assert.ok(ui.instance.layers(3).some(l=>l.id==='analysis-transect-line'));
});
test('keyboard and clicking the plot read exact cells without interpolation or treating no-data as zero',async()=>{
  const ui=setup();ui.choose();ui.button('Xem mặt cắt').click();await tick();
  key(ui.els['transect-chart'],'ArrowUp');assert.match(ui.els['transect-reading'].textContent,/Không có dữ liệu/);
  key(ui.els['transect-chart'],'ArrowRight');assert.match(ui.els['transect-reading'].textContent,/11 µg\/m³/);
  key(ui.els['transect-chart'],'ArrowDown');assert.match(ui.els['transect-reading'].textContent,/Tòa nhà/);
  const event=new Event('click');Object.defineProperties(event,{clientX:{value:60},clientY:{value:200}});ui.els['transect-chart'].dispatchEvent(event);
  assert.match(ui.els['transect-reading'].textContent,/0 µg\/m³/);
});
test('a later response cannot replace a changed run, height, line or illustration state',async()=>{
  for(const change of [u=>{u.ctx.id='other';u.instance.sync();},u=>{u.els['transect-max'].value='5';u.els['transect-max'].dispatchEvent(new Event('input'));},u=>u.button('Xóa tuyến').click(),u=>{u.ctx.modified=true;u.instance.sync();}]){
    let resolve;const ui=setup(()=>new Promise(r=>resolve=r));ui.choose();ui.button('Xem mặt cắt').click();
    change(ui);
    resolve(result);await tick();assert.equal(ui.els['transect-result'].hidden,true);assert.equal(ui.els['transect-export'].disabled,true);
  }
});
test('switching analysis tools cancels drawing, and leaving transect hides the floating result',async()=>{
  const ui=setup();ui.button('Mặt cắt đứng').click();ui.button('Vẽ tuyến').click();ui.point(106.7,10.77);
  ui.button('Theo vùng').click();assert.equal(ui.instance.isDrawing(),false);assert.equal(ui.zoom(),true);
  ui.choose();ui.button('Xem mặt cắt').click();await tick();ui.button('So sánh kết quả').click();
  assert.equal(ui.els['transect-result'].hidden,true);assert.equal(ui.els['transect-panel'].hidden,true);
  ui.button('Mặt cắt đứng').click();ui.button('Xem mặt cắt').click();await tick();
  assert.equal(ui.els['transect-result'].hidden,false);ui.instance.onToolChange('simulation-options');
  assert.equal(ui.els['transect-result'].hidden,true);
});
test('empty result is explained and zero is not mistaken for no air',async()=>{
  const empty={...result,samples:result.samples.map(s=>({...s,cells:s.cells.map(c=>({...c,status:'no_data',concentration_ug_m3:null}))}))};
  const ui=setup(async()=>empty);ui.choose();ui.button('Xem mặt cắt').click();await tick();
  assert.equal(ui.els['transect-empty'].hidden,false);assert.match(ui.els['transect-empty'].textContent,/không có nghĩa.*bằng 0/);
});
test('errors are understandable in Vietnamese, support retry, and invalid heights or illustration never query',async()=>{
  let calls=0;const ui=setup(async()=>{calls++;throw {status:400,message:'Tuyến phải nằm hoàn toàn trong khu vực mô phỏng.'};});
  ui.choose();ui.button('Xem mặt cắt').click();await tick();assert.match(ui.els['transect-feedback'].textContent,/Tuyến phải/);
  assert.equal(ui.button('Xem mặt cắt').disabled,false);ui.button('Xem mặt cắt').click();await tick();assert.equal(calls,2);
  ui.els['transect-max'].value='-1';ui.els['transect-max'].dispatchEvent(new Event('input'));ui.button('Xem mặt cắt').click();await tick();assert.equal(calls,2);
  ui.ctx.modified=true;ui.instance.sync();assert.equal(ui.button('Xem mặt cắt').disabled,true);
});
test('CSV reuses the successful request and stale downloads never produce a link',async()=>{
  const calls=[];let resolve;
  const ui=setup(async(path,options)=>{calls.push([path,JSON.parse(options.body)]);if(path.endsWith('/csv'))return new Promise(r=>resolve=r);return result;});
  ui.choose();ui.button('Xem mặt cắt').click();await tick();ui.button('Tải CSV','transect-result').click();
  assert.equal(calls[1][0],'/runs/base/transect/csv');assert.deepEqual(calls[0][1],calls[1][1]);
  ui.ctx.id='other';ui.instance.sync();resolve('run_id,value\nbase,0\n');await tick();assert.equal(ui.els['transect-result'].hidden,true);
});
