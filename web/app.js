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
  dry_nov_apr: "Mùa khô (tháng 11–4)",
  wet_may_oct: "Mùa mưa (tháng 5–10)",
};

const MODEL_NOTES = {
  gaussian:
    "Baseline Gaussian (Briggs đô thị) trên nguồn đường thật: chùm khói đi XUYÊN qua nhà — không có hiệu ứng toà nhà. Dùng để so với mô hình voxel.",
  fv: "Mô hình voxel: gió chẩn đoán bảo toàn khối lượng + tải–khuếch tán thể tích hữu hạn.",
};

const THRESHOLD_COLOURS = {
  qcvn_24h: [208, 59, 59],
  who_24h: [250, 178, 25],
};

// Single-hue sequential ramp, light (low) to dark (high) - the same blue
// steps as the report figures (src/analysis/figures.py). Threshold colours
// are reserved status colours, so they never read as "more of the ramp".
const RAMP = [
  [0.0, [205, 226, 251]],
  [0.2, [134, 182, 239]],
  [0.4, [57, 135, 229]],
  [0.6, [37, 106, 191]],
  [0.8, [24, 79, 149]],
  [1.0, [13, 54, 107]],
];

const state = {
  scenario: null,
  layer: 0,
  thresholds: {},
  multiplier: 1,
  background: 0,
  selected: null,
  showBuildings: true,
  showRoads: false,
  showWind: true,
};

const cache = {};
let map = null;
let overlay = null;
let nodes = null;
let cells = null;
let windSeeds = [];
let windAnimationFrame = null;
let lastWindFrame = 0;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = (id) => document.getElementById(id);

main();

// --------------------------------------------------------------------------
// start-up
// --------------------------------------------------------------------------

async function main() {
  try {
    await loadBootstrap();
  } catch (error) {
    setStatus(`Không kết nối được API: ${error.message}`, "error");
    return;
  }

  nodes = buildNodes();
  cells = buildCells();
  windSeeds = buildWindSeeds();

  state.scenario = M.scenarios[0]?.id || null;
  Object.keys(M.thresholds).forEach((key) => (state.thresholds[key] = false));

  buildControls();
  fillProvenance();

  if (typeof maplibregl === "undefined" || typeof deck === "undefined") {
    setStatus("Không tải được MapLibre hoặc deck.gl từ CDN (cần mạng)", "error");
    return;
  }

  createMap();
  if (state.scenario) {
    loadScenario(state.scenario).then(() => {
      setStatus("Đã tải run từ API", "pass");
      refresh();
    }).catch((error) => setStatus(error.message, "error"));
  } else {
    setStatus("Chưa có run thành công · bấm Chạy mô phỏng FV", "error");
    refresh();
  }
}

async function api(path, options) {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload.message) ? payload.message.join("; ") : payload.message;
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return payload;
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

function cellCentre(i, j) {
  const a = node(i, j);
  const b = node(i + 1, j + 1);
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
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

function buildWindSeeds() {
  const seeds = [];
  for (let row = 0; row < 9; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      const n = row * 12 + column;
      seeds.push({
        s: (column + 0.22 + ((n * 37) % 53) / 90) / 12,
        t: (row + 0.2 + ((n * 29) % 47) / 82) / 9,
        phase: ((n * 67) % 101) / 101,
      });
    }
  }
  return seeds;
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
  ]).then(([payload, summary]) => {
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
      return [...(THRESHOLD_COLOURS[hit.key] || [255, 0, 255]), 235];
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
    style: "https://tiles.openfreemap.org/styles/positron",
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
  map.on("error", (event) => console.warn("MapLibre:", event.error || event));

  // Attach deck.gl at once: the data must not wait for basemap tiles, which
  // can be slow or, offline, never arrive.
  const Overlay = deck.MapLibreOverlay || deck.MapboxOverlay;
  const kind = deck.MapLibreOverlay ? "MapLibreOverlay" : "MapboxOverlay";
  overlay = new Overlay({ interleaved: false, layers: [] });
  map.addControl(overlay);
  refresh();

  // On a phone the panel covers the lower half; keep the domain above it.
  if (window.matchMedia("(max-width: 640px)").matches) {
    map.jumpTo({ padding: { bottom: Math.round(window.innerHeight * 0.5) }, zoom: 15.6 });
  }

  map.once("load", () => {
    setStatus(`Sẵn sàng · deck.gl ${deck.VERSION || ""} · ${kind}`, "pass");
  });
  map.on("rotate", updateCameraControls);
  map.on("pitch", updateCameraControls);
  updateCameraControls();
  startWindAnimation();
}

function concentrationLayer() {
  if (!current()) return null;
  const z = GRID.z_centres_m[state.layer];
  const scale = colourScale();
  const thresholds = activeThresholds();
  const key = [state.scenario, state.layer, state.multiplier, state.background, thresholds.map((t) => t.key).join()];

  return new deck.SolidPolygonLayer({
    id: "concentration",
    data: cells,
    extruded: false,
    pickable: true,
    getPolygon: (cell) => [
      [...node(cell.i, cell.j), z],
      [...node(cell.i + 1, cell.j), z],
      [...node(cell.i + 1, cell.j + 1), z],
      [...node(cell.i, cell.j + 1), z],
    ],
    getFillColor: (cell) => cellColour(cell, scale, thresholds),
    updateTriggers: { getPolygon: [z], getFillColor: key },
    onClick: (info) => {
      if (info.object) {
        state.selected = { i: info.object.i, j: info.object.j };
        refresh();
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
    wireframe: true,
    opacity: 0.55,
    getElevation: (f) => f.properties.height_m,
    getFillColor: [203, 213, 225],
    getLineColor: [100, 116, 139],
    material: { ambient: 0.55, diffuse: 0.5, shininess: 8 },
  });
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
    getLineColor: [37, 99, 235, 220],
  });
}

function windVectors(timeMs = 0) {
  const entry = scenarioEntry(state.scenario);
  if (!entry) return [];
  const from = (entry.wind_from_deg * Math.PI) / 180;
  const speed = Math.max(0, entry.wind_speed_m_s);
  // Meteorological direction is where wind comes FROM. The particles move TO.
  const u = -Math.sin(from);
  const v = -Math.cos(from);
  const seconds = reducedMotion.matches ? 0 : timeMs / 1000;
  const travel = 0.026 * Math.max(0.45, speed);
  const trail = 0.025 + Math.min(speed, 8) * 0.006;
  const z = GRID.z_centres_m[state.layer] + 1.2;

  return windSeeds.map((seed) => {
    const offset = seed.phase + seconds * travel;
    const s = seed.s + u * offset;
    const t = seed.t + v * offset;
    return {
      head: [...geoAt(s, t), z],
      path: [[...geoAt(s - u * trail, t - v * trail), z], [...geoAt(s, t), z]],
    };
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
      getColor: [34, 211, 238, 205],
      getWidth: 2.3,
      widthUnits: "pixels",
      widthMinPixels: 1.5,
      parameters: { depthTest: false },
    }),
    new deck.ScatterplotLayer({
      id: "wind-heads",
      data,
      visible: state.showWind,
      getPosition: (item) => item.head,
      getRadius: 2.4,
      radiusUnits: "pixels",
      getFillColor: [236, 254, 255, 235],
      stroked: false,
      parameters: { depthTest: false },
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
    getFillColor: [34, 197, 94, 95],
  });
}

function selectionLayer() {
  if (!state.selected) {
    return null;
  }
  const [lon, lat] = cellCentre(state.selected.i, state.selected.j);
  return new deck.PathLayer({
    id: "selection",
    data: [{ path: [[lon, lat, 0], [lon, lat, 100]] }],
    getPath: (d) => d.path,
    getColor: [34, 211, 238],
    getWidth: 2,
    widthUnits: "pixels",
  });
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
  overlay.setProps({
    layers: [
      waterLayer(),
      greenLayer(),
      roadLayer(),
      concentrationLayer(),
      ...windLayers(timeMs),
      buildingLayer(),
      selectionLayer(),
    ].filter(Boolean),
  });
}

function startWindAnimation() {
  if (windAnimationFrame !== null) cancelAnimationFrame(windAnimationFrame);
  const frame = (time) => {
    windAnimationFrame = requestAnimationFrame(frame);
    if (document.hidden || reducedMotion.matches || !state.showWind || time - lastWindFrame < 33) return;
    lastWindFrame = time;
    renderLayers(time);
  };
  windAnimationFrame = requestAnimationFrame(frame);
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
  if (!entry || !state.showWind) {
    hud.hidden = true;
    return;
  }
  hud.hidden = false;
  const toDeg = (entry.wind_from_deg + 180) % 360;
  $("wind-summary").textContent = `${fmt(entry.wind_speed_m_s)} m/s · từ ${compass(entry.wind_from_deg)} (${entry.wind_from_deg.toFixed(0)}°)`;
  $("wind-arrow").style.transform = `rotate(${toDeg}deg)`;
}

function scenarioLabel(entry) {
  const scenarioId = entry.scenario_id || entry.id;
  const season = Object.keys(SCENARIO_NAMES).find((key) => scenarioId.startsWith(key));
  const name = entry.name || (season ? SCENARIO_NAMES[season] : scenarioId);
  return `${name} · ${entry.model.toUpperCase()} · ${entry.id.slice(0, 8)} · gió ${entry.wind_from_deg.toFixed(0)}°`;
}

function buildControls() {
  const scenarioSelect = $("new-run-scenario");
  AVAILABLE_SCENARIOS.forEach((scenario) => {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = `${scenario.name} · ${fmt(scenario.wind_speed_m_s)} m/s`;
    scenarioSelect.appendChild(option);
  });
  $("run-button").addEventListener("click", createRun);
  $("run-note").textContent = M.scenarios.length
    ? `${M.scenarios.length} run thành công có thể xem.`
    : "Chưa có kết quả. Chạy mock để kiểm tra đầy đủ luồng tích hợp.";

  const list = $("scenario-list");
  M.scenarios.forEach((entry, n) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="scenario" value="${entry.id}" ${n === 0 ? "checked" : ""}/> <span></span>`;
    label.querySelector("span").textContent = scenarioLabel(entry);
    label.querySelector("input").setAttribute("aria-label", scenarioLabel(entry));
    label.querySelector("input").addEventListener("change", (event) => {
      const id = event.target.value;
      loadScenario(id).then(() => {
        state.scenario = id;
        refresh();
        setStatus(`Kịch bản: ${id}`, "pass");
      });
    });
    list.appendChild(label);
  });

  const thresholds = $("threshold-list");
  Object.entries(M.thresholds).forEach(([key, t]) => {
    const label = document.createElement("label");
    const colour = THRESHOLD_COLOURS[key] || [255, 0, 255];
    label.innerHTML = `<input type="checkbox" value="${key}"/> <span class="swatch" style="background: rgb(${colour.join(",")})"></span> <span></span>`;
    label.querySelector("span:last-child").textContent = `${t.label}: ${fmt(t.value)} µg/m³`;
    label.querySelector("input").setAttribute("aria-label", `${t.label}: ${fmt(t.value)} µg/m³`);
    label.querySelector("input").addEventListener("change", (event) => {
      state.thresholds[key] = event.target.checked;
      refresh();
    });
    thresholds.appendChild(label);
  });

  const slider = $("height-slider");
  slider.max = String(GRID.nz - 1);
  slider.addEventListener("input", (event) => {
    state.layer = Number(event.target.value);
    refresh();
  });

  $("multiplier").addEventListener("change", (event) => {
    state.multiplier = Number(event.target.value);
    refresh();
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

  $("show-wind").addEventListener("change", (event) => {
    state.showWind = event.target.checked;
    refresh();
  });

  $("rotate-left").addEventListener("click", () => {
    map?.easeTo({ bearing: map.getBearing() - 20, duration: reducedMotion.matches ? 0 : 300 });
  });

  $("rotate-right").addEventListener("click", () => {
    map?.easeTo({ bearing: map.getBearing() + 20, duration: reducedMotion.matches ? 0 : 300 });
  });

  $("reset-camera").addEventListener("click", () => {
    map?.easeTo({ bearing: 0, pitch: 55, duration: reducedMotion.matches ? 0 : 450 });
  });

  $("toggle-3d").addEventListener("click", () => {
    const pitch = map && map.getPitch() > 5 ? 0 : 55;
    map?.easeTo({ pitch, duration: reducedMotion.matches ? 0 : 350 });
  });

  $("panel-toggle").addEventListener("click", () => {
    const panel = $("panel");
    const collapsed = panel.classList.toggle("collapsed");
    $("panel-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("panel-toggle").textContent = collapsed ? "+" : "−";
  });
}

async function createRun() {
  const button = $("run-button");
  button.disabled = true;
  try {
    const accepted = await api("/runs", {
      method: "POST",
      body: JSON.stringify({ scenario_id: $("new-run-scenario").value, model: "fv" }),
    });
    $("run-note").textContent = `Run ${accepted.run_id.slice(0, 8)} đang xếp hàng…`;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const run = await api(`/runs/${accepted.run_id}`);
      $("run-note").textContent = `${run.status} · ${Math.round(run.progress * 100)}%`;
      setStatus(`Python solver: ${run.status} · ${Math.round(run.progress * 100)}%`);
      if (run.status === "succeeded") {
        window.location.reload();
        return;
      }
      if (["failed", "stale"].includes(run.status)) {
        throw new Error(run.error?.message || `run ${run.status}`);
      }
    }
  } catch (error) {
    $("run-note").textContent = error.message;
    setStatus(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function fillProvenance() {
  const list = $("provenance");
  const items = [
    ...Object.entries(M.provenance).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
    `Đơn vị: ${M.units}. ${M.pollutant}.`,
    "Chưa có nồng độ nền: số hiển thị chỉ là phần do giao thông trong 500 × 500 m, không so thẳng được với trạm quan trắc.",
    "Đây là verification, chưa phải validation với số đo thực.",
    "Kết quả hiển thị được lấy từ run đã vượt verification gate và được lưu trong PostGIS.",
  ];
  items.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
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
  const entry = scenarioEntry(state.scenario);
  const z = GRID.z_centres_m[state.layer];
  const half = GRID.dz_m / 2;

  $("height-value").textContent = `${fmt(z)} m`;
  $("height-slider").setAttribute("aria-valuetext", `tầng ${state.layer + 1}: ${fmt(z - half)}–${fmt(z + half)} m`);
  $("model-note").textContent = entry
    ? `${MODEL_NOTES[entry.model] || entry.model} ${entry.warnings?.join("; ") || ""}`
    : "Chưa có run thành công để hiển thị nồng độ.";

  updateLegend();
  updateStats();
  updateProfile();
  updateWindHud();
  renderLayers();
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
    $("stat-cells").textContent = "–";
    $("exceed-body").innerHTML = "";
    return;
  }
  const s = layerStats();
  $("stat-mean").textContent = fmt(s.mean);
  $("stat-max").textContent = fmt(s.max);
  $("stat-cells").textContent = s.air.toLocaleString("vi-VN");

  const volume = domainExceedance();
  const body = $("exceed-body");
  body.innerHTML = "";

  Object.entries(M.thresholds).forEach(([key, t]) => {
    const row = document.createElement("tr");
    const cellsText = [`${t.label.split(" ·")[0]} ${fmt(t.value)}`, `${fmtVolume(s.area[key] || 0)} m²`, `${fmtVolume(volume[key] || 0)} m³`];
    cellsText.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      row.appendChild(td);
    });
    body.appendChild(row);
  });
}

function updateProfile() {
  const box = $("profile");

  if (!state.selected || !current()) {
    box.innerHTML = "";
    $("profile-hint").hidden = false;
    return;
  }

  $("profile-hint").hidden = true;
  const { i, j } = state.selected;
  const z = GRID.z_centres_m;
  const values = z.map((_, k) => value(k, j, i));
  const finite = values.filter((v) => Number.isFinite(v) && v > 0);

  const W = 340;
  const H = 230;
  const pad = { l: 44, r: 12, t: 12, b: 34 };
  const scale = colourScale();
  const thresholds = Object.entries(M.thresholds).map(([key, t]) => ({ key, ...t }));
  const hi = Math.max(scale.hi, ...finite, ...thresholds.map((t) => t.value)) * 1.2;
  const lo = Math.min(scale.lo, ...(finite.length ? finite : [scale.lo]));
  const X = (v) => pad.l + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (W - pad.l - pad.r);
  const Y = (h) => H - pad.b - (h / 100) * (H - pad.t - pad.b);

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
      const colour = THRESHOLD_COLOURS[t.key] || [255, 0, 255];
      return `<line x1="${X(t.value)}" x2="${X(t.value)}" y1="${pad.t}" y2="${H - pad.b}" stroke="rgb(${colour.join(",")})" stroke-dasharray="4 3"/>`;
    })
    .join("");

  const ticks = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e += 1) {
    ticks.push(`<text x="${X(10 ** e)}" y="${H - pad.b + 14}" text-anchor="middle">${fmt(10 ** e)}</text>`);
  }

  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Profile nồng độ theo độ cao tại ô ${i}, ${j}">
      <g fill="#9ca3af" font-size="10">
        ${ticks.join("")}
        <text x="${pad.l - 6}" y="${Y(0) + 3}" text-anchor="end">0</text>
        <text x="${pad.l - 6}" y="${Y(50) + 3}" text-anchor="end">50</text>
        <text x="${pad.l - 6}" y="${Y(100) + 3}" text-anchor="end">100 m</text>
        <text x="${(W + pad.l) / 2}" y="${H - 4}" text-anchor="middle">µg/m³ (log)</text>
      </g>
      <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="none" stroke="rgba(255,255,255,0.15)"/>
      ${solid}
      ${lines}
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${currentY}" y2="${currentY}" stroke="rgba(96,165,250,0.5)"/>
      <path d="${path}" fill="none" stroke="#22d3ee" stroke-width="2"/>
    </svg>
    <p class="note">Ô (i=${i}, j=${j}) · vùng xám = trong nhà · đường ngang = tầng đang xem · max cột ${fmt(Math.max(...finite, 0))} µg/m³</p>`;
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = kind || "";
}
