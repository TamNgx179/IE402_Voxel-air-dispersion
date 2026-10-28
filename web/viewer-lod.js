/* LoD chỉ dành cho renderer. Không sửa footprint, chiều cao hay mảng nồng độ. */
(function (root) {
  "use strict";
  function levelForZoom(zoom, previous) {
    const target = zoom < 16.5 ? "overview" : zoom < 17.5 ? "medium" : "detail";
    // Hysteresis tránh tạo lại buffer khi camera dao động sát một mốc zoom.
    if (previous === "overview" && zoom < 16.65) return previous;
    if (previous === "detail" && zoom > 17.35) return previous;
    if (previous === "medium" && zoom >= 16.35 && zoom <= 17.65)
      return previous;
    return target;
  }
  function prepare(scene, appearance) {
    const groups = scene.features.map((feature) => {
      const id = feature.properties.source_feature_id;
      const points = feature.geometry.coordinates.flat(
        feature.geometry.type === "MultiPolygon" ? 2 : 1,
      );
      return {
        id,
        box: [
          Math.min(...points.map((p) => p[0])),
          Math.min(...points.map((p) => p[1])),
          Math.max(...points.map((p) => p[0])),
          Math.max(...points.map((p) => p[1])),
        ],
        windows: [],
        frames: [],
      };
    });
    const byId = new Map(groups.map((g) => [g.id, g]));
    appearance.windows.forEach((p) => byId.get(p.id)?.windows.push(p));
    appearance.frames.forEach((p) => byId.get(p.id)?.frames.push(p));
    groups.forEach((g) => {
      g.medium = g.windows.filter((_, i) => i % 4 === 0);
    });
    const maxHeight = Math.max(
      0,
      ...scene.features.map((f) => f.properties.height_m),
    );
    return { groups, maxHeight };
  }
  function select(prepared, level, bounds) {
    const windows = [],
      frames = [];
    if (level !== "overview")
      for (const g of prepared.groups) {
        const b = g.box;
        if (
          bounds &&
          (b[2] < bounds[0] ||
            b[0] > bounds[2] ||
            b[3] < bounds[1] ||
            b[1] > bounds[3])
        )
          continue;
        windows.push(...(level === "detail" ? g.windows : g.medium));
        if (level === "detail") frames.push(...g.frames);
      }
    return {
      level,
      windows,
      frames,
      polygons: windows.length + frames.length,
      vertices: (windows.length + frames.length) * 4,
    };
  }
  function paddedBounds(map, height) {
    const b = map.getBounds(),
      lat = (b.getSouth() + b.getNorth()) / 2;
    // Nới miền theo chiều cao và pitch: không loại nhà ngoài nền nhưng mái còn trong hình.
    const metres =
      50 + height * Math.tan((Math.min(80, map.getPitch()) * Math.PI) / 180);
    const dy = metres / 111320,
      dx = dy / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    return [
      b.getWest() - dx,
      b.getSouth() - dy,
      b.getEast() + dx,
      b.getNorth() + dy,
    ];
  }
  function controller(prepared) {
    let previous, key, saved;
    return (map) => {
      const level = levelForZoom(map.getZoom(), previous),
        bounds = paddedBounds(map, prepared.maxHeight);
      // Buffer chỉ đổi khi tập nhà nhìn thấy đổi, không đổi theo từng pixel camera.
      const visible = prepared.groups.filter((g) => {
        const b = g.box;
        return !(
          b[2] < bounds[0] ||
          b[0] > bounds[2] ||
          b[3] < bounds[1] ||
          b[1] > bounds[3]
        );
      });
      const next = JSON.stringify([level, visible.map((g) => g.id)]);
      previous = level;
      if (next !== key) {
        saved = select(prepared, level, bounds);
        key = next;
      }
      return saved;
    };
  }
  const api = { levelForZoom, prepare, select, paddedBounds, controller };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerLod = api;
})(typeof window !== "undefined" ? window : globalThis);
