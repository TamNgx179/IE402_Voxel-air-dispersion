/* Road corridor × altitude analysis. Statistics come only from the server's volume-weighted SQL. */
(function (root) {
  "use strict";
  const MAX_ROADS = 50;
  const MAX_BANDS = 5;
  const CLASS_LABELS = {
    primary: "đường chính",
    secondary: "đường cấp 2",
    tertiary: "đường cấp 3",
    residential: "đường nội bộ",
    service: "đường dịch vụ",
    unclassified: "đường khác",
  };
  const number = (value, digits = 4) =>
    value === null || value === undefined || !Number.isFinite(Number(value))
      ? "Không có dữ liệu"
      : Number(value === 0 ? 0 : value).toLocaleString("vi-VN", {
          maximumSignificantDigits: digits,
        });

  function parseDistances(text) {
    const parts = String(text ?? "")
      .split(/[\s,;]+/)
      .filter(Boolean);
    if (!parts.length || parts.length > MAX_BANDS)
      throw new Error(`Nhập 1–${MAX_BANDS} mốc khoảng cách, ví dụ 10, 25, 50.`);
    const values = parts.map((part) => Number(part));
    if (values.some((value) => !Number.isFinite(value) || value < 0.1 || value > 100))
      throw new Error("Mỗi mốc khoảng cách phải từ 0,1 đến 100 m.");
    if (values.some((value, index) => index > 0 && value <= values[index - 1]))
      throw new Error("Các mốc khoảng cách phải tăng dần, không trùng nhau.");
    return values;
  }

  function corridorRequest({ roadIds, distances, min, max, threshold, height }) {
    if (!roadIds.length) throw new Error("Chọn ít nhất một đoạn đường.");
    if (roadIds.length > MAX_ROADS) throw new Error(`Chọn tối đa ${MAX_ROADS} đoạn đường.`);
    const distances_m = parseDistances(distances);
    const lo = Number(min),
      hi = Number(max),
      limit = Number(threshold);
    if (
      !String(min).trim() ||
      !String(max).trim() ||
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      lo < 0 ||
      lo >= hi ||
      hi > height
    )
      throw new Error(`Nhập khoảng độ cao: 0 ≤ từ < đến ≤ ${number(height)} m.`);
    if (!String(threshold).trim() || !Number.isFinite(limit) || limit < 0)
      throw new Error("Ngưỡng tham chiếu phải là số không âm.");
    return {
      road_ids: [...roadIds],
      distances_m,
      z_min_m: lo,
      z_max_m: hi,
      threshold_ug_m3: limit,
    };
  }

  // Local equirectangular metres are accurate enough for a 500 m click tolerance.
  function local(origin) {
    const kx = Math.cos((origin[1] * Math.PI) / 180) * 111320,
      ky = 110540;
    return (p) => [(p[0] - origin[0]) * kx, (p[1] - origin[1]) * ky];
  }
  function segmentDistance(p, a, b) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function lines(geometry) {
    if (geometry?.type === "LineString") return [geometry.coordinates];
    if (geometry?.type === "MultiLineString") return geometry.coordinates;
    return [];
  }
  function nearestRoad(features, lngLat, toleranceM) {
    const toLocal = local(lngLat),
      p = [0, 0];
    let best = null,
      bestDistance = Infinity;
    for (const feature of features || []) {
      for (const line of lines(feature.geometry)) {
        const pts = line.map(toLocal);
        for (let n = 1; n < pts.length; n++) {
          const d = segmentDistance(p, pts[n - 1], pts[n]);
          if (d < bestDistance) {
            bestDistance = d;
            best = feature;
          }
        }
      }
    }
    return best && bestDistance <= toleranceM ? best : null;
  }
  function roadLength(feature) {
    let total = 0;
    for (const line of lines(feature.geometry)) {
      if (line.length < 2) continue;
      const toLocal = local(line[0]);
      for (let n = 1; n < line.length; n++) {
        const a = toLocal(line[n - 1]),
          b = toLocal(line[n]);
        total += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
    return total;
  }
  function roadLabel(feature, index) {
    const kind = CLASS_LABELS[feature.properties?.road_class] || feature.properties?.road_class || "đường";
    return `Đoạn ${index + 1} · ${kind} · ${number(roadLength(feature), 3)} m`;
  }
  function lift(geometry, z) {
    const ring = (r) => r.map((p) => [p[0], p[1], z]);
    if (geometry?.type === "Polygon") return { type: "Polygon", coordinates: geometry.coordinates.map(ring) };
    if (geometry?.type === "MultiPolygon")
      return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map(ring)) };
    return null;
  }
  function bandColor(value, lo, hi) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return [140, 140, 140, 70];
    const t = Math.max(0, Math.min(1, (Number(value) - lo) / (hi - lo || 1)));
    const a = [248, 238, 211],
      b = [112, 53, 65];
    return [...a.map((v, i) => Math.round(v + (b[i] - v) * t)), 150];
  }
  function corridorError(error, fallback) {
    const message = String(error?.detail || error?.message || "");
    if (/strictly increasing/i.test(message)) return "Các mốc khoảng cách phải tăng dần, không trùng nhau.";
    if (/road IDs are absent/i.test(message))
      return "Một số đoạn đường không thuộc cảnh của kết quả này. Hãy chọn lại đường.";
    return fallback(error);
  }

  function summary(doc, box, result, runLabel) {
    box.replaceChildren();
    const text = (value, className = "note") => {
      const p = doc.createElement("p");
      p.className = className;
      p.textContent = value;
      box.append(p);
    };
    text(
      `${runLabel} · ${result.road_ids.length} đoạn đường · ${number(result.z_min_m)}–${number(result.z_max_m)} m`,
      "result-context",
    );
    const valid = result.bands.filter((band) => band.mean_ug_m3 !== null && band.mean_ug_m3 !== undefined);
    if (!valid.length) {
      text("Không có dữ liệu không khí trong các dải và khoảng độ cao này.", "result-insight");
      text("Không có dữ liệu không đồng nghĩa với nồng độ bằng 0.");
    } else if (valid.length > 1) {
      const near = valid[0],
        far = valid.at(-1);
      const diff = Number(near.mean_ug_m3) - Number(far.mean_ug_m3);
      text(
        diff === 0
          ? `Dải ${number(near.inner_m)}–${number(near.outer_m)} m và ${number(far.inner_m)}–${number(far.outer_m)} m có cùng nồng độ trung bình.`
          : `Dải gần ${number(near.inner_m)}–${number(near.outer_m)} m ${diff > 0 ? "cao" : "thấp"} hơn dải ${number(far.inner_m)}–${number(far.outer_m)} m khoảng ${number(Math.abs(diff))} µg/m³.`,
        "result-insight",
      );
    }
    const scroll = doc.createElement("div");
    scroll.className = "result-table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Bảng kết quả theo dải khoảng cách");
    const table = doc.createElement("table");
    table.className = "result-table";
    const caption = doc.createElement("caption");
    caption.textContent = `Trung bình theo thể tích khí (µg/m³); vượt ${number(result.threshold_ug_m3)} µg/m³ tính theo % thể tích có dữ liệu`;
    table.append(caption);
    const head = doc.createElement("thead"),
      header = doc.createElement("tr");
    for (const label of ["Dải (m)", "Trung bình", "Phủ dữ liệu", "Vượt ngưỡng"]) {
      const th = doc.createElement("th");
      th.scope = "col";
      th.textContent = label;
      header.append(th);
    }
    head.append(header);
    table.append(head);
    const body = doc.createElement("tbody");
    for (const band of result.bands) {
      const row = doc.createElement("tr");
      const validVolume = Number(band.valid_volume_m3);
      const cells = [
        `${number(band.inner_m)}–${number(band.outer_m)}`,
        number(band.mean_ug_m3),
        band.coverage === null || band.coverage === undefined ? "Không có dữ liệu" : `${number(Number(band.coverage) * 100, 3)}%`,
        validVolume > 0 ? `${number((Number(band.exceedance_volume_m3) / validVolume) * 100, 3)}%` : "Không có dữ liệu",
      ];
      for (const value of cells) {
        const td = doc.createElement("td");
        td.textContent = value;
        row.append(td);
      }
      body.append(row);
    }
    table.append(body);
    scroll.append(table);
    box.append(scroll);
    text("Kết quả mô hình cho kịch bản đã chọn, không phải số đo quan trắc.");
  }

  function mount({ document: doc, map, deck, api, context, redraw, latestTask, analysisError }) {
    const $ = (id) => doc.getElementById(id);
    const task = latestTask();
    const selected = new Set();
    let picking = false,
      visible = false,
      busy = false,
      exportBusy = false,
      result = null,
      runId = null,
      modified = false,
      zoomBackup = null,
      listKey = "";
    const status = (id, value) => {
      $(id).textContent = value;
    };
    const roads = () => context().roads || [];
    function controls() {
      const ctx = context();
      $("corridor-pick").hidden = picking;
      $("corridor-pick").disabled = !ctx.id || busy;
      $("corridor-pick-done").hidden = !picking;
      $("corridor-clear").hidden = !selected.size || picking;
      $("corridor-clear").disabled = busy;
      $("corridor-settings").hidden = !selected.size || picking;
      $("corridor-query").disabled = busy || picking || !selected.size || ctx.modified || !ctx.id;
      $("corridor-query").textContent = busy ? "Đang phân tích…" : result ? "Phân tích lại" : "Phân tích hành lang";
      $("corridor-result").hidden = !result;
      $("corridor-export").hidden = !result;
      $("corridor-export").disabled = !result || exportBusy;
      $("corridor-export").textContent = exportBusy ? "Đang tải CSV…" : "Tải CSV";
      $("corridor-max").max = String(ctx.height);
    }
    function syncList() {
      const list = $("corridor-road-list");
      const features = roads();
      const key = features.map((f) => f.properties?.source_feature_id).join("|");
      if (key !== listKey) {
        listKey = key;
        list.replaceChildren();
        features.forEach((feature, index) => {
          const option = doc.createElement("option");
          option.value = feature.properties.source_feature_id;
          option.textContent = roadLabel(feature, index);
          list.add(option);
        });
        for (const id of [...selected]) if (!features.some((f) => f.properties.source_feature_id === id)) selected.delete(id);
      }
      for (const option of list.options) option.selected = selected.has(option.value);
    }
    function clearResult() {
      task.invalidate();
      result = null;
      busy = false;
      exportBusy = false;
      $("corridor-feedback").setAttribute("aria-busy", "false");
      status("corridor-feedback", "");
      $("corridor-result-content").replaceChildren();
      controls();
    }
    function selectionNote() {
      status(
        "corridor-note",
        selected.size
          ? `Đã chọn ${selected.size} đoạn đường${picking ? " · bấm Xong khi chọn đủ." : "."}`
          : picking
            ? "Bấm lên đường trên bản đồ để chọn hoặc bỏ chọn."
            : "",
      );
    }
    function toggle(id) {
      if (selected.has(id)) selected.delete(id);
      else if (selected.size >= MAX_ROADS) {
        status("corridor-note", `Chọn tối đa ${MAX_ROADS} đoạn đường.`);
        return;
      } else selected.add(id);
      clearResult();
      syncList();
      selectionNote();
      redraw();
    }
    function stopPicking() {
      if (!picking) return;
      picking = false;
      if (zoomBackup) map.doubleClickZoom.enable();
      zoomBackup = null;
      map.getCanvas().style.cursor = "";
      selectionNote();
      controls();
      redraw();
    }
    function startPicking() {
      if (picking || busy || !context().id) return;
      picking = true;
      zoomBackup = map.doubleClickZoom.isEnabled();
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = "crosshair";
      selectionNote();
      controls();
      redraw();
    }
    function click(event) {
      if (!picking) return;
      const lngLat = [event.lngLat.lng, event.lngLat.lat];
      const zoom = map.getZoom?.() ?? 17;
      const metresPerPixel = (78271.517 * Math.cos((lngLat[1] * Math.PI) / 180)) / 2 ** zoom;
      const feature = nearestRoad(roads(), lngLat, Math.max(4, 12 * metresPerPixel));
      if (!feature) {
        status("corridor-note", "Không có đường gần điểm vừa bấm. Phóng to rồi bấm sát tim đường.");
        return;
      }
      toggle(feature.properties.source_feature_id);
    }
    function sync() {
      const ctx = context();
      syncList();
      if (runId !== ctx.id) {
        runId = ctx.id;
        clearResult();
        if (selected.size) status("corridor-feedback", "Đường giữ nguyên; phân tích lại để xem kết quả mới.");
      }
      if (modified !== ctx.modified) {
        modified = ctx.modified;
        clearResult();
      }
      if (!ctx.id) status("corridor-note", "Chọn một kết quả mô phỏng trước khi chọn đường.");
      if (ctx.modified) status("corridor-feedback", "Đang dùng minh họa. Vào Minh họa → Về dữ liệu gốc để phân tích.");
      controls();
    }
    async function query() {
      if (busy) return;
      clearResult();
      const ctx = context();
      let request;
      try {
        if (!ctx.id) throw new Error("Chưa có kết quả gốc.");
        if (ctx.modified) throw new Error("Đặt hệ số về ×1 và nền về 0 để xem số liệu gốc.");
        request = corridorRequest({
          roadIds: [...selected],
          distances: $("corridor-distances").value,
          min: $("corridor-min").value,
          max: $("corridor-max").value,
          threshold: $("corridor-threshold").value,
          height: ctx.height,
        });
      } catch (error) {
        status("corridor-feedback", corridorError(error, analysisError));
        controls();
        return;
      }
      busy = true;
      controls();
      $("corridor-feedback").setAttribute("aria-busy", "true");
      status("corridor-feedback", "Đang tính thống kê theo dải khoảng cách…");
      await task.run(
        () => api(`/runs/${ctx.id}/road-corridor`, { method: "POST", body: JSON.stringify(request) }),
        (data) => {
          result = { data, request, run: ctx.id };
          busy = false;
          $("corridor-feedback").setAttribute("aria-busy", "false");
          status("corridor-feedback", "");
          summary(doc, $("corridor-result-content"), data, ctx.runs.find((r) => r.id === ctx.id)?.label || "Kết quả đang chọn");
          controls();
          redraw();
        },
        (error) => {
          busy = false;
          $("corridor-feedback").setAttribute("aria-busy", "false");
          status("corridor-feedback", corridorError(error, analysisError));
          controls();
        },
      );
    }
    async function exportCsv() {
      if (!result || exportBusy) return;
      const saved = result;
      exportBusy = true;
      controls();
      try {
        const text = await api(`/runs/${saved.run}/road-corridor/csv`, {
          method: "POST",
          body: JSON.stringify(saved.request),
          responseType: "text",
        });
        if (saved !== result) return;
        const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
        const link = doc.createElement("a");
        link.href = url;
        link.download = `road-corridor-${saved.run}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("corridor-feedback", "Đã tải bảng CSV.");
      } catch (error) {
        if (saved === result) status("corridor-feedback", `Chưa tải được bảng số liệu. ${corridorError(error, analysisError)}`);
      } finally {
        if (saved === result) {
          exportBusy = false;
          controls();
        }
      }
    }
    $("corridor-pick").addEventListener("click", startPicking);
    $("corridor-pick-done").addEventListener("click", stopPicking);
    $("corridor-clear").addEventListener("click", () => {
      selected.clear();
      clearResult();
      syncList();
      selectionNote();
      redraw();
    });
    $("corridor-road-list").addEventListener("change", () => {
      const chosen = [...$("corridor-road-list").options].filter((o) => o.selected).map((o) => o.value);
      if (chosen.length > MAX_ROADS) {
        status("corridor-note", `Chọn tối đa ${MAX_ROADS} đoạn đường.`);
        syncList();
        return;
      }
      selected.clear();
      for (const id of chosen) selected.add(id);
      clearResult();
      selectionNote();
      redraw();
    });
    for (const id of ["corridor-distances", "corridor-min", "corridor-max", "corridor-threshold"])
      $(id).addEventListener("input", () => {
        // Always invalidate: an in-flight request was built from the old inputs.
        const stale = Boolean(result) || busy;
        clearResult();
        if (stale) status("corridor-note", "Bấm Phân tích hành lang để cập nhật.");
      });
    $("corridor-query").addEventListener("click", query);
    $("corridor-export").addEventListener("click", exportCsv);
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && picking) {
        stopPicking();
        $("corridor-pick").focus();
      }
    });

    function layers(z) {
      if (!visible) return [];
      const out = [];
      if (result?.run === context().id) {
        const bands = result.data.bands;
        const means = bands.map((b) => b.mean_ug_m3).filter((v) => v !== null && v !== undefined).map(Number);
        const lo = means.length ? Math.min(...means) : 0,
          hi = means.length ? Math.max(...means) : 1;
        const features = bands
          .map((band) => ({ type: "Feature", geometry: lift(band.geometry, z + 0.1), properties: band }))
          .filter((feature) => feature.geometry);
        out.push(
          new deck.GeoJsonLayer({
            id: "corridor-bands",
            data: { type: "FeatureCollection", features },
            filled: true,
            stroked: true,
            lineWidthUnits: "pixels",
            getLineWidth: 1,
            getLineColor: [66, 106, 133, 160],
            getFillColor: (f) => bandColor(f.properties.mean_ug_m3, lo, hi),
            pickable: !picking,
            parameters: { depthWriteEnabled: false },
            updateTriggers: { getFillColor: [result] },
          }),
        );
      }
      const features = roads();
      out.push(
        new deck.PathLayer({
          id: "corridor-roads",
          data: features.flatMap((f) => lines(f.geometry).map((path) => ({ path, id: f.properties.source_feature_id }))),
          getPath: (d) => d.path.map((p) => [p[0], p[1], z + 0.25]),
          getColor: (d) => (selected.has(d.id) ? [214, 92, 38, 255] : [107, 126, 116, picking ? 200 : 110]),
          getWidth: (d) => (selected.has(d.id) ? 5 : 2),
          widthUnits: "pixels",
          pickable: false,
          parameters: { depthWriteEnabled: false },
          updateTriggers: { getColor: [selected.size, [...selected].join(), picking], getWidth: [selected.size, [...selected].join()], getPath: [z] },
        }),
      );
      return out;
    }
    sync();
    return {
      sync,
      click,
      layers,
      isDrawing: () => picking,
      cancelDrawing: stopPicking,
      setVisible(value) {
        visible = Boolean(value);
        if (!visible) stopPicking();
      },
      exportState: () => (result ? { run: result.run, request: result.request } : null),
      tooltip: (feature) => {
        const p = feature.properties;
        return `Dải ${number(p.inner_m)}–${number(p.outer_m)} m\nTrung bình ${number(p.mean_ug_m3)} µg/m³`;
      },
    };
  }

  const api = { mount, parseDistances, corridorRequest, nearestRoad, roadLabel, summary, bandColor, lift, MAX_ROADS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerCorridor = api;
})(typeof window !== "undefined" ? window : globalThis);
