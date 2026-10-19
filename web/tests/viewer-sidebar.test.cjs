const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {mount,heightMarks,milestones}=require('../viewer-sidebar.js');

class Element extends EventTarget {
  hidden=true;disabled=false;value='0';children=[];dataset={};attrs={};textContent='';
  style={setProperty:(k,v)=>{this.style[k]=v;}};
  classList={toggle:(k,v)=>{this.attrs[k]=v;}};
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k]??null;}
  appendChild(x){this.children.push(x);}
  replaceChildren(...xs){this.children=[...xs];}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
function documentFixture() {
  const html=readFileSync(join(__dirname,'../index.html'),'utf8');
  const elements=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  const fromAttr=(attribute,key)=>[...html.matchAll(new RegExp(`<button\\b[^>]*${attribute}="([^"]+)"[^>]*>([\\s\\S]*?)<\\/button>`,'g'))].map(m=>{
    const b=new Element();b.dataset[key]=m[1];b.textContent=m[2].replace(/<[^>]*>/g,'').trim();b.setAttribute('aria-expanded','false');return b;
  });
  const tools=fromAttr('data-tool-panel','toolPanel'),disclosures=fromAttr('data-disclosure','disclosure');
  return {elements,tools,disclosures,doc:{
    getElementById:id=>elements[id],createElement:()=>new Element(),
    querySelectorAll:selector=>selector==='[data-tool-panel]'?tools:disclosures,
  }};
}
test('named tools open only one panel and a second click closes it',()=>{
  const {doc,elements,tools}=documentFixture();const sidebar=mount(doc);
  const click=name=>{const b=tools.find(b=>b.textContent===name);assert.ok(b,`button ${name}`);b.click();return b;};
  assert.ok(tools.every(b=>elements[b.dataset.toolPanel].hidden));
  const run=click('Mô phỏng');assert.equal(run.getAttribute('aria-expanded'),'true');assert.equal(elements['simulation-options'].hidden,false);
  const stats=click('Thống kê');assert.equal(elements['simulation-options'].hidden,true);assert.equal(elements['analysis-details'].hidden,false);
  stats.click();assert.ok(tools.every(b=>elements[b.dataset.toolPanel].hidden));
  sidebar.open('map-options');assert.equal(elements['map-options'].hidden,false);
  assert.equal(tools.find(b=>b.textContent==='Bản đồ').getAttribute('aria-expanded'),'true');
});
test('secondary actions have real buttons and maintain aria-expanded',()=>{
  const {doc,elements,disclosures}=documentFixture();mount(doc);
  for(const name of ['Thông tin kết quả','Chọn ô bằng chỉ số','Chi tiết lỗi']) {
    const button=disclosures.find(b=>b.textContent===name);assert.ok(button,`button ${name}`);
    button.click();assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(elements[button.dataset.disclosure].hidden,false);
    button.click();assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(elements[button.dataset.disclosure].hidden,true);
  }
});
test('tool changes notify the owner so hidden drawing controls cannot leave map in draw mode',()=>{
  const {doc,tools}=documentFixture();const changes=[];
  const sidebar=mount(doc,id=>changes.push(id));
  tools.find(b=>b.textContent==='Phân tích').click();
  sidebar.open('map-options');
  assert.deepEqual(changes,[null,'spatial-analysis','map-options']);
});
test('altitude milestones are actual voxel centres at proportional slider positions',()=>{
  const list=milestones(Array.from({length:50},(_,k)=>k*2+1));
  assert.deepEqual(list.map(x=>x.index),[0,12,25,37,49]);
  assert.deepEqual(list.map(x=>x.label),['1 m','25 m','51 m','75 m','99 m']);
  assert.equal(list[1].position,12/49*100);assert.equal(list[2].position,25/49*100);
  assert.equal(milestones([1]).length,1);assert.equal(milestones([1,3]).length,2);assert.deepEqual(milestones([]),[]);
});
test('labelled height buttons select the correct layer and sync with native slider input',()=>{
  const {doc,elements}=documentFixture();const slider=elements['height-slider'];slider.hidden=false;
  const selected=[];const controls=heightMarks(doc,slider,Array.from({length:50},(_,k)=>k*2+1),i=>selected.push(i));
  const buttons=elements['height-marks'].children,dots=elements['height-dots'].children;
  const button=buttons.find(b=>b.getAttribute('aria-label')==='Đến độ cao 51 m');
  assert.ok(button);button.click();assert.equal(slider.value,'25');assert.deepEqual(selected,[25]);
  assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(dots[2].attrs['is-current'],true);
  slider.value='12';slider.dispatchEvent(new Event('input'));assert.equal(buttons[1].getAttribute('aria-pressed'),'true');
  assert.equal(button.getAttribute('aria-pressed'),'false');
  slider.disabled=true;controls.sync();assert.ok(buttons.every(b=>b.disabled));
  button.click();assert.deepEqual(selected,[25]);
});
