"use strict";

/*
 * 3D voxel PM2.5 viewer.
 *
 * Data comes from the same-origin NestJS API. The API loads verified Python
 * artifacts into PostGIS and returns a compact uint8 volume for rendering.
 *
 * Arrays are [z, y, x] flattened in C order: index = (k * ny + j) * nx + i,
 * with y increasing northward and x eastward.
 */

let M = null;
let GRID = null;
let AVAILABLE_SCENARIOS = [];

const SCENARIO_NAMES = {
  dry_nov_apr: "Mùa khô",
  wet_may_oct: "Mùa mưa",
};

const MODEL_NOTES = {
  gaussian:
    "Mô hình tham chiếu, không xét cản trở của tòa nhà.",
  fv: "Mô phỏng phát tán theo độ cao, có xét hình khối tòa nhà.",
};

const THRESHOLD_COLOURS = {
  qcvn_24h: [165, 102, 92],
  who_24h: [174, 146, 91],
};

// Sequential concentration ramp: light cream (low) to dark wine (high).
// These are relative log concentration colours, NOT AQI health categories.
const RAMP = [
  [0.0, [248, 238, 211]],
  [0.2, [237, 213, 163]],
  [0.4, [216, 175, 122]],
  [0.6, [194, 132, 95]],
  [0.8, [159, 88, 77]],
  [1.0, [112, 53, 65]],
];

const state = {
  scenario: null,
  layer: 0,
  thresholds: {},
  multiplier: 1,
  background: 0,
  selected: null,
  mapMode: "pan",
  showBuildings: true,
  showFacades: true,
  showRoads: false,
  showWind: true,
  showGrid: true,
  windPaused: false,
};

const cache = {};
const queryCache = new Map();
let queryTimer;
let pendingSelection = 0;
let trackingRun = false;
let retryAction = null;
let activeRunId = sessionStorage.getItem("voxel-active-run");
let map = null;
let overlay = null;
let spatialAnalysis = null;
let sidebar = null;
let heightMarkControl = null;
let nodes = null;
let cells = null;
let gridLines = [];
let windFlow = null;
let windParticles = [];
let windFlowKey = null;
let sceneLayers = [];
let buildingAppearance = null;
let windAnimationFrame = null;
let lastWindFrame = 0;
let basemapFallback = false;
let basemapTimer = null;
let tileErrors = 0;
let basemapError = false;
const VECTOR_BASEMAP = 'https://tiles.openfreemap.org/styles/positron';
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = (id) => document.getElementById(id);

main();

// --------------------------------------------------------------------------
// start-up
// --------------------------------------------------------------------------

async function main() {
  // Trợ giúp hoạt động ngay cả khi API chưa tải xong hoặc đang mất kết nối.
  if (typeof ViewerHelp !== 'undefined') ViewerHelp.mount(document);
  try {
    await loadBootstrap();
  } catch (error) {
    $('run-note').textContent='Chưa tải được dữ liệu ứng dụng.';
    $('height-slider').disabled=true;
    $('scenario-list').disabled=true;
    $('wind-hud').hidden=true;
    setStatus(error.message, "error",()=>location.reload());
    return;
  }

  nodes = buildNodes();
  cells = buildCells();
  gridLines = ViewerGrid.lines(GRID,node);

  state.scenario = M.scenarios.find((run) => run.model === "fv" && !run.warnings.some((w) => /mock run/.test(w)))?.id
    || M.scenarios.find((run) => run.model === "fv")?.id || M.scenarios[0]?.id || null;
  Object.keys(M.thresholds).forEach((key) => (state.thresholds[key] = false));

  if (typeof ViewerSidebar !== 'undefined') sidebar=ViewerSidebar.mount(document,id=>{
    if(id!=='spatial-analysis' && spatialAnalysis?.isDrawing()) spatialAnalysis.cancelDrawing();
    spatialAnalysis?.onToolChange(id);
  });
  buildControls();
  if (activeRunId) trackRun(activeRunId);

  if (typeof maplibregl === "undefined" || typeof deck === "undefined") {
    setStatus("Không tải được MapLibre hoặc deck.gl từ CDN (cần mạng)", "error",()=>location.reload());
    return;
  }

  createMap();
  if (typeof ViewerAnalysis !== 'undefined') {
    spatialAnalysis=ViewerAnalysis.mount({document,map,deck,api,redraw:()=>renderLayers(),context:()=>({
      id:state.scenario,z:GRID.z_centres_m[state.layer],height:GRID.nz*GRID.dz_m,
      modified:state.multiplier!==1 || state.background!==0,
      runs:M.scenarios.map(run=>({id:run.id,label:scenarioLabel(run)})),
    })});
  }
  if (state.scenario) {
    loadScenario(state.scenario).then(() => {
      setStatus("Đã tải run từ API", "pass");
      refresh();
    }).catch((error) => setStatus(error.message, "error",()=>selectResult(state.scenario)));
  } else {
    setStatus("Chọn kịch bản và chạy để tạo kết quả.");
    refresh();
  }
}

async function api(path, options) {
  return ViewerApi.request(fetch,`/api${path}`,options);
}

async function loadBootstrap() {
  const [areas, scenarios, thresholds, runs] = await Promise.all([
    api("/study-areas"),
    api("/scenarios"),
    api("/thresholds"),
    api("/runs?status=succeeded&limit=20"),
  ]);
  if (!areas.length) throw new Error("DB chưa có study area; chạy db:seed");
  const area = areas[0];
  const scene = await api(`/study-areas/${area.id}/scene`);
  window.VOXEL_BUILDINGS = scene.buildings;
  window.VOXEL_ROADS = scene.roads;
  window.VOXEL_WATER = scene.water;
  window.VOXEL_GREEN = scene.green;
  buildingAppearance=BuildingAppearance.build(scene.buildings);
  AVAILABLE_SCENARIOS = scenarios;
  const [west, south, east, north] = area.bounds;
  GRID = {
    ...area.grid,
    z_centres_m: Array.from({ length: area.grid.nz }, (_, k) => (k + 0.5) * area.grid.dz_m),
  };
  M = {
    grid: GRID,
    corners_wgs84: { sw: [west, south], se: [east, south], ne: [east, north], nw: [west, north] },
    scenarios: runs.map((run) => ({
      id: run.run_id,
      scenario_id: run.scenario_id,
      name: run.scenario_name,
      wind_from_deg: run.wind_from_deg,
      wind_speed_m_s: run.wind_speed_m_s,
      model: run.model,
      model_version: run.model_version,
      warnings: run.warnings || [],
    })),
    thresholds: Object.fromEntries(thresholds.map((item) => [item.key, { value: item.value_ug_m3, label: item.label }])),
    provenance: area.provenance || {},
    units: "µg/m³",
    pollutant: "PM2.5 passive scalar",
  };
}

function buildNodes() {
  // Grid nodes, bilinear in the four exported corners (checked against pyproj
  // in tests/test_web_export.py).
  const { nx, ny } = GRID;
  const c = M.corners_wgs84;
  const lon = new Float64Array((nx + 1) * (ny + 1));
  const lat = new Float64Array((nx + 1) * (ny + 1));

  for (let j = 0; j <= ny; j += 1) {
    const t = j / ny;
    for (let i = 0; i <= nx; i += 1) {
      const s = i / nx;
      const n = j * (nx + 1) + i;
      lon[n] = (1 - s) * (1 - t) * c.sw[0] + s * (1 - t) * c.se[0] + s * t * c.ne[0] + (1 - s) * t * c.nw[0];
      lat[n] = (1 - s) * (1 - t) * c.sw[1] + s * (1 - t) * c.se[1] + s * t * c.ne[1] + (1 - s) * t * c.nw[1];
    }
  }

  return { lon, lat };
}

function buildCells() {
  const list = [];
  for (let j = 0; j < GRID.ny; j += 1) {
    for (let i = 0; i < GRID.nx; i += 1) {
      list.push({ i, j });
    }
  }
  return list;
}

function node(i, j) {
  const n = j * (GRID.nx + 1) + i;
  return [nodes.lon[n], nodes.lat[n]];
}

function geoAt(s, t) {
  const c = M.corners_wgs84;
  const x = ((s % 1) + 1) % 1;
  const y = ((t % 1) + 1) % 1;
  return [
    (1 - x) * (1 - y) * c.sw[0] + x * (1 - y) * c.se[0] + x * y * c.ne[0] + (1 - x) * y * c.nw[0],
    (1 - x) * (1 - y) * c.sw[1] + x * (1 - y) * c.se[1] + x * y * c.ne[1] + (1 - x) * y * c.nw[1],
  ];
}

// --------------------------------------------------------------------------
// data
// --------------------------------------------------------------------------

function scenarioEntry(id) {
  return M.scenarios.find((s) => s.id === id);
}

function loadScenario(id) {
  if (cache[id]) {
    return Promise.resolve(cache[id]);
  }

  const entry = scenarioEntry(id);
  if (!entry) return Promise.reject(new Error(`Không tìm thấy run ${id}`));
  setStatus(`Đang tải run ${id.slice(0, 8)} từ API…`);
  return Promise.all([
    api(`/runs/${id}/volume`),
    api(`/runs/${id}/summary`),
    api(`/runs/${id}/artifacts`).then(async (result) => {
      const artifact = result.artifacts.find((item) => item.kind === 'wind_vectors');
      if (!artifact) return null;
      const field = await api(`/runs/${id}/artifacts/wind_vectors/download`);
      if (field.run_id !== id || field.units !== 'm s-1') throw new Error('Trường gió không khớp kết quả');
      return field;
    }).catch(() => null),
  ]).then(([payload, summary, windField]) => {
    entry.windField = windField;
    entry.scale = payload.scale;
    payload.layer_mean_ug_m3 = summary.layers.map((layer) => layer.mean_ug_m3);
    payload.exceedance_volume_by_layer_m3 = Object.fromEntries(
      summary.thresholds.map((threshold) => [threshold.key, [threshold.exceedance_volume_m3]]),
    );
    entry.summary = summary;
    cache[id] = decode(entry, payload);
    return cache[id];
  });
}

function decode(entry, payload) {
  const binary = atob(payload.codes_base64);
  const codes = new Uint8Array(binary.length);
  for (let n = 0; n < binary.length; n += 1) {
    codes[n] = binary.charCodeAt(n);
  }

  const { c_max: cMax, decades, levels, first_code: first } = entry.scale;
  const lut = new Float64Array(256);
  lut[0] = NaN;
  lut[1] = 0;
  const logMin = Math.log10(cMax) - decades;
  for (let code = first; code < 256; code += 1) {
    lut[code] = cMax > 0 ? 10 ** (logMin + ((code - first) / levels) * decades) : 0;
  }

  return { entry, payload, codes, lut, domainExceedance: null };
}

function current() {
  return cache[state.scenario];
}

function voxelIndex(k, j, i) {
  return (k * GRID.ny + j) * GRID.nx + i;
}

// C = k * C_model + background; NaN (a building) stays NaN.
function effective(raw) {
  return Number.isNaN(raw) ? NaN : state.multiplier * raw + state.background;
}

function value(k, j, i) {
  const d = current();
  return effective(d.lut[d.codes[voxelIndex(k, j, i)]]);
}

function colourScale() {
  const data = current();
  const cMax = data?.entry.scale.c_max || 1;
  const decades = data?.entry.scale.decades || 4;
  const hi = state.multiplier * cMax + state.background;
  let lo = Math.max(hi / 10 ** decades, state.background);
  if (!(lo < hi)) {
    lo = hi / 10;
  }
  return { lo, hi };
}

function ramp(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let n = 1; n < RAMP.length; n += 1) {
    if (x <= RAMP[n][0]) {
      const [x0, c0] = RAMP[n - 1];
      const [x1, c1] = RAMP[n];
      const f = (x - x0) / (x1 - x0);
      return c0.map((v, m) => Math.round(v + f * (c1[m] - v)));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function position(v, scale) {
  return (Math.log10(v) - Math.log10(scale.lo)) / (Math.log10(scale.hi) - Math.log10(scale.lo));
}

function activeThresholds() {
  // QCVN before WHO: the stricter colour wins where both are exceeded.
  return Object.keys(M.thresholds)
    .filter((key) => state.thresholds[key])
    .map((key) => ({ key, ...M.thresholds[key] }))
    .sort((a, b) => b.value - a.value);
}

function cellColour(cell, scale, thresholds) {
  const v = value(state.layer, cell.j, cell.i);

  if (Number.isNaN(v) || v <= 0) {
    return [0, 0, 0, 0];
  }

  if (thresholds.length) {
    const hit = thresholds.find((t) => v > t.value);
    if (hit) {
      return [...(THRESHOLD_COLOURS[hit.key] || [103, 114, 106]), 235];
    }
    return [...ramp(position(v, scale)), 70];
  }

  if (v < scale.lo) {
    return [...ramp(0), 60];
  }

  return [...ramp(position(v, scale)), 215];
}

// --------------------------------------------------------------------------
// statistics (W7)
// --------------------------------------------------------------------------

function exactMode() {
  return state.multiplier === 1 && state.background === 0;
}

function layerStats() {
  const d = current();
  if (!d) return { air: 0, max: NaN, mean: NaN, area: {} };
  const k = state.layer;
  if (exactMode()) {
    const layer = d.entry.summary.layers.find((item) => item.k === k);
    const areas = queryCache.get(`area:${state.scenario}:${k}`);
    return { air: layer?.air_cells || 0, max: layer?.max_ug_m3 ?? NaN,
      mean: layer?.mean_ug_m3 ?? NaN, area: areas || {} };
  }
  const { dx_m: dx, dy_m: dy } = GRID;
  let air = 0;
  let max = -Infinity;
  const above = {};
  Object.keys(M.thresholds).forEach((key) => (above[key] = 0));

  for (let j = 0; j < GRID.ny; j += 1) {
    for (let i = 0; i < GRID.nx; i += 1) {
      const v = value(k, j, i);
      if (Number.isNaN(v)) continue;
      air += 1;
      if (v > max) max = v;
      Object.entries(M.thresholds).forEach(([key, t]) => {
        if (v > t.value) above[key] += 1;
      });
    }
  }

  const rawMean = d.payload.layer_mean_ug_m3[k];
  const mean = rawMean === null ? NaN : state.multiplier * rawMean + state.background;
  const area = {};
  Object.keys(above).forEach((key) => (area[key] = above[key] * dx * dy));

  return { air, max, mean, area };
}

function domainExceedance() {
  const d = current();
  if (!d) return {};
  const key = `${state.multiplier}|${state.background}`;

  if (d.domainExceedance && d.domainExceedance.key === key) {
    return d.domainExceedance.volume;
  }

  const volume = {};
  const cellVolume = GRID.dx_m * GRID.dy_m * GRID.dz_m;

  Object.entries(M.thresholds).forEach(([name, t]) => {
    if (exactMode()) {
      volume[name] = d.payload.exceedance_volume_by_layer_m3[name].reduce((a, b) => a + b, 0);
      return;
    }
    let count = 0;
    for (let n = 0; n < d.codes.length; n += 1) {
      const v = effective(d.lut[d.codes[n]]);
      if (v > t.value) count += 1;
    }
    volume[name] = count * cellVolume;
  });

  d.domainExceedance = { key, volume };
  return volume;
}

// --------------------------------------------------------------------------
// map and layers
// --------------------------------------------------------------------------

function createMap() {
  const c = M.corners_wgs84;
  const centre = [(c.sw[0] + c.ne[0]) / 2, (c.sw[1] + c.ne[1]) / 2];

  map = new maplibregl.Map({
    container: "map",
    style: VECTOR_BASEMAP,
    center: centre,
    zoom: 16.2,
    pitch: 55,
    bearing: -25,
    maxPitch: 80,
    attributionControl: { compact: true },
  });

  map.dragRotate.enable();
  if (map.touchZoomRotate?.enableRotation) map.touchZoomRotate.enableRotation();

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");
  map.on("error", (event) => {
    console.warn("MapLibre:", event.error || event);
    if (++tileErrors >= 2 && !basemapFallback) useFallbackBasemap();
    else if (basemapFallback) {
      basemapError = true;
      $('basemap-notice').hidden = false;
      $('basemap-message').textContent = 'Chưa tải được nền địa lý. Kiểm tra mạng rồi tải lại.';
    }
  });
  watchBasemap();
  map.on('idle', () => {
    if (map.areTilesLoaded() && !basemapError) $('basemap-notice').hidden = true;
  });

  // Attach deck.gl at once: the data must not wait for basemap tiles, which
  // can be slow or, offline, never arrive.
  const Overlay = deck.MapLibreOverlay || deck.MapboxOverlay;
  const kind = deck.MapLibreOverlay ? "MapLibreOverlay" : "MapboxOverlay";
  overlay = new Overlay({ interleaved: false, layers: [],getCursor:()=>spatialAnalysis?.isDrawing()?'crosshair':state.mapMode==='cell'?'default':'grab',effects:[BuildingAppearance.lighting(deck)],getTooltip:info=>{
    // Chỉ xem thông tin ô sau khi bấm chọn, không bật bảng nổi khi rê chuột.
    if(info.layer?.id==='concentration' || info.layer?.id?.startsWith('analysis-comparison')) return null;
    const id=info.object?.properties?.source_feature_id || info.object?.id;
    const building=buildingAppearance?.features.get(id);
    return building ? `${id}\n${fmt(building.height)} m · Mặt đứng minh họa` : null;
  }});
  map.addControl(overlay);
  $('map-pan-mode').addEventListener('click',()=>setMapMode('pan'));
  $('map-cell-mode').addEventListener('click',()=>setMapMode('cell'));
  refresh();

  resetView(0);

  map.once("load", () => {
    setStatus("", "pass");
  });
  map.on("rotate", updateCameraControls);
  map.on("pitch", updateCameraControls);
  map.on("zoomend", () => renderLayers());
  updateCameraControls();
  startWindAnimation();
}

function resetView(duration = 450) {
  if (!map) return;
  const c=M.corners_wgs84;
  const mobile=window.matchMedia('(max-width: 640px)').matches;
  map.fitBounds([c.sw,c.ne],{maxZoom:mobile ? 15.8 : 16.4,bearing:-25,pitch:mobile ? 45 : 55,
    padding:mobile ? {top:130,bottom:Math.round(window.innerHeight*.56),left:50,right:50}
      : {top:110,bottom:80,left:$('panel').offsetWidth+50,right:90},
    duration:reducedMotion.matches ? 0 : duration});
}

function watchBasemap() {
  clearTimeout(basemapTimer);
  basemapTimer=setTimeout(() => {
    if (basemapError || !map.isStyleLoaded() || !map.areTilesLoaded() || (!basemapFallback && map.queryRenderedFeatures().length===0)) {
      if (!basemapFallback) useFallbackBasemap();
      else {
        $('basemap-notice').hidden=false;
        $('basemap-message').textContent='Nền địa lý chưa tải xong. Kiểm tra mạng hoặc tải lại.';
      }
    }
  },12000);
}

function useFallbackBasemap() {
  basemapFallback=true;
  basemapError=false;
  $('basemap-style').value='raster';
  $('basemap-notice').hidden=false;
  $('basemap-message').textContent='Đang tải nền địa lý dự phòng…';
  map.setStyle(ViewerFlow.rasterStyle());
  watchBasemap();
}

function concentrationLayer() {
  if (spatialAnalysis?.active()) return null;
  if (!current()) return null;
  const z = GRID.z_centres_m[state.layer];
  const scale = colourScale();
  const thresholds = activeThresholds();
  const key = [state.scenario, state.layer, state.multiplier, state.background, thresholds.map((t) => t.key).join()];

  return new deck.SolidPolygonLayer({
    id: "concentration",
    data: cells,
    extruded: false,
    pickable: state.mapMode === 'cell' && !spatialAnalysis?.isDrawing(),
    getPolygon: (cell) => [
      [...node(cell.i, cell.j), z],
      [...node(cell.i + 1, cell.j), z],
      [...node(cell.i + 1, cell.j + 1), z],
      [...node(cell.i, cell.j + 1), z],
    ],
    getFillColor: (cell) => cellColour(cell, scale, thresholds),
    updateTriggers: { getPolygon: [z], getFillColor: key },
    onClick: (info) => {
      if (state.mapMode !== 'cell' || spatialAnalysis?.isDrawing()) return;
      if (info.object) {
        selectCell(info.object.i,info.object.j);
      }
    },
    parameters: { depthWriteEnabled: false },
  });
}

function buildingLayer() {
  return new deck.GeoJsonLayer({
    id: "buildings",
    data: window.VOXEL_BUILDINGS,
    visible: state.showBuildings,
    extruded: true,
    filled: true,
    wireframe: false,
    opacity: state.showFacades ? 1 : .55,
    getElevation: (f) => f.properties.height_m,
    getFillColor: BuildingAppearance.material,
    getLineColor: [199, 207, 206],
    material: BuildingAppearance.WALL_MATERIAL,
    pickable:state.mapMode === 'pan' && !spatialAnalysis?.isDrawing(),
    onClick:(info)=>{if(info.object) showBuildingAppearance(info.object.properties.source_feature_id);},
  });
}

function showBuildingAppearance(id) {
  if(spatialAnalysis?.isDrawing()) return;
  const info=buildingAppearance.features.get(id);
  if(!info) return;
  $('building-appearance-note').textContent=`Tòa nhà đã chọn · ${fmt(info.height)} m`;
  sidebar?.open('map-options');
}

function facadeLayers() {
  if(!buildingAppearance) return [];
  const visible=state.showBuildings && state.showFacades;
  const detailOpacity=BuildingAppearance.detailOpacity(map?.getZoom());
  return [new deck.SolidPolygonLayer({id:'facade-sills',data:buildingAppearance.frames,
    visible,opacity:detailOpacity*.65,_full3d:true,getPolygon:d=>d.polygon,getFillColor:d=>d.color,material:false}),
    new deck.SolidPolygonLayer({id:'facade-windows',data:buildingAppearance.windows,
    visible,opacity:detailOpacity,_full3d:true,getPolygon:d=>d.polygon,getFillColor:d=>d.color,
    material:false,pickable:state.mapMode === 'pan' && !spatialAnalysis?.isDrawing(),onClick:info=>{if(info.object) showBuildingAppearance(info.object.id);}})];
}

function roadLayer() {
  return new deck.GeoJsonLayer({
    id: "roads",
    data: window.VOXEL_ROADS || { type: "FeatureCollection", features: [] },
    visible: state.showRoads,
    stroked: true,
    filled: false,
    lineWidthUnits: "meters",
    getLineWidth: (f) => 1 + 250 * f.properties.emission_share,
    getLineColor: [107, 126, 116, 200],
  });
}

function ensureWindFlow() {
  const key=`${state.scenario}:${state.layer}`;
  const data=current();
  if (key===windFlowKey && windFlow) return;
  windFlowKey=key;
  windFlow=ViewerFlow.createField(data?.entry.windField,GRID,(x,y,z)=>{
    const i=Math.floor(x/GRID.dx_m),j=Math.floor(y/GRID.dy_m),k=Math.floor(z/GRID.dz_m);
    return data.codes[(k*GRID.ny+j)*GRID.nx+i]!==0;
  });
  windParticles=ViewerFlow.createParticles(windFlow,state.layer);
}

function windVectors() {
  if (!windFlow) return [];
  return windParticles.flatMap((particle) => {
    const points=ViewerFlow.streamlet(windFlow,particle);
    if(points.length<3) return [];
    const path=points.map(([x,y,z])=>[...geoAt(x/(GRID.nx*GRID.dx_m),y/(GRID.ny*GRID.dy_m)),z+.15]);
    return path.slice(1).map((point,index)=>{
      const t=(index+.5)/(path.length-1);
      // Fade both ends, brighter toward the moving head, without arrowheads.
      const envelope=Math.pow(Math.sin(Math.PI*t),.7)*(.3+.7*t);
      return {path:[path[index],point],alpha:Math.round(220*particle.fade*envelope),width:.6+1.1*envelope};
    });
  });
}

function windLayers(timeMs) {
  const data = windVectors(timeMs);
  return [
    new deck.PathLayer({
      id: "wind-trails",
      data,
      visible: state.showWind,
      getPath: (item) => item.path,
      getColor: (item)=>[112,156,170,Math.round(item.alpha*.3)],
      getWidth: (item)=>item.width+2,
      widthUnits: "pixels",
      jointRounded:true,capRounded:true,
      parameters: { depthWriteEnabled: false },
    }),
    new deck.PathLayer({
      id: 'wind-streamlets', data, visible: state.showWind,
      getPath: (item) => item.path, getColor: (item)=>[248,253,255,item.alpha],
      getWidth: (item)=>item.width, widthUnits: 'pixels',jointRounded:true,capRounded:true,
      parameters: { depthWriteEnabled: false },
    }),
  ];
}

function waterLayer() {
  return new deck.GeoJsonLayer({
    id: "water",
    data: window.VOXEL_WATER || { type: "FeatureCollection", features: [] },
    stroked: false,
    filled: true,
    getFillColor: [14, 116, 144, 150],
  });
}

function greenLayer() {
  return new deck.GeoJsonLayer({
    id: "green",
    data: window.VOXEL_GREEN || { type: "FeatureCollection", features: [] },
    stroked: false,
    filled: true,
    getFillColor: [127, 151, 115, 95],
  });
}

function selectionLayer() {
  if (!state.selected || !current()) {
    return null;
  }
  return new deck.PathLayer({
    id: "selection",
    data: [{ path: ViewerGrid.outline(state.selected,node,GRID.z_centres_m[state.layer]+.08) }],
    getPath: (d) => d.path,
    getColor: [66, 106, 133, 255],
    getWidth: 2.5,
    widthUnits: "pixels",
    pickable:false,
    parameters:{depthWriteEnabled:false},
  });
}

function voxelGridLayer() {
  if(!current() || !state.showGrid) return null;
  const z=GRID.z_centres_m[state.layer]+.04;
  return new deck.PathLayer({id:'voxel-grid',data:gridLines,
    getPath:d=>d.path.map(p=>[...p,z]),getColor:d=>[75,95,109,d.major?115:58],
    getWidth:d=>d.major?1:.5,widthUnits:'pixels',pickable:false,
    updateTriggers:{getPath:[z]},parameters:{depthWriteEnabled:false}});
}

function selectCell(i,j) {
  if (spatialAnalysis?.isDrawing()) return;
  if(!current() || !ViewerGrid.validCell(GRID,i,j)) return false;
  state.selected={i,j};
  sidebar?.open('analysis-details');
  refresh();
  return true;
}

function updateCellInfo() {
  const box=$('cell-info');
  box.hidden=!state.selected || !current();
  if(box.hidden) return;
  const {i,j}=state.selected, k=state.layer;
  const profile=queryCache.get(`profile:${state.scenario}:${i}:${j}`);
  const v=exactMode()?profile?.levels[k]?.concentration_ug_m3:value(k,j,i);
  const reading=exactMode() && !profile ? 'Đang truy vấn nồng độ…'
    : Number.isFinite(v) ? `${fmt(v)} µg/m³ · ${exactMode()?'dữ liệu truy vấn':'ước tính điều chỉnh'}`
    : 'Ô công trình — không có nồng độ khí';
  box.textContent=`Ô i=${i}, j=${j} · tầng k=${k}\nCao ${fmt(GRID.z_centres_m[k])} m · ${fmt(GRID.dx_m)} × ${fmt(GRID.dy_m)} m\n${reading}`;
}

// --------------------------------------------------------------------------
// UI
// --------------------------------------------------------------------------

function compass(deg) {
  const labels = ["B", "BĐB", "ĐB", "ĐĐB", "Đ", "ĐĐN", "ĐN", "NĐN", "N", "NTN", "TN", "TTN", "T", "TTB", "TB", "BTB"];
  return labels[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

function renderLayers(timeMs = performance.now()) {
  if (!overlay) return;
  syncMapMode();
  ensureWindFlow();
  sceneLayers = [
      waterLayer(),
      greenLayer(),
      roadLayer(),
      concentrationLayer(),
      ...(spatialAnalysis?.layers(GRID.z_centres_m[state.layer]) || []),
      voxelGridLayer(),
      buildingLayer(),
      ...facadeLayers(),
      selectionLayer(),
    ].filter(Boolean);
  renderWindFrame(timeMs);
}

// Chế độ chọn ô tắt kéo bằng nút trái; thao tác vẽ vùng/tuyến được ưu tiên riêng.
// Đồng bộ khi redraw để kết thúc vẽ trở về đúng chế độ trước đó.
function setMapMode(mode) {
  if (spatialAnalysis?.isDrawing()) return;
  state.mapMode = mode;
  renderLayers();
}

function syncMapMode() {
  const drawing = Boolean(spatialAnalysis?.isDrawing());
  const picking = state.mapMode === 'cell';
  $('map-pan-mode').setAttribute('aria-pressed',String(!picking));
  $('map-cell-mode').setAttribute('aria-pressed',String(picking));
  $('map-pan-mode').disabled = drawing;
  $('map-cell-mode').disabled = drawing;
  if (picking || drawing) map.dragPan.disable(); else map.dragPan.enable();
  map.getCanvas().style.cursor = drawing ? 'crosshair' : picking ? 'default' : '';
}

function renderWindFrame(timeMs) {
  overlay?.setProps({layers:[...sceneLayers,...windLayers(timeMs)]});
  $('wind-hud').dataset.frame=String(Math.round(timeMs));
}

function startWindAnimation() {
  if (windAnimationFrame !== null) cancelAnimationFrame(windAnimationFrame);
  windAnimationFrame = null;
  lastWindFrame=0;
  if (!state.showWind || state.windPaused || reducedMotion.matches || document.hidden || !windFlow) return;
  function frame(now) {
    const dt=lastWindFrame ? Math.min((now-lastWindFrame)/1000,.1) : 0;
    ViewerFlow.advance(windFlow,windParticles,dt*6);
    lastWindFrame=now;
    renderWindFrame(now);
    windAnimationFrame=requestAnimationFrame(frame);
  }
  windAnimationFrame=requestAnimationFrame(frame);
}

function updateCameraControls() {
  if (!map) return;
  const is3d = map.getPitch() > 5;
  $("toggle-3d").textContent = is3d ? "2D" : "3D";
  $("toggle-3d").setAttribute("aria-label", is3d ? "Chuyển sang góc nhìn 2D" : "Chuyển sang góc nhìn 3D");
  $("toggle-3d").setAttribute("aria-pressed", String(is3d));
  $("toggle-3d").setAttribute("data-pitch", map.getPitch().toFixed(1));
  $("reset-camera").setAttribute("data-bearing", map.getBearing().toFixed(1));
}

function updateWindHud() {
  const entry = scenarioEntry(state.scenario);
  const hud = $("wind-hud");
  if (!entry || !state.showWind || !entry.windField) {
    hud.hidden = true;
    $('wind-source-note').textContent = 'Chưa có dữ liệu gió cho kết quả này.';
    return;
  }
  hud.hidden = false;
  const paused=state.windPaused || reducedMotion.matches;
  $('wind-source-note').textContent = '';
  $('wind-caption').textContent = `Gió solver · ${paused ? 'đã dừng' : 'chuyển động ×6'}`;
  $('wind-motion').setAttribute('aria-pressed',String(paused));
  $('wind-motion').setAttribute('aria-label',paused ? 'Tiếp tục chuyển động gió' : 'Dừng chuyển động gió');
  $('wind-motion').title=paused ? 'Tiếp tục chuyển động gió' : 'Dừng chuyển động gió';
  $('wind-motion').innerHTML=paused ? '<i class="bi bi-play-fill" aria-hidden="true"></i>'
    : '<i class="bi bi-pause-fill" aria-hidden="true"></i>';
  const vectors = entry.windField.layers.find((layer) => layer.k === state.layer)?.vectors || [];
  if (!vectors.length) { hud.hidden = true; return; }
  const u = vectors.reduce((sum,row) => sum + row[4],0) / vectors.length;
  const v = vectors.reduce((sum,row) => sum + row[5],0) / vectors.length;
  const fromDeg = (Math.atan2(-u,-v) * 180 / Math.PI + 360) % 360;
  const toDeg = (fromDeg + 180) % 360;
  $("wind-summary").textContent = `${fmt(Math.hypot(u,v))} m/s · từ ${compass(fromDeg)} (${fromDeg.toFixed(0)}°)`;
  $("wind-arrow").style.transform = `rotate(${toDeg}deg)`;
}

function scenarioLabel(entry) {
  const scenarioId = entry.scenario_id || entry.id;
  const season = Object.keys(SCENARIO_NAMES).find((key) => scenarioId.startsWith(key));
  const name = season ? SCENARIO_NAMES[season] : entry.name || scenarioId;
  const mock = entry.warnings.some((warning) => /mock run/.test(warning));
  return `${name} · ${mock ? "Dữ liệu thử" : entry.model === "fv" ? "Voxel" : "Gaussian"} · ${entry.id.slice(0, 4)}`;
}

function buildControls() {
  $('grid-size').textContent=`Ô ${fmt(GRID.dx_m)} × ${fmt(GRID.dy_m)} m · lưới ${GRID.nx} × ${GRID.ny}`;
  $('show-grid').addEventListener('change',event=>{state.showGrid=event.target.checked;renderLayers();});
  $('status-retry').onclick=()=>retryAction?.();
  $('query-retry').onclick=()=>scheduleExactQueries();
  $('run-retry').onclick=()=>{if(activeRunId) trackRun(activeRunId);};
  const scenarioSelect = $("new-run-scenario");
  AVAILABLE_SCENARIOS.forEach((scenario) => {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = `${SCENARIO_NAMES[scenario.id] || scenario.name} · ${fmt(scenario.wind_speed_m_s)} m/s`;
    scenarioSelect.appendChild(option);
  });
  $("run-button").addEventListener("click", createRun);
  $("run-button").disabled = !AVAILABLE_SCENARIOS.length || Boolean(activeRunId);
  $("run-note").textContent = M.scenarios.length
    ? ""
    : "Chưa có kết quả. Mở Mô phỏng để bắt đầu.";

  const list = $("scenario-list");
  M.scenarios.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = scenarioLabel(entry);
    list.appendChild(option);
  });
  list.value = state.scenario || "";
  list.disabled = !M.scenarios.length;
  if (!M.scenarios.length) list.add(new Option("Chưa có kết quả", ""));
  list.addEventListener('change',event=>selectResult(event.target.value));

  const thresholds = $("threshold-list");
  Object.entries(M.thresholds).forEach(([key, t]) => {
    // Một thẻ chứa cả thao tác tô bản đồ và hai số liệu của cùng ngưỡng.
    // Không dựng lại checkbox khi đổi tầng để giữ focus và trạng thái bàn phím.
    const card = document.createElement("section");
    card.className = "threshold-card";
    const label = document.createElement("label");
    label.className = "threshold-choice";
    const colour = THRESHOLD_COLOURS[key] || [103, 114, 106];
    label.innerHTML = `<input type="checkbox"/> <span class="swatch" style="background: rgb(${colour.join(",")})"></span><span class="threshold-name"></span><span class="threshold-limit"></span>`;
    label.querySelector("input").value = key;
    label.querySelector(".threshold-name").textContent = key.startsWith("qcvn") ? "QCVN" : key.startsWith("who") ? "WHO" : t.label;
    label.querySelector(".threshold-limit").textContent = `${fmt(t.value)} µg/m³`;
    label.title = t.label;
    label.querySelector("input").setAttribute("aria-label", `Tô vùng vượt ${t.label}: ${fmt(t.value)} µg/m³`);
    label.querySelector("input").addEventListener("change", (event) => {
      state.thresholds[key] = event.target.checked;
      refresh();
    });
    card.appendChild(label);
    const reading = document.createElement("p");
    reading.className = "threshold-outcome";
    reading.id = `threshold-outcome-${key}`;
    reading.textContent = "Đang tải số liệu…";
    card.appendChild(reading);
    thresholds.appendChild(card);
  });

  const slider = $("height-slider");
  slider.max = String(GRID.nz - 1);
  if (typeof ViewerSidebar !== 'undefined') {
    heightMarkControl=ViewerSidebar.heightMarks(document,slider,GRID.z_centres_m,index=>{
      state.layer=index;
      refresh();
    });
  }
  slider.addEventListener("input", (event) => {
    state.layer = Number(event.target.value);
    refresh();
  });

  $("multiplier").addEventListener("change", (event) => {
    state.multiplier = Number(event.target.value);
    refresh();
  });
  $('illustration-reset').addEventListener('click',()=>{
    state.multiplier=1;state.background=0;
    $('multiplier').value='1';$('background').value='0';refresh();
  });

  $("background").addEventListener("change", (event) => {
    const v = Number(event.target.value);
    state.background = Number.isFinite(v) && v >= 0 ? v : 0;
    event.target.value = String(state.background);
    refresh();
  });

  $("show-buildings").addEventListener("change", (event) => {
    state.showBuildings = event.target.checked;
    refresh();
  });

  $("show-roads").addEventListener("change", (event) => {
    state.showRoads = event.target.checked;
    refresh();
  });
  $('show-facades').addEventListener('change',event=>{
    state.showFacades=event.target.checked;
    refresh();
  });

  $("show-wind").addEventListener("change", (event) => {
    state.showWind = event.target.checked;
    refresh();
  });

  $('wind-motion').addEventListener('click',()=>{
    state.windPaused=!state.windPaused;
    refresh();
  });
  reducedMotion.addEventListener('change',()=>refresh());
  document.addEventListener('visibilitychange',()=>startWindAnimation());
  $('basemap-retry').addEventListener('click',()=>{
    tileErrors=0;
    basemapError=false;
    $('basemap-message').textContent='Đang tải lại nền địa lý…';
    map?.setStyle(basemapFallback ? ViewerFlow.rasterStyle() : VECTOR_BASEMAP);
    watchBasemap();
  });
  $('basemap-style').addEventListener('change',(event)=>{
    tileErrors=0;
    basemapError=false;
    if (event.target.value==='raster') useFallbackBasemap();
    else {
      basemapFallback=false;
      $('basemap-notice').hidden=true;
      map?.setStyle(VECTOR_BASEMAP);
      watchBasemap();
    }
  });

  $("rotate-left").addEventListener("click", () => {
    map?.easeTo({ bearing: map.getBearing() - 20, duration: reducedMotion.matches ? 0 : 300 });
  });

  $("rotate-right").addEventListener("click", () => {
    map?.easeTo({ bearing: map.getBearing() + 20, duration: reducedMotion.matches ? 0 : 300 });
  });

  $("reset-camera").addEventListener("click", () => {
    resetView();
  });

  $("toggle-3d").addEventListener("click", () => {
    const pitch = map && map.getPitch() > 5 ? 0 : 55;
    map?.easeTo({ pitch, duration: reducedMotion.matches ? 0 : 350 });
  });

  $("panel-toggle").addEventListener("click", () => {
    const panel = $("panel");
    const collapsed = panel.classList.toggle("collapsed");
    $("panel-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("panel-toggle").setAttribute("aria-label", collapsed ? "Mở bảng điều khiển" : "Thu gọn bảng điều khiển");
  });
}

async function createRun() {
  const button = $("run-button");
  button.disabled = true;
  $("run-error").hidden = true;
  try {
    const accepted = await api("/runs", {
      method: "POST",
      body: JSON.stringify({ scenario_id: $("new-run-scenario").value, model: "fv" }),
    });
    activeRunId = accepted.run_id;
    sessionStorage.setItem("voxel-active-run", activeRunId);
    await trackRun(activeRunId);
  } catch (error) {
    showRunError(error, ['network','timeout'].includes(error.kind)
      ? 'Chưa xác nhận được yêu cầu. Kiểm tra danh sách kết quả trước khi chạy lại để tránh tạo trùng.'
      : 'Chưa tạo được mô phỏng. Vui lòng kiểm tra và thử lại.');
  } finally {
    button.disabled = Boolean(activeRunId);
  }
}

function showRunError(error, message) {
  $("run-note").textContent = message;
  $("run-error").hidden = false;
  $("run-error-detail").textContent = error.message;
  setStatus(message, "error");
}

async function trackRun(id) {
  if(trackingRun) return;
  trackingRun=true;
  $('run-retry').hidden=true;
  $('run-error').hidden=true;
  setStatus('Đang theo dõi mô phỏng…');
  try {
  $("run-button").disabled = true;
  $("run-progress").hidden = false;
  let failures = 0;
  for (;;) {
    try {
      const run = await api(`/runs/${id}`);
      failures = 0;
      const label = { queued: "Đang chờ", running: "Đang tính toán", succeeded: "Hoàn tất", failed: "Không hoàn tất", stale: "Đã gián đoạn" }[run.status] || run.status;
      $("run-note").textContent = `${label}${run.status === "running" ? ` · ${Math.round(run.progress * 100)}%` : ""}`;
      $("run-progress").value = Math.round(run.progress * 100);
      if (["succeeded", "failed", "stale"].includes(run.status)) {
        activeRunId = null;
        sessionStorage.removeItem("voxel-active-run");
        $("run-button").disabled = false;
        $("run-progress").hidden = true;
        if (run.status !== "succeeded") {
          showRunError(new Error(run.error?.message || label), `${label}. Bạn có thể chạy lại.`);
          return;
        }
        const entry = { id, scenario_id: run.scenario.id, name: run.scenario.name,
          wind_from_deg: run.scenario.wind_from_deg, wind_speed_m_s: run.scenario.wind_speed_m_s,
          model: run.model, model_version: run.model_version, warnings: run.warnings || [] };
        if (!scenarioEntry(id)) M.scenarios.unshift(entry);
        const select = $("scenario-list");
        Array.from(select.options).filter((option) => !option.value).forEach((option) => option.remove());
        if (!Array.from(select.options).some((option) => option.value === id)) select.add(new Option(scenarioLabel(entry), id), 0);
        select.disabled = false;
        select.value = id;
        await loadScenario(id);
        state.scenario = id;
        refresh();
        $('run-note').textContent='Hoàn tất · kết quả mới đã hiển thị trên bản đồ.';
        setStatus("Mô phỏng hoàn tất", "pass");
        return;
      }
    } catch (error) {
      if(error.kind==='not-found' && activeRunId===id) {
        activeRunId=null;
        sessionStorage.removeItem('voxel-active-run');
        $('run-progress').hidden=true;
        $('run-button').disabled=!AVAILABLE_SCENARIOS.length;
        showRunError(error,'Không tìm thấy run đã lưu. Bạn có thể chọn kết quả khác hoặc tạo mô phỏng mới.');
        return;
      }
      if (!activeRunId) {
        $('scenario-list').value=state.scenario || '';
        showRunError(error, "Mô phỏng đã xong, chưa tải được kết quả. Chọn lại trong danh sách.");
        setStatus(error.message,'error',()=>selectResult(id));
        return;
      }
      failures += 1;
      $("run-note").textContent = "Mất kết nối · đang kết nối lại…";
      if (failures >= 5) {
        $('run-progress').hidden=true;
        $('run-retry').hidden=false;
        showRunError(error, "Tạm mất kết nối. Mô phỏng có thể vẫn đang chạy; tiếp tục theo dõi, không tạo run mới.");
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  } finally { trackingRun=false; }
}

async function selectResult(id) {
  const token=++pendingSelection;
  $('scenario-list').setAttribute('aria-busy','true');
  try {
    await loadScenario(id);
    if(token!==pendingSelection) return;
    state.scenario=id;
    $('scenario-list').value=id;
    refresh();
    setStatus('Đã tải kết quả','pass');
  } catch(error) {
    if(token!==pendingSelection) return;
    $('scenario-list').value=state.scenario || '';
    setStatus(`Chưa tải được kết quả: ${error.message}`,'error',()=>selectResult(id));
  } finally {
    if(token===pendingSelection) $('scenario-list').setAttribute('aria-busy','false');
  }
}

function fmt(v) {
  if (v === null || Number.isNaN(v) || !Number.isFinite(v)) return "–";
  if (v === 0) return "0";
  return v.toLocaleString("vi-VN", { maximumSignificantDigits: 3 });
}

function fmtVolume(v) {
  return v === 0 ? "0" : `${Math.round(v).toLocaleString("vi-VN")}`;
}

function refresh() {
  $('height-slider').disabled=!current();
  heightMarkControl?.sync();
  for(const id of ['show-grid']) $(id).disabled=!current();
  const entry = scenarioEntry(state.scenario);
  const z = GRID.z_centres_m[state.layer];
  const half = GRID.dz_m / 2;
  $('illustration-reset').hidden=exactMode();
  $('show-facades').disabled=!state.showBuildings;
  $('stats-context').textContent=`Tầng ${fmt(z-half)}–${fmt(z+half)} m${exactMode()?'':' · Minh họa'}`;

  $("height-value").textContent = `${fmt(z)} m`;
  $("height-slider").setAttribute("aria-valuetext", `tầng ${state.layer + 1}: ${fmt(z - half)}–${fmt(z + half)} m`);
  $("model-note").textContent = entry
    ? (MODEL_NOTES[entry.model] || 'Kết quả mô phỏng đang chọn.')
    : "Chưa có run thành công để hiển thị nồng độ.";
  if (typeof ViewerEvidence !== 'undefined') {
    ViewerEvidence.render($("run-evidence"), ViewerEvidence.viewModel(entry?.summary, state.scenario));
  }

  updateLegend();
  spatialAnalysis?.sync();
  updateStats();
  updateProfile();
  scheduleExactQueries();
  updateWindHud();
  renderLayers();
  startWindAnimation();
}

function updateLegend() {
  const scale = colourScale();
  const stops = RAMP.map(([t, c]) => `rgb(${c.join(",")}) ${t * 100}%`).join(", ");
  const legend = $("legend");
  legend.style.background = `linear-gradient(90deg, ${stops})`;
  legend.querySelectorAll(".legend-marker").forEach((el) => el.remove());

  activeThresholds().forEach((t) => {
    const p = position(t.value, scale);
    if (p >= 0 && p <= 1) {
      const marker = document.createElement("span");
      marker.className = "legend-marker";
      marker.style.left = `${p * 100}%`;
      marker.title = t.label;
      legend.appendChild(marker);
    }
  });

  const labels = $("legend-labels");
  labels.innerHTML = "";
  [0, 0.25, 0.5, 0.75, 1].forEach((t) => {
    const span = document.createElement("span");
    span.textContent = fmt(10 ** (Math.log10(scale.lo) + t * (Math.log10(scale.hi) - Math.log10(scale.lo))));
    labels.appendChild(span);
  });

  $("legend-title").textContent = `Nồng độ (µg/m³, thang log)${exactMode() ? "" : ` · × ${state.multiplier} + nền ${fmt(state.background)}`}`;
}

function updateStats() {
  if (!current()) {
    $("stat-mean").textContent = "–";
    $("stat-max").textContent = "–";
    Object.keys(M.thresholds).forEach((key) => {
      $(`threshold-outcome-${key}`).textContent = "Chưa có số liệu.";
    });
    return;
  }
  const s = layerStats();
  $("stat-mean").textContent = fmt(s.mean);
  $("stat-max").textContent = fmt(s.max);

  Object.keys(M.thresholds).forEach((key) => {
    // Diện tích vượt phải xét đúng tầng đang xem. Số 0 là kết quả hợp lệ,
    // còn thiếu phản hồi được báo riêng, không suy thành không vượt ngưỡng.
    const area = s.area[key];
    $(`threshold-outcome-${key}`).textContent = !Number.isFinite(area)
      ? "Đang tải số liệu…"
      : area === 0 ? `Không có ô nào có nồng độ lớn hơn ${fmt(M.thresholds[key].value)} µg/m³ ở tầng này.`
      : `${fmtVolume(area)} m² vượt ngưỡng ở tầng này.`;
  });
}

function updateProfile() {
  updateCellInfo();
  const box = $("profile");
  // Chỉ hiển thị biểu đồ sau khi người dùng bấm chọn ô trên bản đồ.
  $('selected-cell-detail').hidden = !state.selected || !current();

  if (!state.selected || !current()) {
    box.innerHTML = "";
    return;
  }

  const { i, j } = state.selected;
  const z = GRID.z_centres_m;
  const exactProfile = queryCache.get(`profile:${state.scenario}:${i}:${j}`);
  if (exactMode() && !exactProfile) {
    box.textContent = "Đang tải dữ liệu theo độ cao…";
    return;
  }
  const values = exactMode() ? exactProfile.levels.map((level) => level.concentration_ug_m3 === null ? NaN : level.concentration_ug_m3)
    : z.map((_, k) => value(k, j, i));
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);

  const W = 320;
  const H = 280;
  // Chừa chỗ cho tên trục và số lớn hơn, tránh dính nhãn khi SVG co theo sidebar.
  const pad = { l: 60, r: 24, t: 20, b: 58 };
  const scale = colourScale();
  const thresholds = Object.entries(M.thresholds).map(([key, t]) => ({ key, ...t }));
  const hi = Math.max(scale.hi, ...finite, ...thresholds.map((t) => t.value)) * 1.2;
  const lo = Math.min(scale.lo, ...(finite.length ? finite : [scale.lo]));
  const X = (v) => pad.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - pad.l - pad.r);
  const height = GRID.nz * GRID.dz_m;
  const Y = (h) => H - pad.b - (h / height) * (H - pad.t - pad.b);

  let path = "";
  let solid = "";
  values.forEach((v, k) => {
    if (Number.isNaN(v)) {
      solid += `<rect x="${pad.l}" y="${Y(z[k] + 1)}" width="${W - pad.l - pad.r}" height="${Y(z[k] - 1) - Y(z[k] + 1)}" fill="rgba(148,163,184,0.25)"/>`;
      return;
    }
    if (v <= 0) return;
    const cmd = path && !Number.isNaN(values[k - 1]) && values[k - 1] > 0 ? "L" : "M";
    path += `${cmd}${X(v).toFixed(1)},${Y(z[k]).toFixed(1)} `;
  });

  const currentY = Y(z[state.layer]);
  const lines = thresholds
    .map((t) => {
      const colour = THRESHOLD_COLOURS[t.key] || [103, 114, 106];
      return `<line x1="${X(t.value)}" x2="${X(t.value)}" y1="${pad.t}" y2="${H - pad.b}" stroke="rgb(${colour.join(",")})" stroke-dasharray="4 3"/>`;
    })
    .join("");

  const ticks = [];
  const firstExponent = Math.ceil(Math.log10(lo));
  const lastExponent = Math.floor(Math.log10(hi));
  const tickStep = Math.max(1, Math.ceil((lastExponent - firstExponent) / 4));
  for (let e = firstExponent; e <= lastExponent; e += tickStep) {
    const label = Math.abs(e) > 3 ? `10^${e}` : fmt(10 ** e);
    ticks.push(`<text x="${X(10 ** e)}" y="${H - pad.b + 14}" text-anchor="middle">${label}</text>`);
  }

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profile nồng độ theo độ cao tại ô ${i}, ${j}">
      <g fill="#253039" font-size="14" font-family="system-ui, sans-serif">
        ${ticks.join("")}
        <text x="${pad.l - 6}" y="${Y(0) + 3}" text-anchor="end">0</text>
        <text x="${pad.l - 6}" y="${Y(height / 2) + 3}" text-anchor="end">${fmt(height / 2)}</text>
        <text x="${pad.l - 6}" y="${Y(height) + 3}" text-anchor="end">${fmt(height)}</text>
        <text x="${(pad.l + W - pad.r) / 2}" y="${H - 9}" text-anchor="middle" font-weight="600">Nồng độ (µg/m³, log)</text>
        <text transform="translate(16 ${(pad.t + H - pad.b) / 2}) rotate(-90)" text-anchor="middle" font-weight="600">Độ cao (m)</text>
      </g>
      <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="none" stroke="#879ba7"/>
      ${solid}
      ${lines}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${currentY}" y2="${currentY}" stroke="rgba(79,107,93,0.5)"/>
      <path d="${path}" fill="none" stroke="#4f6b5d" stroke-width="2"/>
    </svg>
    <p class="note">Ô ${i}, ${j} · cao nhất ${fmt(Math.max(...finite, 0))} µg/m³</p>`;
}

function scheduleExactQueries() {
  clearTimeout(queryTimer);
  $('query-retry').hidden=true;
  if (!current() || !exactMode()) {
    $("query-note").textContent = current() ? "Ước tính theo điều chỉnh nâng cao" : "";
    return;
  }
  const id = state.scenario;
  const k = state.layer;
  const selected = state.selected && { ...state.selected };
  const areaKey = `area:${id}:${k}`;
  const profileKey = selected && `profile:${id}:${selected.i}:${selected.j}`;
  if (queryCache.has(areaKey) && (!profileKey || queryCache.has(profileKey))) {
    $("query-note").textContent = "";
    return;
  }
  $("query-note").textContent = "Đang tải truy vấn…";
  queryTimer = setTimeout(async () => {
    try {
      const requests = [];
      if (!queryCache.has(areaKey)) requests.push(Promise.all(Object.keys(M.thresholds).map(async (key) => {
        const result = await api(`/runs/${id}/exceedance?z_m=${GRID.z_centres_m[k]}&threshold_key=${encodeURIComponent(key)}`);
        return [key, result.area_m2];
      })).then((entries) => queryCache.set(areaKey, Object.fromEntries(entries))));
      if (profileKey && !queryCache.has(profileKey)) requests.push(api(`/runs/${id}/profile?i=${selected.i}&j=${selected.j}`)
        .then((result) => queryCache.set(profileKey, result)));
      await Promise.all(requests);
      if (state.scenario !== id || state.layer !== k || !exactMode() || (profileKey && (state.selected?.i!==selected.i || state.selected?.j!==selected.j))) return;
      updateStats();
      updateProfile();
      $("query-note").textContent = "";
    } catch (error) {
      if (state.scenario !== id || state.layer !== k || !exactMode() || (profileKey && (state.selected?.i!==selected.i || state.selected?.j!==selected.j))) return;
      $("query-note").textContent = `Chưa tải đủ truy vấn: ${error.message}`;
      $('query-retry').hidden=false;
      if (profileKey && !queryCache.has(profileKey)) {
        $("profile").textContent = "Chưa tải được dữ liệu theo độ cao.";
        $('cell-info').textContent=`Ô i=${selected.i}, j=${selected.j} · k=${k}\nChưa tải được nồng độ. Bấm Thử lại truy vấn trong bảng bên trái.`;
      }
    }
  }, 180);
}

function setStatus(text, kind, retry=null) {
  retryAction=retry;
  $('status-retry').hidden=!retry;
  $('status-retry').onclick=()=>retryAction?.();
  $("status-box").hidden = !text || (kind === 'pass' && /Đã tải/.test(text));
  const el = $("status");
  el.textContent = text;
  el.className = kind || "";
}
