const { test } = require("node:test");
const assert = require("node:assert/strict");
const { build } = require("../building-appearance.js");
const {
  prepare,
  select,
  levelForZoom,
  controller,
  paddedBounds,
} = require("../viewer-lod.js");
const feature = (id, x) => ({
  type: "Feature",
  properties: { source_feature_id: id, height_m: 30 },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [x, 10],
        [x + 0.0002, 10],
        [x + 0.0002, 10.0002],
        [x, 10.0002],
        [x, 10],
      ],
    ],
  },
});
test("three LoD levels reduce actual vertices and never mutate source geometry or appearance", () => {
  const scene = { features: [feature("a", 106), feature("b", 107)] },
    before = JSON.stringify(scene),
    appearance = build(scene),
    original = JSON.stringify(appearance.windows);
  const p = prepare(scene, appearance),
    far = select(p, "overview"),
    middle = select(p, "medium"),
    near = select(p, "detail");
  assert.equal(far.vertices, 0);
  assert.ok(middle.vertices > 0);
  assert.ok(middle.vertices < near.vertices / 2);
  assert.equal(
    near.polygons,
    appearance.windows.length + appearance.frames.length,
  );
  assert.equal(JSON.stringify(scene), before);
  assert.equal(JSON.stringify(appearance.windows), original);
  const cut = select(p, "detail", [105.9, 9.9, 106.1, 10.1]);
  assert.ok(cut.polygons > 0 && cut.polygons < near.polygons);
  assert.ok(cut.windows.every((w) => w.id === "a"));
  assert.equal(select(p, "detail", [0, 0, 1, 1]).vertices, 0);
});
test("hysteresis and camera cache prevent buffer churn at zoom boundaries", () => {
  assert.equal(levelForZoom(16), "overview");
  assert.equal(levelForZoom(17), "medium");
  assert.equal(levelForZoom(18), "detail");
  assert.equal(levelForZoom(16.55, "overview"), "overview");
  assert.equal(levelForZoom(17.4, "detail"), "detail");
  const map = {
    getZoom: () => 18,
    getPitch: () => 55,
    getBounds: () => ({
      getSouth: () => 9.9,
      getNorth: () => 10.1,
      getWest: () => 105.9,
      getEast: () => 106.1,
    }),
  };
  const get = controller(
    prepare(
      { features: [feature("a", 106)] },
      build({ features: [feature("a", 106)] }),
    ),
  );
  assert.equal(get(map), get(map));
  assert.ok(paddedBounds(map, 91)[0] < 105.9);
  const first = get(map);
  map.getBounds = () => ({
    getSouth: () => 9.91,
    getNorth: () => 10.11,
    getWest: () => 105.91,
    getEast: () => 106.11,
  });
  assert.equal(
    get(map),
    first,
    "camera moved but same visible buildings must reuse GPU data arrays",
  );
});
test("courtyards and multipolygons remain byte-identical through culling", () => {
  const f = feature("a", 106);
  f.geometry.coordinates.push([
    [106.00005, 10.00005],
    [106.0001, 10.00005],
    [106.0001, 10.0001],
    [106.00005, 10.00005],
  ]);
  const m = {
    ...feature("b", 107),
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        feature("c", 107).geometry.coordinates,
        feature("d", 108).geometry.coordinates,
      ],
    },
  };
  const scene = { features: [f, m] },
    before = JSON.stringify(scene),
    p = prepare(scene, build(scene));
  for (const mode of ["overview", "medium", "detail"])
    select(p, mode, [105, 9, 109, 11]);
  assert.equal(JSON.stringify(scene), before);
});
