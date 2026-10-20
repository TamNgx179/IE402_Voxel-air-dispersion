const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  createField,
  createParticles,
  advance,
  rasterStyle,
  streamlet,
} = require("../viewer-flow.js");
const grid = { nx: 10, ny: 10, nz: 2, dx_m: 5, dy_m: 5, dz_m: 2 };
test('building clicks during polygon drawing cannot switch tools or cancel the draft',()=>{
  const source=readFileSync(join(__dirname,'../app.js'),'utf8');
  const fn=source.slice(source.indexOf('function showBuildingAppearance('),source.indexOf('function facadeLayers('));
  const note={textContent:''},opened=[];let drawing=true,reads=0;
  const context={spatialAnalysis:{isDrawing:()=>drawing},buildingAppearance:{features:{get(){reads++;return {height:30};}}},$:()=>note,fmt:String,sidebar:{open:id=>opened.push(id)}};
  require('node:vm').runInNewContext(fn+';showBuildingAppearance("building-1");',context);
  assert.deepEqual(opened,[]);assert.equal(reads,0);assert.equal(note.textContent,'');
  drawing=false;
  require('node:vm').runInNewContext(fn+';showBuildingAppearance("building-1");',context);
  assert.deepEqual(opened,['map-options']);assert.match(note.textContent,/30 m/);
});
function field(u = 1, v = 0, air = () => true) {
  const layers = [0, 1].map((k) => ({
    k,
    z_m: (k + 0.5) * 2,
    vectors: [2, 7].flatMap((j) => [2, 7].map((i) => [i, j, 0, 0, u, v, 0])),
  }));
  return createField({ stride: 5, layers }, grid, air);
}
test("motion follows solver u/v with correct units; no background fallback", () => {
  const f = field(),
    particles = createParticles(f, 0);
  const x = particles[0].x;
  advance(f, particles, 1);
  assert.ok(Math.abs(particles[0].x - x - 1) < 1e-9);
  assert.equal(particles[0].z, 1);
  const wet = field(0, -2),
    p = createParticles(wet, 0),
    y = p[0].y;
  advance(wet, p, 0.5);
  assert.ok(Math.abs(p[0].y - y + 1) < 1e-9);
  assert.equal(
    createField(null, grid, () => true),
    null,
  );
});
test("particles cannot tunnel through solid or leave simulation domain", () => {
  const f = field(20, 0, (x) => x < 15 || x >= 20),
    p = createParticles(f, 0);
  advance(f, p, 1);
  assert.ok(p.every((a) => a.x >= 0 && a.x < 50 && (a.x < 15 || a.x >= 20)));
  assert.equal(p[0].x, p[0].seed.x);
});
test("layer switch creates particles at that layer; zero wind stays finite", () => {
  const f = field(0, 0),
    p = createParticles(f, 1);
  advance(f, p, 0.2);
  assert.ok(p.every((a) => a.z === 3 && Number.isFinite(a.x)));
  assert.equal(createParticles(f, 9).length, 0);
});
test("steady wind does not reset particles at an arbitrary 18-second lifetime", () => {
  const f = field(0.01, 0),
    p = createParticles(f, 0);
  const x = p[0].x;
  for (let n = 0; n < 200; n++) advance(f, p, 0.1);
  assert.ok(Math.abs(p[0].x - x - 0.2) < 1e-8);
});
test("raster fallback covers whole map, includes attribution, not study-area bounds", () => {
  const style = rasterStyle();
  assert.equal(style.version, 8);
  assert.equal(style.sources.context.type, "raster");
  assert.equal(style.sources.context.bounds, undefined);
  assert.match(style.sources.context.tiles[0], /tile.openstreetmap.org/);
  assert.match(style.sources.context.attribution, /OpenStreetMap/);
});
test("pause button receives clicks even though wind HUD passes map gestures through", () => {
  const css = readFileSync(join(__dirname, "../styles.css"), "utf8");
  assert.match(css, /\.wind-hud \.icon-button\s*\{[^}]*pointer-events:\s*auto/);
});
test("wind streamlet aligns with solver, remains bounded and has no zero-speed fallback", () => {
  const points = streamlet(field(1, 0), { x: 25, y: 25, z: 1 });
  assert.ok(points.length > 3 && points.length <= 48);
  assert.ok(
    points.every((p) => p[1] === 25 && p[2] === 1 && p[0] >= 0 && p[0] < 50),
  );
  assert.ok(points.slice(1).every((p, i) => p[0] > points[i][0]));
  assert.deepEqual(streamlet(field(0, 0), { x: 25, y: 25, z: 1 }), []);
});
test("upstream wind trace stops at solid cells instead of drawing through buildings", () => {
  const points = streamlet(
    field(1, 0, (x) => x >= 20),
    { x: 25, y: 25, z: 1 },
  );
  assert.ok(points.length > 1);
  assert.ok(points.every((p) => p[0] >= 20));
});
test("curved streamlets follow the field without invented decorative waves", () => {
  const f = {
    grid,
    maxSpeed: 2,
    air: (x, y, z) => x >= 0 && y >= 0 && z >= 0,
    sample: (x, y, z) => (x >= 0 && y >= 0 && z >= 0 ? [1, x / 25, 0] : null),
  };
  const points = streamlet(f, { x: 25, y: 25, z: 1 });
  const slopes = points
    .slice(1)
    .map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
  assert.ok(slopes.at(-1) > slopes[0]);
  assert.ok(points.every((p) => p.every(Number.isFinite)));
});
test("viewer does not load photo textures or render wind arrowheads", () => {
  const source = readFileSync(join(__dirname, "../app.js"), "utf8");
  assert.doesNotMatch(source, /wind-arrowheads|facade-photo-|image\.decode\(/);
  assert.match(source, /ViewerFlow\.streamlet/);
});
test("compact sidebar keeps primary controls ahead of named tool buttons and hidden panels", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, "control IDs must remain unique");
  for (const id of ["scenario-list", "height-slider", "legend", "show-grid", "profile", "cell-picker-form", "run-button", "query-retry", "threshold-list", "show-wind", "multiplier"]) {
    assert.ok(ids.includes(id), `preserve ${id}`);
  }
  assert.ok(html.indexOf('id="height-slider"') < html.indexOf('id="run-button"'));
  assert.ok(html.indexOf('id="profile"') < html.indexOf('id="threshold-list"'));
  const buttons=Array.from(html.matchAll(/<button\b[^>]*data-tool-panel="([^"]+)"[^>]*>/g));
  assert.equal(buttons.length,5);
  for(const [,id] of buttons) {
    assert.ok(ids.includes(id),`panel ${id} exists`);
    assert.match(html,new RegExp(`<[^>]+id="${id}"[^>]*hidden`));
  }
  assert.ok(html.indexOf('id="height-slider"') < html.indexOf('class="sidebar-nav"'));
  assert.match(html, /aria-label="Phân tích nâng cao"/);
  assert.ok(html.indexOf('id="analysis-details"') < html.indexOf('id="profile"'));
  assert.doesNotMatch(html, /<details\b|<summary\b/);
  const feedback = html.slice(html.indexOf('<div class="query-feedback">'), html.indexOf('<section class="simulation-section"'));
  assert.match(feedback, /id="query-retry"/);
});
test("sidebar uses explicit consistent buttons without dropdown arrows or grid swatches", () => {
  const html = readFileSync(join(__dirname, "../index.html"), "utf8");
  const css = readFileSync(join(__dirname, "../styles.css"), "utf8");
  assert.doesNotMatch(html, /grid-legend|grid-swatch|selected-swatch/);
  assert.match(html, /id="show-grid"/);
  assert.match(css, /\.tool-button\[aria-expanded="true"\]/);
  assert.match(css, /\.text-button\[aria-expanded="true"\]/);
  assert.doesNotMatch(css, /summary::before|details\[open\]/);
  for(const id of ['height-marks','height-dots']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(css,/\.height-dots\s*\{[^}]*pointer-events:none/);
});

test("UI icons use the locally bundled licensed Bootstrap font, including dynamic wind state", () => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const app = readFileSync(join(__dirname, '../app.js'), 'utf8');
  const css = readFileSync(join(__dirname, '../vendor/bootstrap-icons/bootstrap-icons.min.css'), 'utf8');
  assert.match(html, /href="\.\/vendor\/bootstrap-icons\/bootstrap-icons.min.css"/);
  assert.doesNotMatch(html, /<svg\b/);
  for (const [, name] of html.matchAll(/class="bi (bi-[a-z-]+)"/g)) {
    assert.ok(css.includes(`.${name}::before`), `${name} exists in the official font`);
  }
  for (const format of ['woff', 'woff2']) {
    const font = readFileSync(join(__dirname, `../vendor/bootstrap-icons/fonts/bootstrap-icons.${format}`));
    assert.equal(font.subarray(0,4).toString(), format === 'woff2' ? 'wOF2' : 'wOFF');
  }
  assert.match(readFileSync(join(__dirname, '../vendor/bootstrap-icons/LICENSE'), 'utf8'), /MIT License/);
  assert.match(app, /bi bi-play-fill/);
  assert.match(app, /bi bi-pause-fill/);
  assert.match(readFileSync(join(__dirname, '../styles.css'), 'utf8'), /\.panel\.collapsed #panel-toggle \.bi/);
});

test("tool buttons have distinct surfaces and readable default/active text contrast", () => {
  const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
  const token = name => css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`))[1];
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v,16)/255)
      .map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
    return rgb[0]*.2126 + rgb[1]*.7152 + rgb[2]*.0722;
  };
  const contrast = (a,b) => {
    const values = [luminance(a),luminance(b)].sort((x,y)=>y-x);
    return (values[0]+.05)/(values[1]+.05);
  };
  assert.notEqual(token('tool-bg'), token('panel'));
  assert.ok(contrast(token('tool-text'), token('tool-bg')) >= 4.5);
  assert.ok(contrast(token('tool-text'), token('tool-hover')) >= 4.5);
  assert.ok(contrast('#ffffff', token('tool-active')) >= 4.5);
  assert.match(css, /\.tool-button\[aria-expanded="true"\][^{]*\{[^}]*background:var\(--tool-active\)[^}]*color:#ffffff/);
  assert.match(css, /\.tool-button:focus-visible\s*\{/);
});

test("expanded tools separate containers, fields, labels and primary actions", () => {
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
  assert.match(css, /\.tool-panel\s*\{[^}]*border:1px solid var\(--section-border\)[^}]*background:var\(--section-bg\)/);
  assert.match(css, /\.tool-panel \.row\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.tool-panel select,[^{]*\{[^}]*border:1px solid var\(--field-border\)[^}]*background:#ffffff/);
  assert.match(html, /<label for="new-run-scenario">Kịch bản mô phỏng<\/label>/);
  assert.match(html, /id="region-query" class="action-primary" disabled/);
  assert.match(html, /for="background">Nồng độ nền \(µg\/m³\)/);
  assert.match(css, /\.tool-panel button:disabled,[^{]*\{[^}]*opacity:1[^}]*cursor:not-allowed/);
});

test("expanded labels, helper copy, boundaries and disabled controls have measured contrast", () => {
  const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
  const token = name => css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`))[1];
  const lum = hex => hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255)
    .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const ratio = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
  for (const name of ['label','helper','text']) {
    assert.ok(ratio(token(name),token('section-bg'))>=4.5, `${name} readable on panel`);
    assert.ok(ratio(token(name),'#ffffff')>=4.5, `${name} readable on input`);
  }
  assert.ok(ratio(token('disabled-text'),token('disabled-bg'))>=4.5);
  assert.ok(ratio(token('field-border'),'#ffffff')>=3, 'field outline visible');
  assert.ok(ratio(token('section-border'),token('panel'))>=2.5, 'container edge separated');
  assert.notEqual(token('section-bg'),token('panel'));
  for (const surface of ['action-bg','action-hover']) {
    assert.notEqual(token(surface),token('section-bg'));
    assert.notEqual(token(surface),token('tool-bg'));
    assert.ok(ratio(token('action-text'),token(surface))>=4.5, `${surface} text readable`);
  }
  assert.notEqual(token('action-active'),token('tool-active'));
  assert.ok(ratio('#ffffff',token('action-active'))>=4.5);
  assert.ok(ratio('#ffffff',token('action-active-hover'))>=4.5);
  assert.ok(ratio(token('action-border'),token('section-bg'))>=2.5);
  assert.match(css, /\.tool-panel \.action-primary, \.tool-panel \.primary-button\s*\{[^}]*background:var\(--action-active\)/);
  assert.match(css, /\.tool-panel button:not\(\.primary-button\):not\(\.action-primary\)\s*\{[^}]*background:var\(--action-bg\)/);
});

test("checkbox rows remain plain native choices rather than button-like cards", () => {
  const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
  const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
  assert.match(css, /\.tool-panel \.check, \.tool-panel \.choices label\s*\{[^}]*display:flex[^}]*border:0[^}]*background:transparent/);
  assert.doesNotMatch(css, /\.tool-panel \.check:has\(input:checked\)/);
  for (const id of ['show-buildings','show-facades','show-roads','show-wind']) {
    assert.match(html, new RegExp(`<input id="${id}" type="checkbox"`));
  }
  assert.match(css, /--tool-active: #243c4c/);
  assert.match(css, /--section-bg: #f1f4f6/);
  assert.doesNotMatch(css, /#f4f0e8|#a39683|#e9eff5/);
});

test("analysis separates task types and reserves a readable result area after region settings", () => {
  const html=readFileSync(join(__dirname,'../index.html'),'utf8');
  const css=readFileSync(join(__dirname,'../styles.css'),'utf8');
  assert.match(html,/id="analysis-region-mode"[^>]*aria-pressed="true"/);
  assert.match(html,/id="compare-panel"[^>]*hidden/);
  assert.match(html,/id="region-settings" hidden/);
  assert.match(html,/id="region-export" disabled hidden/);
  assert.ok(html.indexOf('id="region-feedback"')<html.indexOf('id="region-result"'));
  assert.match(html,/id="region-result"[^>]*aria-label="Kết quả phân tích vùng"/);
  assert.match(css,/\.result-metrics\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.result-table-scroll\s*\{[^}]*overflow:auto/);
  assert.match(html,/id="illustration-reset"[^>]*hidden/);
});

test("region selection only exposes drawing, not manual coordinate input",()=>{
  const html=readFileSync(join(__dirname,'../index.html'),'utf8');
  assert.match(html,/id="region-draw"/);
  assert.doesNotMatch(html,/region-geojson|region-import|region-input|Nhập vùng bằng tọa độ/);
  assert.doesNotMatch(readFileSync(join(__dirname,'../viewer-analysis.js'),'utf8'),/parseRegionInput|region-geojson|region-input/);
  const app=readFileSync(join(__dirname,'../app.js'),'utf8');
  assert.doesNotMatch(app,/MODEL_NOTES\[entry\.model\][^\n]*warnings/);
});

test("sidebar action groups and standalone buttons align right without reversing interaction order",()=>{
  const css=readFileSync(join(__dirname,'../styles.css'),'utf8');
  assert.match(css,/\.analysis-actions\s*\{[^}]*justify-content:flex-end/);
  assert.match(css,/\.sidebar-nav\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.panel \.text-button,[^{]*#region-export[^{]*\{[^}]*margin-left:auto[^}]*margin-right:0/);
  assert.doesNotMatch(css,/row-reverse|direction:\s*rtl/);
});

test("tool navigation uses a balanced two-column grid with consistent single-line labels",()=>{
  const css=readFileSync(join(__dirname,'../styles.css'),'utf8');
  assert.match(css,/\.sidebar-nav\s*\{[^}]*display:grid[^}]*gap:8px/);
  assert.match(css,/\.tool-button:last-child\s*\{[^}]*grid-column:1 \/ -1/);
  assert.match(css,/\.tool-button\s*\{[^}]*min-height:44px/);
  assert.match(css,/\.tool-button span\s*\{[^}]*white-space:nowrap/);
  assert.match(css,/\.tool-button \.bi\s*\{[^}]*width:18px[^}]*height:18px/);
});

test("ordinary sidebar helper text has strong contrast on both content and white surfaces",()=>{
  const css=readFileSync(join(__dirname,'../styles.css'),'utf8');
  const token=name=>css.match(new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`))[1];
  const lum=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  for(const fg of ['helper','muted','text']) for(const bg of ['section-bg','panel']) {
    assert.ok((Math.max(lum(token(fg)),lum(token(bg)))+.05)/(Math.min(lum(token(fg)),lum(token(bg)))+.05)>=7, `${fg} on ${bg}`);
  }
  assert.match(css,/\.panel \.note\s*\{[^}]*font-size:13px/);
});
