/* Display-only LoD1 facade detail. Never changes GIS/solver geometry. */
(function (root) {
  "use strict";
  const MATERIALS = [
    [220, 216, 204],
    [201, 208, 207],
    [222, 214, 202],
    [207, 213, 222],
  ];
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
  function validatePhoto(record, wall) {
    return (
      record &&
      record.part === wall.part &&
      record.edge === wall.edge &&
      typeof record.image === "string" &&
      /^\.\/assets\/facades\/images\/[A-Za-z0-9_-]+\.(png|jpe?g|webp)$/i.test(
        record.image,
      ) &&
      typeof record.source_url === "string" &&
      /^https:\/\//.test(record.source_url) &&
      typeof record.license === "string" &&
      record.license.trim().length > 0 &&
      typeof record.credit === "string" &&
      record.credit.trim().length > 0
    );
  }
  function build(scene, registry = {}) {
    const windows = [],
      photos = [],
      features = new Map();
    for (const feature of scene.features) {
      const id = feature.properties.source_feature_id;
      const info = {
        id,
        height: feature.properties.height_m,
        photoWalls: 0,
        illustrativeWalls: 0,
      };
      features.set(id, info);
      for (const wall of walls(feature)) {
        const records = registry[id]?.walls;
        const photo = (Array.isArray(records) ? records : []).find((record) =>
          validatePhoto(record, wall),
        );
        if (photo) {
          photos.push({
            ...photo,
            id,
            bounds: [
              wall.point(0, 0),
              wall.point(0, wall.height),
              wall.point(1, wall.height),
              wall.point(1, 0),
            ],
          });
          info.photoWalls++;
          continue;
        }
        info.illustrativeWalls++;
        const columns = Math.min(20, Math.floor(wall.length / 3.2));
        for (
          let bottom = 2.2, row = 0;
          bottom + 1.6 < wall.height - 0.6;
          bottom += 3.2, row++
        ) {
          for (let column = 0; column < columns; column++) {
            const centre = (column + 0.5) / columns,
              half = Math.min(1.1 / wall.length, 0.32 / columns);
            const variation = (hash(id) + row * 7 + column * 13) % 3;
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
                  ? [155, 173, 179]
                  : variation === 1
                    ? [109, 133, 144]
                    : [125, 146, 155],
            });
          }
        }
      }
    }
    return { windows, photos, features };
  }
  const api = { material, walls, validatePhoto, build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BuildingAppearance = api;
})(typeof window !== "undefined" ? window : globalThis);
