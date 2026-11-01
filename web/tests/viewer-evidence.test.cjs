const { test } = require('node:test');
const assert = require('node:assert/strict');
const { viewModel, render, number } = require('../viewer-evidence.js');

const summary = () => ({
  run_id: 'run-one', model: 'fv', model_version: '0.1.0+abcdef1',
  input_hash: 'sha256:' + 'a'.repeat(64), units: 'ug m-3',
  warnings: ['LoD1; not field validation'],
  verification: { status: 'pass', checks: [
    { name: 'mass_balance', status: 'pass', value: 1e-14, tolerance: 1e-6 },
    { name: 'positivity', status: 'pass', value: 0, tolerance: 1e-9 },
  ] },
  metrics: { wall_clock_s: 60, simulated_s: 660, steps: 5324, dt_s: .124,
    emitted_kg: .002, remaining_kg: .0005, escaped_kg: .0015, correction_kg: 0,
    stopping_criterion: 'steady_state', convergence_history: [{ relative_l1_change: 9e-5 }] },
});

test('empty and stale-run summaries cannot show verification pass', () => {
  assert.equal(viewModel(null, null).state, 'empty');
  const model = viewModel(summary(), 'different-run');
  assert.equal(model.state, 'error');
  assert.equal(model.identity, undefined);
});

test('dashboard preserves full identity, exact metrics and warnings', () => {
  const model = viewModel(summary(), 'run-one');
  assert.equal(model.state, 'pass');
  assert.match(model.message, /2\/2/);
  assert.deepEqual(model.identity.find(([name]) => name === 'Input hash'), ['Input hash', 'sha256:' + 'a'.repeat(64)]);
  assert.equal(model.metrics.find(([name]) => name === 'Hiệu chỉnh mass')[1], '0 kg');
  assert.match(model.metrics.find(([name]) => name === 'Residual cuối')[1], /e-5/);
  assert.equal(model.warnings[0], 'LoD1; not field validation');
});

test('empty checks and contradictory check status never look verified', () => {
  const data = summary();
  data.verification.checks = [];
  assert.equal(viewModel(data, data.run_id).state, 'unverified');
  data.verification.checks = [{ name: 'mass_balance', status: 'fail', value: .1, tolerance: 1e-6 }];
  assert.equal(viewModel(data, data.run_id).state, 'unverified');
});

test('missing measurements are distinct from zero', () => {
  assert.equal(number(undefined), 'Chưa có');
  assert.equal(number(null), 'Chưa có');
  assert.equal(number(NaN), 'Chưa có');
  assert.equal(number(Infinity), 'Chưa có');
  assert.equal(number(0, 'kg'), '0 kg');
  const model = viewModel({ ...summary(), metrics: null }, 'run-one');
  assert.equal(model.metrics.find(([name]) => name === 'Chênh lệch mass')[1], 'Chưa có');
});

test('render treats model warnings as text, not HTML', () => {
  const created = [];
  const doc = { createElement(tag) {
    const node = { tag, children: [], attributes: {}, append(...nodes) { this.children.push(...nodes); },
      setAttribute(key, value) { this.attributes[key] = value; } };
    Object.defineProperty(node, 'innerHTML', { set() { throw new Error('Untrusted HTML rendering'); } });
    created.push(node);
    return node;
  } };
  let children;
  const container = { replaceChildren(...nodes) { children = nodes; } };
  const data = summary();
  data.warnings = ['<img src=x onerror=alert(1)>'];
  render(container, viewModel(data, data.run_id), doc);
  assert(children.length > 0);
  assert(!created.some((node) => node.textContent === data.warnings[0]));
  assert(created.some((node) => node.textContent?.includes('Có cảnh báo dữ liệu')));
  assert(!created.some((node) => node.tag === 'a'));
  render(container, viewModel(null, null), doc);
  assert.equal(children.length, 1);
});

test('result info has no technical disclosure, raw identifiers or download links even after refresh',()=>{
  const created=[];
  const doc={createElement(tag){const el={tag,children:[],attrs:{},textContent:'',append(...xs){this.children.push(...xs);},setAttribute(k,v){this.attrs[k]=v;}};created.push(el);return el;}};
  const container={children:[],replaceChildren(...xs){this.children=xs;}};
  const visible=el=>el.hidden?'':[el.textContent,...el.children.map(visible)].join(' ');
  const model=viewModel(summary(),'run-one');render(container,model,doc);
  assert.match(visible(container),/Kiểm tra: đạt/);
  assert.match(visible(container),/Nồng độ được tính từ mô hình theo kịch bản đã chọn, không phải số đo tại hiện trường/);
  assert.doesNotMatch(visible(container),/sha256:|run-one|Residual|5324|5.324|LoD1/);
  render(container,model,doc);
  assert(!created.some(el=>['button','a','table'].includes(el.tag)));
  assert.doesNotMatch(visible(container),/sha256:|Chi tiết kỹ thuật|Residual|Input hash/);
});

// Unknown tags must not silently be described as measured or fallback heights.
test('scene quality distinguishes satellite, tagged, derived, fallback and unknown',()=>{
  const {dataQuality}=require('../viewer-evidence.js');
  const scene={features:['gob:building_height','direct:height','levels:building:levels','fallback:fixed','unresolved','new-provider'].map(height_source=>({properties:{height_source,height_m:20}}))};
  const q=dataQuality(scene,{buildings:{footprint:'OpenStreetMap contributors'}});
  assert.equal(q.total,6);
  assert.deepEqual(q.groups.map(g=>[g.key,g.count]),[['gob',1],['tagged',1],['levels',1],['fallback',1],['unknown',2]]);
  assert.equal(q.footprint_source,'OpenStreetMap contributors');
  assert.equal(q.terrain,'flat');
  assert.equal(dataQuality(null).total,null);
  assert.equal(dataQuality({features:[]}).state,'empty');
  assert.equal(dataQuality({features:[{properties:{height_source:'gob:x',height_m:null}}]}).groups[0].key,'unknown');
});

test('upstream OSM and derived-median provenance tags are classified explicitly',()=>{
 const {dataQuality}=require('../viewer-evidence.js');
 for(const [height_source,key] of [['osm:height','tagged'],['osm:building:levels','levels'],['derived:median','fallback']])
   assert.equal(dataQuality({features:[{properties:{height_source,height_m:12}}]}).groups[0].key,key);
});

test('source quality is rendered as text and replaced rather than accumulated',()=>{
 const {dataQuality}=require('../viewer-evidence.js');
 const doc={createElement(tag){return {tag,textContent:'',children:[],append(...xs){this.children.push(...xs);}};}};
 const container={children:[],replaceChildren(...xs){this.children=xs;}};
 const visible=el=>[el.textContent,...el.children.map(visible)].join(' ');
 const model={...viewModel(summary(),'run-one'),quality:dataQuality({features:[{properties:{height_source:'fallback:fixed',height_m:12}}]},{buildings:{footprint:'<img src=x>'}})};
 render(container,model,doc);
 assert.match(visible(container),/chiều cao thay thế/);
 assert.match(visible(container),/<img src=x>/);
 assert(!container.children.some(el=>el.tag==='img'));
 render(container,{...model,quality:dataQuality(null)},doc);
 assert.match(visible(container),/Chưa có thông tin chiều cao/);
 assert.doesNotMatch(visible(container),/chiều cao thay thế|<img/);
});

test('compact summary separates two time metrics and does not duplicate a complete source count',()=>{
 const {dataQuality}=require('../viewer-evidence.js');
 const doc={createElement(tag){return {tag,textContent:'',children:[],append(...xs){this.children.push(...xs);}};}};
 const container={children:[],replaceChildren(...xs){this.children=xs;}};
 const visible=el=>[el.textContent,...el.children.map(visible)].join(' ');
 const model={...viewModel(summary(),'run-one'),quality:dataQuality({features:[{properties:{height_source:'gob:x',height_m:12}}]})};
 render(container,model,doc);
 const text=visible(container);
 assert.match(text,/Thời gian tính toán/);assert.match(text,/Thời gian mô phỏng/);
 assert.match(text,/60 s/);assert.match(text,/660 s/);
 assert.match(text,/100% chiều cao ước tính từ ảnh vệ tinh/);
 assert.doesNotMatch(text,/Tổng số|Phương pháp|Kiểm tra tính toán không phải/);
 render(container,{...model,state:'unverified'},doc);
 assert.match(visible(container),/Chưa đủ kiểm tra/);
 assert.doesNotMatch(visible(container),/Kiểm tra: đạt/);
});
