const { test } = require("node:test");
const assert = require("node:assert/strict");
const { build, walls, validatePhoto } = require("../building-appearance.js");
const feature = {
  type: "Feature",
  properties: { source_feature_id: "way/test", height_m: 16 },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [106, 10],
        [106.0002, 10],
        [106.0002, 10.0002],
        [106, 10.0002],
        [106, 10],
      ],
    ],
  },
};
test("illustrative facades preserve original footprint/height and stay below roof", () => {
  const before = JSON.stringify(feature),
    a = build({ features: [feature] });
  assert.ok(a.windows.length > 0);
  assert.equal(JSON.stringify(feature), before);
  assert.ok(
    a.windows.every((w) => w.polygon.every((p) => p[2] > 0 && p[2] < 16)),
  );
  assert.equal(a.features.get("way/test").photoWalls, 0);
});
test("licensed local photo replaces only mapped wall; other walls remain illustrative", () => {
  const record = {
    part: 0,
    edge: 1,
    image: "./assets/facades/images/test.jpg",
    source_url: "https://example.org/photo",
    credit: "Author",
    license: "CC BY 4.0",
  };
  const a = build({ features: [feature] }, { "way/test": { walls: [record] } });
  assert.equal(a.photos.length, 1);
  assert.equal(a.photos[0].bounds[1][2], 16);
  assert.equal(a.features.get("way/test").illustrativeWalls, 3);
});
test("unlicensed, remote and traversal paths cannot be labelled as true facade photos", () => {
  const wall = walls(feature)[0],
    record = {
      part: 0,
      edge: 0,
      image: "https://example.org/a.jpg",
      source_url: "https://example.org/photo",
      credit: "Author",
      license: "CC BY",
    };
  assert.equal(validatePhoto(record, wall), false);
  assert.equal(
    validatePhoto(
      { ...record, image: "./assets/facades/images/../a.jpg" },
      wall,
    ),
    false,
  );
  assert.equal(
    validatePhoto(
      { ...record, image: "./assets/facades/images/a.jpg", license: "" },
      wall,
    ),
    false,
  );
});
