const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
async function setup() {
  const elements = new Map();
  const session = new Map();
  const element = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        hidden: false,
        disabled: false,
        textContent: "",
        setAttribute() {},
        classList: {},
      });
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: element },
    window: { matchMedia: () => ({ matches: false }) },
    crypto: { randomUUID },
    sessionStorage: {
      getItem: (key) => session.get(key) ?? null,
      removeItem: (key) => session.delete(key),
      setItem: (key, value) => session.set(key, value),
    },
    location: { reload() {} },
    ViewerApi: {
      request: async () => {
        throw new Error("offline");
      },
    },
    ViewerGrid: require("../viewer-grid.js"),
    fetch() {},
    setTimeout: (fn) => {
      fn();
      return 0;
    },
    clearTimeout() {},
    console,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"),
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  return { context, element };
}

test('source preset creates a real run request and reduced labels survive reload metadata', async () => {
  const {context,element}=await setup();
  element('new-run-scenario').value='dry_nov_apr';
  element('new-run-emission').value='0.8';
  vm.runInContext(`api=async(path,options)=>{ globalThis.sent=JSON.parse(options.body);return {run_id:'reduced-id'}; };
    trackRun=async()=>{};`,context);
  await vm.runInContext('createRun()',context);
  const { request_id, ...payload } = JSON.parse(JSON.stringify(context.sent));
  assert.match(request_id, /^[\da-f-]{36}$/);
  assert.deepEqual(payload,{scenario_id:'dry_nov_apr',model:'fv',emission_multiplier:.8});
  const label=vm.runInContext(`scenarioLabel({id:'1234-5678',scenario_id:'dry_nov_apr',model:'fv',emission_multiplier:.6,warnings:[]})`,context);
  assert.match(label,/Giảm 40%/);
  assert.doesNotMatch(vm.runInContext(`scenarioLabel({id:'1234',scenario_id:'dry_nov_apr',model:'fv',warnings:[]})`,context),/Giảm/);
});

test("statistics show units and distinguish a measured zero from missing threshold data", async () => {
  const { context, element } = await setup();
  vm.runInContext(`
    M = { thresholds: { qcvn_24h: { value:45 }, who_24h: { value:15 } } };
    current = () => ({});
    layerStats = () => ({ mean:.2, max:.89, air:7683, area:{qcvn_24h:0} });
    domainExceedance = () => ({qcvn_24h:0});
    updateStats();
  `, context);
  assert.equal(element("stat-mean").textContent, "0,2");
  assert.equal(element("stat-max").textContent, "0,89");
  assert.equal(element("threshold-outcome-qcvn_24h").textContent, "Không có ô nào có nồng độ lớn hơn 45 µg/m³ ở tầng này.");
  assert.equal(element("threshold-outcome-who_24h").textContent, "Đang tải số liệu…");
  vm.runInContext("layerStats=()=>({mean:20,max:60,air:100,area:{qcvn_24h:25,who_24h:50}});updateStats()",context);
  assert.equal(element("threshold-outcome-qcvn_24h").textContent, "25 m² vượt ngưỡng ở tầng này.");
  vm.runInContext("current = () => null; updateStats()", context);
  assert.equal(element("stat-mean").textContent, "–");
  assert.equal(element("threshold-outcome-qcvn_24h").textContent, "Chưa có số liệu.");
});

test("pan and cell selection are separate modes and drawing keeps priority", async () => {
  const { context, element } = await setup();
  vm.runInContext(`
    let panEnabled = true;
    let drawing = false;
    const canvas = {style:{}};
    map = {dragPan:{enable(){panEnabled=true},disable(){panEnabled=false}},getCanvas:()=>canvas};
    spatialAnalysis = {isDrawing:()=>drawing};
    renderLayers = () => syncMapMode();
    setMapMode('cell');
  `, context);
  assert.equal(vm.runInContext('panEnabled', context), false);
  assert.equal(vm.runInContext('canvas.style.cursor', context), 'default');
  vm.runInContext("drawing=true; setMapMode('pan'); syncMapMode()", context);
  assert.equal(vm.runInContext('state.mapMode', context), 'cell');
  assert.equal(element('map-pan-mode').disabled, true);
  vm.runInContext("drawing=false; setMapMode('pan')", context);
  assert.equal(vm.runInContext('panEnabled', context), true);
  assert.equal(vm.runInContext('canvas.style.cursor', context), '');
  assert.equal(element('map-cell-mode').disabled, false);
});

test("export snapshot invalidates when camera or run changes, not just export timestamp",async()=>{
  const {context}=await setup();
  const key=report=>vm.runInContext(`exportKey(${JSON.stringify(report)})`,context);
  const a={metadata:{run_id:'a',camera:{zoom:16},z_center_m:1,exported_at:'now'},mode:'gốc'};
  assert.equal(key(a),key({...a,metadata:{...a.metadata,exported_at:'later'}}));
  assert.notEqual(key(a),key({...a,metadata:{...a.metadata,run_id:'b'}}));
  assert.notEqual(key(a),key({...a,metadata:{...a.metadata,camera:{zoom:17}}}));
  assert.notEqual(key(a),key({...a,mode:'chênh lệch'}));
});
test("bootstrap error exposes retry and disables unavailable controls", async () => {
  const { element } = await setup();
  assert.equal(element("status-retry").hidden, false);
  assert.equal(typeof element("status-retry").onclick, "function");
  assert.equal(element("height-slider").disabled, true);
  assert.equal(element("wind-hud").hidden, true);
});
test("five polling errors retain active run and permit resume without another POST", async () => {
  const { context, element } = await setup();
  await vm.runInContext(
    "activeRunId='run'; api=async()=>{throw new Error('offline')}; trackRun('run')",
    context,
  );
  assert.equal(vm.runInContext("activeRunId", context), "run");
  assert.equal(vm.runInContext("trackingRun", context), false);
  assert.equal(element("run-retry").hidden, false);
  assert.equal(element("run-button").disabled, true);
  await vm.runInContext(
    "api=async()=>({status:'failed',progress:0,error:{message:'model failed'}});trackRun('run')",
    context,
  );
  assert.equal(vm.runInContext("activeRunId", context), null);
  assert.equal(element("run-button").disabled, false);
});
test("unknown saved run releases the stale session lock", async () => {
  const { context, element } = await setup();
  await vm.runInContext(
    "activeRunId='missing'; AVAILABLE_SCENARIOS=[{}];api=async()=>{const e=new Error('404');e.kind='not-found';throw e;};trackRun('missing')",
    context,
  );
  assert.equal(vm.runInContext("activeRunId", context), null);
  assert.equal(element("run-button").disabled, false);
});
test("failed result loading preserves old selection and exposes a retry", async () => {
  const { context, element } = await setup();
  await vm.runInContext(
    "state.scenario='old';loadScenario=async()=>{throw new Error('offline')};selectResult('new')",
    context,
  );
  assert.equal(vm.runInContext("state.scenario", context), "old");
  assert.equal(element("scenario-list").value, "old");
  assert.equal(element("status-retry").hidden, false);
  await vm.runInContext(
    "loadScenario=async()=>({});refresh=()=>{};selectResult('new')",
    context,
  );
  assert.equal(vm.runInContext("state.scenario", context), "new");
  assert.equal(element("status-retry").hidden, true);
});
test("query errors can be retried without changing height or replacing exact values", async () => {
  const { context, element } = await setup();
  vm.runInContext(
    "state.scenario='run';M={thresholds:{q:{}}};GRID={z_centres_m:[1]};current=()=>({});api=async()=>{throw new Error('offline')};scheduleExactQueries()",
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element("query-retry").hidden, false);
  vm.runInContext(
    "api=async()=>({area_m2:42});updateStats=()=>{};updateProfile=()=>{};scheduleExactQueries()",
    context,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(element("query-retry").hidden, true);
  assert.equal(element("query-note").textContent, "");
  assert.equal(vm.runInContext("queryCache.get('area:run:0').q", context), 42);
});
test("selected-cell card uses exact profile per run/layer and never treats solid as zero", async () => {
  const { context, element } = await setup();
  vm.runInContext(
    "GRID={nx:10,ny:10,dx_m:5,dy_m:5,z_centres_m:[1,3]};state.scenario='run';state.selected={i:2,j:3};current=()=>({});queryCache.set('profile:run:2:3',{levels:[{concentration_ug_m3:.123},{concentration_ug_m3:null}]});updateCellInfo()",
    context,
  );
  assert.match(
    element("cell-info").textContent,
    /0,123 µg\/m³ · dữ liệu truy vấn/,
  );
  vm.runInContext("state.layer=1;updateCellInfo()", context);
  assert.match(element("cell-info").textContent, /Ô công trình/);
  vm.runInContext("state.scenario='other';updateCellInfo()", context);
  assert.match(element("cell-info").textContent, /Đang truy vấn/);
});
test("coordinate selection validates bounds and retains previous selection on invalid input", async () => {
  const { context } = await setup();
  vm.runInContext(
    "GRID={nx:10,ny:10};current=()=>({});refresh=()=>{};selectCell(2,3)",
    context,
  );
  assert.equal(vm.runInContext("state.selected.i", context), 2);
  assert.equal(vm.runInContext("selectCell(10,0)", context), false);
  assert.equal(vm.runInContext("state.selected.i", context), 2);
});
test("a lost create response keeps the request ID for a manual retry", async () => {
  const { context, element } = await setup();
  vm.runInContext(`requests=[]; trackRun=async()=>{};
    api=async(_, options)=>{
      const body=JSON.parse(options.body);
      requests.push(body.request_id);
      if(requests.length>1) return {run_id:body.request_id};
      const e=new Error('lost reply'); e.kind='timeout'; throw e;
    };`, context);
  await vm.runInContext("createRun()", context);
  assert.equal(context.requests.length, 1);
  assert.match(element('run-note').textContent, /bấm Chạy để thử lại/);
  assert.equal(element('run-error').hidden, false);
  assert.equal(element('run-button').disabled, false);
  await vm.runInContext("createRun()", context);
  assert.equal(context.requests.length, 2);
  assert.equal(context.requests[0], context.requests[1]);
});
test("late result responses cannot replace the more recently selected run", async () => {
  const { context } = await setup();
  vm.runInContext("refresh=()=>{};loadScenario=()=>new Promise(r=>{resolveOld=r});oldSelection=selectResult('old')", context);
  await vm.runInContext("loadScenario=async()=>({});selectResult('new')", context);
  await vm.runInContext("resolveOld({});oldSelection", context);
  assert.equal(vm.runInContext("state.scenario", context), 'new');
});
test("late query responses after a run switch do not render stale profile or statistics", async () => {
  const { context, element } = await setup();
  vm.runInContext("renders=0;state.scenario='old';M={thresholds:{q:{}}};GRID={z_centres_m:[1]};current=()=>({});updateStats=()=>{renders++};updateProfile=()=>{renders++};api=()=>new Promise(r=>{resolveQuery=r});scheduleExactQueries();state.scenario='new';resolveQuery({area_m2:25})", context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(vm.runInContext("renders", context), 0);
  assert.equal(vm.runInContext("queryCache.has('area:new:0')", context), false);
  assert.equal(element('query-retry').hidden, true);
});

test('failed solver exposes a Vietnamese recovery message rather than raw diagnostics',async()=>{
 const {context,element}=await setup();
 vm.runInContext("api=async()=>({status:'failed',error:{kind:'model',message:'Internal solver stack trace C:/private/secret'}})",context);
 await vm.runInContext("trackRun('failed-run')",context);
 assert.match(element('run-error-detail').textContent,/kiểm tra tính toán/);
 assert.doesNotMatch(element('run-error-detail').textContent,/Internal|stack|private/);
 assert.equal(element('run-progress').hidden,true);
 assert.equal(element('run-button').disabled,false);
});
