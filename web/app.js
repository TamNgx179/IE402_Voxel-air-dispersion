"use strict";

/*
 * 3D voxel PM2.5 viewer.
 *
 * Data comes from web/data/*.js, written by src/06_export_web.py. Every file
 * assigns a global, so the page also works from file://. Concentration is one
 * uint8 per voxel on a log scale (see src/analysis/web_export.py); this file
 * only decodes it, it never invents a value.
 *
 * Arrays are [z, y, x] flattened in C order: index = (k * ny + j) * nx + i,
 * with y increasing northward and x eastward.
 */

const M = window.VOXEL_MANIFEST;
const GRID = M ? M.grid : null;

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
};

const cache = {};
let overlay = null;
let nodes = null;
let cells = null;

const $ = (id) => document.getElementById(id);

main();

// --------------------------------------------------------------------------
// start-up
// --------------------------------------------------------------------------

function main() {
  if (!M) {
    setStatus("Thiếu web/data/manifest.js — chạy src/06_export_web.py", "error");
    return;
  }

  nodes = buildNodes();
  cells = buildCells();

  state.scenario = M.scenarios[0].id;
  Object.keys(M.thresholds).forEach((key) => (state.thresholds[key] = false));

  buildControls();
  fillProvenance();

  if (typeof maplibregl === "undefined" || typeof deck === "undefined") {
    setStatus("Không tải được MapLibre hoặc deck.gl từ CDN (cần mạng)", "error");
    return;
  }

  loadScenario(state.scenario).then(() => {
    setStatus("Đã có dữ liệu · đang tải bản đồ nền…");
    createMap();
    refresh();
  });
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
  setStatus(`Đang tải kịch bản ${id}…`);

  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = `./data/${entry.file}`;
    tag.onload = () => {
      const payload = (window.VOXEL_DATA || {})[id];
      if (!payload) {
        reject(new Error(`${entry.file} không chứa ${id}`));
        return;
      }
      cache[id] = decode(entry, payload);
      resolve(cache[id]);
    };
    tag.onerror = () => {
      setStatus(`Không tải được data/${entry.file}`, "error");
      reject(new Error(entry.file));
    };
    document.head.appendChild(tag);
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
  const cMax = Math.max(...M.scenarios.map((s) => s.scale.c_max));
  const decades = M.scenarios[0].scale.decades;
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

  const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/positron",
    center: centre,
    zoom: 16.2,
    pitch: 55,
    bearing: -25,
    maxPitch: 80,
    attributionControl: { compact: true },
  });

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
}

function concentrationLayer() {
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

function scenarioLabel(entry) {
  const season = Object.keys(SCENARIO_NAMES).find((key) => entry.id.startsWith(key));
  const name = season ? SCENARIO_NAMES[season] : entry.id;
  return `${name} · gió từ ${entry.wind_from_deg.toFixed(0)}° (${compass(entry.wind_from_deg)}), ${fmt(entry.wind_speed_m_s)} m/s · ${entry.model.toUpperCase()}`;
}

function buildControls() {
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

  $("panel-toggle").addEventListener("click", () => {
    const panel = $("panel");
    const collapsed = panel.classList.toggle("collapsed");
    $("panel-toggle").setAttribute("aria-expanded", String(!collapsed));
    $("panel-toggle").textContent = collapsed ? "+" : "−";
  });
}

function fillProvenance() {
  const list = $("provenance");
  const items = [
    ...Object.values(M.provenance),
    `Đơn vị: ${M.units}. ${M.pollutant}.`,
    "Chưa có nồng độ nền: số hiển thị chỉ là phần do giao thông trong 500 × 500 m, không so thẳng được với trạm quan trắc.",
    "Đây là verification, chưa phải validation với số đo thực.",
    `Dữ liệu gộp: uint8 thang log ${M.scenarios[0].scale.decades} thập phân, sai số giải mã ≤ 1,8 %.`,
    `Xuất lúc ${M.generated_utc}.`,
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
  $("model-note").textContent = MODEL_NOTES[entry.model] || entry.model_description;

  updateLegend();
  updateStats();
  updateProfile();

  if (overlay) {
    overlay.setProps({
      layers: [roadLayer(), concentrationLayer(), buildingLayer(), selectionLayer()].filter(Boolean),
    });
  }
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
  const s = layerStats();
  $("stat-mean").textContent = fmt(s.mean);
  $("stat-max").textContent = fmt(s.max);
  $("stat-cells").textContent = s.air.toLocaleString("vi-VN");

  const volume = domainExceedance();
  const body = $("exceed-body");
  body.innerHTML = "";

  Object.entries(M.thresholds).forEach(([key, t]) => {
    const row = document.createElement("tr");
    const cellsText = [`${t.label.split(" ·")[0]} ${fmt(t.value)}`, `${fmtVolume(s.area[key])} m²`, `${fmtVolume(volume[key])} m³`];
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

  if (!state.selected) {
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
