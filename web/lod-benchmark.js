/* Phép đo renderer độc lập, không sửa trạng thái hoặc dữ liệu solver của viewer. */
(async function () {
  const $ = (id) => document.getElementById(id);
  let output;
  try {
    const get = async (path) => {
      const r = await fetch("/api" + path);
      if (!r.ok) throw new Error(`API ${r.status}`);
      return r.json();
    };
    const [area] = await get("/study-areas"),
      scene = await get(`/study-areas/${area.id}/scene`),
      original = JSON.stringify(scene.buildings);
    const appearance = BuildingAppearance.build(scene.buildings),
      prepared = ViewerLod.prepare(scene.buildings, appearance),
      choose = ViewerLod.controller(prepared);
    const [w, s, e, n] = area.bounds;
    const map = new maplibregl.Map({
      container: "map",
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [(w + e) / 2, (s + n) / 2],
      zoom: 16.2,
      pitch: 55,
      bearing: -25,
    });
    let after = null;
    const Overlay = deck.MapLibreOverlay || deck.MapboxOverlay;
    const overlay = new Overlay({
      interleaved: false,
      layers: [],
      effects: [BuildingAppearance.lighting(deck)],
      onAfterRender: () => after?.(),
    });
    map.addControl(overlay);
    const layers = (plan) => [
      new deck.GeoJsonLayer({
        id: "buildings",
        data: scene.buildings,
        extruded: true,
        getElevation: (f) => f.properties.height_m,
        getFillColor: BuildingAppearance.material,
        material: BuildingAppearance.WALL_MATERIAL,
      }),
      ...(plan.frames.length
        ? [
            new deck.SolidPolygonLayer({
              id: "frames",
              data: plan.frames,
              _full3d: true,
              getPolygon: (f) => f.polygon,
              getFillColor: (f) => f.color,
              material: false,
            }),
          ]
        : []),
      ...(plan.windows.length
        ? [
            new deck.SolidPolygonLayer({
              id: "windows",
              data: plan.windows,
              _full3d: true,
              getPolygon: (f) => f.polygon,
              getFillColor: (f) => f.color,
              material: false,
            }),
          ]
        : []),
    ];
    overlay.setProps({ layers: layers({ windows: [], frames: [] }) });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error("Nền bản đồ chưa tải xong. Tải lại trang để thử lại."),
          ),
        30000,
      );
      map.once("idle", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    $("start").disabled = false;
    $("status").textContent = "Sẵn sàng.";
    const percentile = (xs, q) =>
      xs.slice().sort((a, b) => a - b)[
        Math.min(xs.length - 1, Math.floor(xs.length * q))
      ];
    $("save").onclick = () =>
      ViewerExport.download(
        document,
        new Blob([JSON.stringify(output, null, 2)], {
          type: "application/json",
        }),
        "lod-render-benchmark.json",
      );
    $("start").onclick = async () => {
      $("start").disabled = true;
      $("save").disabled = true;
      const rows = [];
      try {
        for (const [level, zoom] of [
          ["overview", 16.2],
          ["medium", 17],
          ["detail", 18],
        ])
          for (const legacy of [true, false]) {
            $("status").textContent =
              `Đang đo ${level} · ${legacy ? "trước" : "sau"}…`;
            const times = [],
              vertices = [];
            for (let frame = 0; frame < 45; frame++) {
              const begin = performance.now();
              map.jumpTo({
                center: [(w + e) / 2, (s + n) / 2],
                zoom,
                pitch: 55,
                bearing: -25 + frame * 0.35,
              });
              const plan = legacy
                ? {
                    windows: appearance.windows,
                    frames: appearance.frames,
                    vertices:
                      (appearance.windows.length + appearance.frames.length) *
                      4,
                  }
                : choose(map);
              await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                  after = null;
                  reject(new Error("Render timeout"));
                }, 10000);
                after = () => {
                  after = null;
                  clearTimeout(timer);
                  resolve();
                };
                overlay.setProps({ layers: layers(plan) });
              });
              if (frame >= 5) {
                times.push(performance.now() - begin);
                vertices.push(plan.vertices);
              }
            }
            rows.push({
              level,
              legacy,
              zoom,
              pitch: 55,
              frames: 40,
              frame_wall_p50_ms: percentile(times, 0.5),
              frame_wall_p95_ms: percentile(times, 0.95),
              max_facade_vertices: Math.max(...vertices),
            });
            $("result").textContent = JSON.stringify(rows, null, 2);
          }
        output = {
          at: new Date().toISOString(),
          environment: {
            user_agent: navigator.userAgent,
            viewport: [innerWidth, innerHeight],
            device_pixel_ratio: devicePixelRatio,
            hardware_concurrency: navigator.hardwareConcurrency,
          },
          scope:
            "Browser wall time from camera update to deck onAfterRender; not isolated GPU duration; no wind",
          rows,
          source_unchanged: original === JSON.stringify(scene.buildings),
        };
        $("result").textContent = JSON.stringify(output, null, 2);
        $("save").disabled = false;
        $("status").textContent = "Đã đo xong.";
      } catch (e) {
        $("status").textContent = e.message;
      } finally {
        $("start").disabled = false;
      }
    };
  } catch (e) {
    $("status").textContent = "Chưa đo được: " + e.message;
  }
})();
