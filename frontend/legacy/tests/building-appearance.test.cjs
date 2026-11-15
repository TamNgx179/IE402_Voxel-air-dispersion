const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  build,
  material,
  detailOpacity,
  lighting,
  WALL_MATERIAL,
  LIGHTS,
} = require("../building-appearance.js");
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
test("procedural glass and sills preserve GIS geometry and remain below roof", () => {
  const before = JSON.stringify(feature),
    appearance = build({ features: [feature] });
  assert.equal(JSON.stringify(feature), before);
  assert.ok(appearance.windows.length > 0);
  assert.equal(appearance.frames.length, appearance.windows.length);
  assert.ok(
    [...appearance.windows, ...appearance.frames].every((w) =>
      w.polygon.every((p) => p[2] > 0 && p[2] < 16),
    ),
  );
  assert.equal(appearance.features.get("way/test").illustrativeWalls, 4);
});
test("pearl materials stay between dull gray and pure white and stable across render/reload", () => {
  const color = material(feature);
  assert.deepEqual(material(structuredClone(feature)), color);
  for (let id = 0; id < 16; id++) {
    const sample = material({ properties: { source_feature_id: `way/${id}` } });
    assert.ok(sample.every((channel) => channel >= 218 && channel <= 234));
  }
  const scene = { features: [feature] };
  assert.deepEqual(build(scene).windows, build(scene).windows);
  assert.ok(build(scene).windows.every((w) => w.color.every((c) => c <= 200)));
  assert.ok(build(scene).frames.every((w) => w.color.every((c) => c <= 221)));
});
test("explicit soft lights bound exposure and do not enable experimental shadows", () => {
  class Light {
    constructor(props) {
      this.props = props;
    }
  }
  class Effect {
    constructor(props) {
      this.props = props;
    }
  }
  const effect = lighting({
    AmbientLight: Light,
    DirectionalLight: Light,
    LightingEffect: Effect,
  });
  assert.deepEqual(effect.props.key.props, LIGHTS.key);
  const upperBound =
    WALL_MATERIAL.ambient * LIGHTS.ambient.intensity +
    WALL_MATERIAL.diffuse * (LIGHTS.key.intensity + LIGHTS.fill.intensity);
  assert.ok(upperBound > 1 && upperBound < 1.1);
  assert.deepEqual(WALL_MATERIAL.specularColor, [0, 0, 0]);
  assert.equal(effect.props.key.props._shadow, undefined);
});
test("facades reveal bounded detail progressively with zoom, without altering geometry", () => {
  assert.equal(detailOpacity(NaN), 0);
  assert.equal(detailOpacity(14), 0.2);
  assert.ok(detailOpacity(16.5) < detailOpacity(17));
  assert.ok(Math.abs(detailOpacity(19) - 0.9) < 1e-10);
});
test("photo registry cannot replace procedural faces anymore", () => {
  const scene = { features: [feature] };
  assert.deepEqual(
    build(scene, {
      "way/test": { walls: [{ image: "unwanted.jpg", part: 0, edge: 0 }] },
    }),
    build(scene),
  );
  assert.equal(build(scene).photos, undefined);
});
