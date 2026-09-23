"use strict";

/*
 * A3.6 WEB TECHNOLOGY SPIKE
 *
 * MapLibre + deck.gl + fake 10x10 concentration grid + 3 height levels.
 * No real model output is used in this batch.
 */

const STUDY_AREA = {
  latitude: 10.7746,
  longitude: 106.7035,
};

const HEIGHTS_M = [1.5, 15, 30];
const GRID_SIZE = 10;
const CELL_SIZE_M = 42;

const slider = document.getElementById("height-slider");
const heightValue = document.getElementById("height-value");
const cellCount = document.getElementById("cell-count");
const meanValue = document.getElementById("mean-value");
const maxValue = document.getElementById("max-value");
const statusElement = document.getElementById("status");

let overlay = null;
let selectedLayerIndex = 0;

const mockLayers = HEIGHTS_M.map((heightM, heightIndex) => ({
  heightM,
  cells: buildMockGrid(heightIndex),
}));

updateUi(0);
initialize();

function initialize() {
  if (typeof maplibregl === "undefined") {
    setStatus("ERROR - MapLibre CDN không tải được", "error");
    return;
  }

  if (typeof deck === "undefined") {
    setStatus("ERROR - deck.gl CDN không tải được", "error");
    return;
  }

  if (typeof deck.MapboxOverlay === "undefined") {
    setStatus("ERROR - deck.gl MapboxOverlay không có", "error");
    return;
  }

  setStatus("MapLibre loaded - loading map...");

  try {
    createMap();
  } catch (error) {
    console.error(error);
    setStatus("ERROR - không khởi tạo được map", "error");
  }
}

function createMap() {
  const map = new maplibregl.Map({
    container: "map",
    style: "https://demotiles.maplibre.org/style.json",
    center: [STUDY_AREA.longitude, STUDY_AREA.latitude],
    zoom: 15.4,
    pitch: 42,
    bearing: -18,
    antialias: true,
  });

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  map.addControl(
    new maplibregl.ScaleControl({
      unit: "metric",
      maxWidth: 120,
    }),
    "bottom-left",
  );

  map.on("error", (event) => {
    console.error("MapLibre:", event.error || event);
  });

  map.once("load", () => {
    setStatus("map loaded - loading deck.gl...");

    try {
      overlay = new deck.MapboxOverlay({
        interleaved: false,
        layers: [
          createConcentrationLayer(selectedLayerIndex),
        ],
      });

      map.addControl(overlay);

      updateUi(selectedLayerIndex);

      setStatus(
        "PASS - map + deck.gl + slider ready",
        "pass",
      );
    } catch (error) {
      console.error("deck.gl:", error);

      setStatus(
        "ERROR - deck.gl overlay thất bại",
        "error",
      );
    }
  });

  window.setTimeout(() => {
    if (!map.loaded()) {
      setStatus(
        "ERROR - map chưa load sau 15 giây",
        "error",
      );
    }
  }, 15000);
}

slider.addEventListener("input", (event) => {
  const index = Number(event.target.value);

  if (
    !Number.isInteger(index)
    || index < 0
    || index >= HEIGHTS_M.length
  ) {
    return;
  }

  selectedLayerIndex = index;

  updateUi(index);

  if (overlay) {
    overlay.setProps({
      layers: [
        createConcentrationLayer(index),
      ],
    });
  }
});

function createConcentrationLayer(layerIndex) {
  const selected = mockLayers[layerIndex];

  return new deck.PolygonLayer({
    id: `mock-pm25-${selected.heightM}m`,
    data: selected.cells,

    pickable: true,
    filled: true,
    stroked: true,

    getPolygon: (cell) => cell.polygon,

    getFillColor: (cell) => (
      concentrationColor(cell.value)
    ),

    getLineColor: [
      255,
      255,
      255,
      90,
    ],

    getLineWidth: 1,
    lineWidthUnits: "pixels",

    opacity: 0.82,

    autoHighlight: true,

    highlightColor: [
      255,
      255,
      255,
      90,
    ],
  });
}

function buildMockGrid(heightIndex) {
  const cells = [];
  const halfGrid = GRID_SIZE / 2;

  for (
    let row = 0;
    row < GRID_SIZE;
    row += 1
  ) {
    for (
      let col = 0;
      col < GRID_SIZE;
      col += 1
    ) {
      const x0 = (
        col - halfGrid
      ) * CELL_SIZE_M;

      const x1 = (
        x0
        + CELL_SIZE_M
      );

      const y0 = (
        row - halfGrid
      ) * CELL_SIZE_M;

      const y1 = (
        y0
        + CELL_SIZE_M
      );

      const centerX = (
        x0 + x1
      ) / 2;

      const centerY = (
        y0 + y1
      ) / 2;

      cells.push({
        row,
        col,

        value: mockConcentration(
          centerX,
          centerY,
          heightIndex,
          row,
          col,
        ),

        polygon: [
          offsetLngLat(x0, y0),
          offsetLngLat(x1, y0),
          offsetLngLat(x1, y1),
          offsetLngLat(x0, y1),
        ],
      });
    }
  }

  return cells;
}

function mockConcentration(
  x,
  y,
  heightIndex,
  row,
  col,
) {
  const sourceX = x + 80;
  const sourceY = y - 20;

  const gaussianShape = Math.exp(
    -(
      (sourceX * sourceX)
      /
      (2 * 145 * 145)
    )
    -
    (
      (sourceY * sourceY)
      /
      (2 * 70 * 70)
    ),
  );

  const downwind = (
    0.5
    +
    0.5
    *
    Math.max(
      0,
      Math.min(
        1,
        (x + 210) / 420,
      ),
    )
  );

  const attenuation = [
    1.0,
    0.63,
    0.34,
  ][heightIndex];

  const noise = deterministicNoise(
    row,
    col,
    heightIndex,
  );

  return Math.max(
    0,

    7
    +
    108
    * gaussianShape
    * downwind
    * attenuation
    +
    noise
    * 9,
  );
}

function deterministicNoise(
  row,
  col,
  heightIndex,
) {
  const raw = (
    Math.sin(
      (row + 1) * 12.9898
      +
      (col + 1) * 78.233
      +
      (heightIndex + 1) * 37.719,
    )
    *
    43758.5453
  );

  return (
    raw
    -
    Math.floor(raw)
  );
}

function offsetLngLat(
  eastM,
  northM,
) {
  const latitudeRad = (
    STUDY_AREA.latitude
    *
    Math.PI
    /
    180
  );

  const metresPerLatitudeDegree = 111320;

  const metresPerLongitudeDegree = (
    111320
    *
    Math.cos(latitudeRad)
  );

  return [
    STUDY_AREA.longitude
    +
    eastM
    /
    metresPerLongitudeDegree,

    STUDY_AREA.latitude
    +
    northM
    /
    metresPerLatitudeDegree,
  ];
}

function concentrationColor(value) {
  const stops = [
    {
      value: 0,
      color: [
        34,
        197,
        94,
        210,
      ],
    },

    {
      value: 25,
      color: [
        250,
        204,
        21,
        215,
      ],
    },

    {
      value: 50,
      color: [
        249,
        115,
        22,
        220,
      ],
    },

    {
      value: 75,
      color: [
        239,
        68,
        68,
        225,
      ],
    },

    {
      value: 100,
      color: [
        126,
        34,
        206,
        230,
      ],
    },
  ];

  if (
    value
    <=
    stops[0].value
  ) {
    return stops[0].color;
  }

  for (
    let index = 1;
    index < stops.length;
    index += 1
  ) {
    const lower = stops[
      index - 1
    ];

    const upper = stops[index];

    if (
      value
      <=
      upper.value
    ) {
      const ratio = (
        value
        -
        lower.value
      )
      /
      (
        upper.value
        -
        lower.value
      );

      return interpolateColor(
        lower.color,
        upper.color,
        ratio,
      );
    }
  }

  return stops[
    stops.length - 1
  ].color;
}

function interpolateColor(
  start,
  end,
  ratio,
) {
  return start.map(
    (
      channel,
      index,
    ) => (
      Math.round(
        channel
        +
        (
          end[index]
          -
          channel
        )
        *
        ratio,
      )
    ),
  );
}

function updateUi(layerIndex) {
  const selected = mockLayers[
    layerIndex
  ];

  const values = selected.cells.map(
    (cell) => cell.value,
  );

  const total = values.reduce(
    (
      sum,
      value,
    ) => (
      sum + value
    ),
    0,
  );

  const mean = (
    total
    /
    values.length
  );

  const maximum = Math.max(
    ...values,
  );

  heightValue.textContent = (
    `${selected.heightM} m`
  );

  cellCount.textContent = String(
    values.length,
  );

  meanValue.textContent = (
    mean.toFixed(1)
  );

  maxValue.textContent = (
    maximum.toFixed(1)
  );
}

function setStatus(
  text,
  type = "",
) {
  statusElement.textContent = text;
  statusElement.className = type;
}