/* Display-only LoD1 facade detail. Never changes GIS/solver geometry. */
(function (root) {
  "use strict";
  const MATERIALS = [
    [232, 228, 218],
    [228, 232, 228],
    [231, 229, 223],
    [225, 230, 234],
  ];
  // Cartographic daylight, not a simulated sun/time or energy model.
  // Explicit lights avoid the default pair overexposing near-white buildings.
  const WALL_MATERIAL = Object.freeze({
    ambient: 0.88,
    diffuse: 0.24,
    shininess: 16,
    specularColor: [0, 0, 0],
  });
  const LIGHTS = Object.freeze({
    ambient: { color: [255, 255, 255], intensity: 1 },
    key: { color: [255, 255, 255], intensity: 0.6, direction: [-3, -4, -6] },
    fill: { color: [255, 255, 255], intensity: 0.22, direction: [4, 2, -3] },
  });
  function lighting(deck) {
    return new deck.LightingEffect({
      ambient: new deck.AmbientLight(LIGHTS.ambient),
      key: new deck.DirectionalLight(LIGHTS.key),
      fill: new deck.DirectionalLight(LIGHTS.fill),
    });
  }
  function detailOpacity(zoom) {
    if (!Number.isFinite(zoom)) return 0;
    // Keep analytical overview calm; reveal facade detail when inspecting.
    const t = Math.max(0, Math.min(1, (zoom - 16) / 1.6));
    return 0.2 + 0.7 * t * t * (3 - 2 * t);
  }
  function hash(id) {
    return [...String(id)].reduce(
      (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
      0,
    );
  }
  function material(feature) {
    return MATERIALS[
      hash(feature.properties.source_feature_id) % MATERIALS.length
    ];
  }
  function walls(feature) {
    const geometry = feature.geometry;
    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates]
        : geometry.type === "MultiPolygon"
          ? geometry.coordinates
          : [];
    return polygons.flatMap((rings, part) => {
      const ring = rings[0],
        area = ring.reduce((n, a, i) => {
          const b = ring[(i + 1) % ring.length];
          return n + a[0] * b[1] - b[0] * a[1];
        }, 0);
      return ring
        .slice(0, -1)
        .map((a, edge) => {
          const b = ring[edge + 1],
            lat = (a[1] + b[1]) / 2,
            lonScale = 111320 * Math.cos((lat * Math.PI) / 180);
          const dx = (b[0] - a[0]) * lonScale,
            dy = (b[1] - a[1]) * 111320,
            length = Math.hypot(dx, dy);
          if (length < 0.2) return null;
          const sign = area >= 0 ? 1 : -1;
          // 8 cm outward offset avoids depth fighting; not part of the solid mask.
          const offset = [
            (((sign * dy) / length) * 0.08) / lonScale,
            (((-sign * dx) / length) * 0.08) / 111320,
          ];
          const point = (t, z) => [
            a[0] + (b[0] - a[0]) * t + offset[0],
            a[1] + (b[1] - a[1]) * t + offset[1],
            z,
          ];
          return {
            part,
            edge,
            length,
            point,
            height: feature.properties.height_m,
          };
        })
        .filter(Boolean);
    });
  }
  function build(scene) {
    const windows = [],
      frames = [],
      features = new Map();
    for (const feature of scene.features) {
      const id = feature.properties.source_feature_id;
      const info = {
        id,
        height: feature.properties.height_m,
        illustrativeWalls: 0,
      };
      features.set(id, info);
      for (const wall of walls(feature)) {
        info.illustrativeWalls++;
        const columns = Math.min(20, Math.floor(wall.length / 4.2));
        for (
          let bottom = 2.2, row = 0;
          bottom + 1.6 < wall.height - 0.6;
          bottom += 3.6, row++
        ) {
          for (let column = 0; column < columns; column++) {
            const centre = (column + 0.5) / columns,
              half = Math.min(1.1 / wall.length, 0.32 / columns);
            const variation = (hash(id) + row * 7 + column * 13) % 3;
            // Light sill/frame below each pane; no fabricated surveyed detail.
            frames.push({
              id,
              polygon: [
                wall.point(centre - half - 0.08 / wall.length, bottom - 0.12),
                wall.point(centre - half - 0.08 / wall.length, bottom),
                wall.point(centre + half + 0.08 / wall.length, bottom),
                wall.point(centre + half + 0.08 / wall.length, bottom - 0.12),
              ],
              color: [221, 221, 215],
            });
            windows.push({
              id,
              polygon: [
                wall.point(centre - half, bottom),
                wall.point(centre - half, bottom + 1.6),
                wall.point(centre + half, bottom + 1.6),
                wall.point(centre + half, bottom),
              ],
              color:
                variation === 0
                  ? [160, 184, 196]
                  : variation === 1
                    ? [153, 177, 190]
                    : [165, 188, 200],
            });
          }
        }
      }
    }
    return { windows, frames, features };
  }
  const api = {
    material,
    walls,
    build,
    lighting,
    detailOpacity,
    WALL_MATERIAL,
    LIGHTS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BuildingAppearance = api;
})(typeof window !== "undefined" ? window : globalThis);
