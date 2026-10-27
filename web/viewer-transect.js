/* Mặt cắt đứng: API sở hữu số liệu; module này sở hữu thao tác vẽ và trình bày canvas. */
(function (root) {
  "use strict";
  const number = (value) =>
    Number(value).toLocaleString("vi-VN", { maximumSignificantDigits: 5 });
  function selectedReading(result, position, layer) {
    // Giữ tách biệt C=0, ô nhà và thiếu dữ liệu khi đọc bằng chuột hoặc bàn phím.
    const sample = result.samples[position],
      cell = sample.cells[layer],
      z = result.layers[layer];
    const reading =
      cell.status === "solid"
        ? "Tòa nhà"
        : cell.status === "no_data"
          ? "Không có dữ liệu"
          : `${number(cell.concentration_ug_m3)} µg/m³`;
    return `${number(sample.distance_m)} m từ đầu tuyến · tâm tầng ${number(z.z_center_m)} m · ô (${sample.i}, ${sample.j}, ${cell.k}): ${reading}`;
  }
  function mount({
    document: doc,
    map,
    deck,
    api,
    context,
    redraw,
    latestTask,
    analysisError,
    color,
    activate,
  }) {
    const $ = (id) => doc.getElementById(id),
      task = latestTask();
    let line = null,
      points = [],
      drawing = false,
      zoomBackup = false,
      saved = null,
      busy = false,
      exporting = false,
      visible = false,
      key = "";
    let position = 0,
      layer = 0;
    const canvas = $("transect-chart");
    const status = (text) => {
      $("transect-feedback").textContent = text;
    };
    function controls() {
      // Đồng bộ mọi trạng thái nút tại một chỗ, tránh nút export còn bật sau khi đổi tuyến/run.
      const ctx = context();
      $("transect-draw").hidden = drawing;
      $("transect-draw").disabled = !ctx.id || busy;
      $("transect-draw").textContent = line ? "Vẽ lại tuyến" : "Vẽ tuyến";
      $("transect-finish").hidden = !drawing;
      $("transect-finish").disabled = points.length < 2;
      $("transect-cancel").hidden = !drawing;
      $("transect-clear").hidden = !line || drawing;
      $("transect-settings").hidden = !line || drawing;
      $("transect-query").disabled =
        !line || drawing || busy || !ctx.id || ctx.modified;
      $("transect-query").textContent = busy
        ? "Đang lấy mặt cắt…"
        : saved
          ? "Xem lại mặt cắt"
          : "Xem mặt cắt";
      $("transect-export").disabled = !saved || exporting;
      $("transect-export").textContent = exporting ? "Đang tải…" : "Tải CSV";
      $("transect-feedback").setAttribute("aria-busy", String(busy));
    }
    function invalidate() {
      // Hủy quyền commit của request cũ trước khi bỏ kết quả và CSV liên quan.
      task.invalidate();
      saved = null;
      busy = false;
      exporting = false;
      position = 0;
      layer = 0;
      $("transect-result").hidden = true;
      status("");
      controls();
    }
    function endDrawing() {
      // Trả lại đúng thiết lập double-click zoom trước khi vẽ, không ép bật cho mọi người dùng.
      if (!drawing) return;
      drawing = false;
      points = [];
      if (zoomBackup) map.doubleClickZoom.enable();
      map.getCanvas().style.cursor = "";
      controls();
    }
    function cancelDrawing() {
      if (!drawing) return;
      endDrawing();
      $("transect-note").textContent = line
        ? "Giữ tuyến đã chọn trước đó."
        : "";
      redraw();
    }
    function sync() {
      // Cao độ slider chỉ đổi lát ngang; mặt cắt chỉ invalid khi run, miền z hoặc minh họa thay đổi.
      const ctx = context(),
        next = JSON.stringify([ctx.id, ctx.modified, ctx.height]);
      if (next !== key) {
        key = next;
        cancelDrawing();
        invalidate();
      }
      $("transect-max").max = String(ctx.height);
      if (ctx.modified)
        status(
          "Đang dùng minh họa. Vào Minh họa → Về dữ liệu gốc để phân tích.",
        );
      controls();
    }
    function requestBody() {
      // Kiểm nhanh cho UX; server vẫn kiểm lại toàn bộ giới hạn và geometry.
      if (!line) throw new Error("Vẽ một tuyến trước.");
      const ctx = context();
      if (!ctx.id) throw new Error("Chọn kết quả mô phỏng trước.");
      if (ctx.modified)
        throw new Error("Đưa hệ số về ×1 và nền 0 để xem dữ liệu gốc.");
      const lo = $("transect-min").value,
        hi = $("transect-max").value;
      if (
        !lo.trim() ||
        !hi.trim() ||
        !Number.isFinite(+lo) ||
        !Number.isFinite(+hi) ||
        +lo < 0 ||
        +lo >= +hi ||
        +hi > ctx.height
      )
        throw new Error(
          `Chọn khoảng cao độ: 0 ≤ từ < đến ≤ ${number(ctx.height)} m.`,
        );
      return { line, z_min_m: +lo, z_max_m: +hi };
    }
    function show() {
      if (!saved || !visible) return;
      const result = saved.result;
      $("transect-result").hidden = false;
      $("transect-context").textContent =
        `${saved.label} · tuyến ${number(result.length_m)} m · cao độ ${number(result.z_min_m)}–${number(result.z_max_m)} m`;
      const hasAir = result.samples.some((s) =>
        s.cells.some((c) => c.status === "air"),
      );
      $("transect-empty").hidden = hasAir;
      $("transect-empty").textContent =
        "Tuyến và khoảng cao độ này không có mẫu không khí. Vẽ tuyến khác hoặc mở rộng cao độ; ô trống không có nghĩa là nồng độ bằng 0.";
      paint();
    }
    async function query() {
      if (busy) return;
      if (saved) {
        show();
        return;
      }
      try {
        const body = requestBody(),
          ctx = context();
        busy = true;
        controls();
        status("Đang lấy dữ liệu theo tuyến…");
        await task.run(
          () =>
            api(`/runs/${ctx.id}/transect`, {
              method: "POST",
              body: JSON.stringify(body),
            }),
          (result) => {
            busy = false;
            saved = {
              result,
              body,
              run: ctx.id,
              label:
                ctx.runs.find((r) => r.id === ctx.id)?.label ||
                "Kết quả đang chọn",
            };
            status("");
            controls();
            show();
            if (visible) canvas.focus({ preventScroll: true });
          },
          (error) => {
            busy = false;
            status(analysisError(error));
            controls();
          },
        );
      } catch (error) {
        busy = false;
        status(analysisError(error));
        controls();
      }
    }
    function plotBox() {
      const width = Math.max(280, canvas.getBoundingClientRect().width),
        height = 250;
      return {
        width,
        height,
        left: 52,
        right: width - 16,
        top: 18,
        bottom: height - 38,
      };
    }
    function paint() {
      // Canvas chỉ ánh xạ distance/z → pixel, không nội suy nồng độ hoặc sửa dữ liệu API.
      if (!saved || $("transect-result").hidden) return;
      const r = saved.result,
        b = plotBox(),
        ctx = canvas.getContext("2d");
      if (!ctx) return;
      const ratio = root.devicePixelRatio || 1;
      canvas.width = Math.round(b.width * ratio);
      canvas.height = Math.round(b.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, b.width, b.height);
      const max = r.samples.reduce(
        (m, s) =>
          s.cells.reduce(
            (n, c) =>
              c.status === "air" ? Math.max(n, c.concentration_ug_m3) : n,
            m,
          ),
        0,
      );
      $("transect-scale").textContent = `0 → ${number(max)} µg/m³ · tuyến tính`;
      const x = (d) => b.left + (d / r.length_m) * (b.right - b.left),
        y = (z) =>
          b.bottom -
          ((z - r.z_min_m) / (r.z_max_m - r.z_min_m)) * (b.bottom - b.top);
      for (let n = 0; n < r.samples.length; n++) {
        // Ô màu trải đến trung điểm giữa hai mẫu; đây là ký hiệu hiển thị, không là voxel mới.
        const s = r.samples[n],
          lo = n === 0 ? 0 : (r.samples[n - 1].distance_m + s.distance_m) / 2,
          hi =
            n === r.samples.length - 1
              ? r.length_m
              : (s.distance_m + r.samples[n + 1].distance_m) / 2;
        for (let k = 0; k < r.layers.length; k++) {
          const c = s.cells[k],
            z = r.layers[k],
            rgba = color(c.concentration_ug_m3, 0, max);
          ctx.fillStyle =
            c.status === "solid"
              ? "#929fa9"
              : c.status === "no_data"
                ? "#ffffff"
                : `rgb(${rgba.slice(0, 3).join(",")})`;
          ctx.fillRect(
            x(lo),
            y(z.overlap_max_m),
            x(hi) - x(lo) + 0.25,
            y(z.overlap_min_m) - y(z.overlap_max_m) + 0.25,
          );
          if (c.status === "no_data") {
            ctx.strokeStyle = "#cbd5db";
            ctx.strokeRect(
              x(lo),
              y(z.overlap_max_m),
              x(hi) - x(lo),
              y(z.overlap_min_m) - y(z.overlap_max_m),
            );
          }
          if (n === position && k === layer) {
            ctx.strokeStyle = "#173e55";
            ctx.lineWidth = 2;
            ctx.strokeRect(
              x(lo) + 1,
              y(z.overlap_max_m) + 1,
              Math.max(1, x(hi) - x(lo) - 2),
              Math.max(1, y(z.overlap_min_m) - y(z.overlap_max_m) - 2),
            );
          }
        }
      }
      ctx.fillStyle = "#253039";
      ctx.font = "11px system-ui";
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#7a8f9c";
      ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      for (let n = 0; n <= 4; n++) {
        const z = r.z_min_m + (n * (r.z_max_m - r.z_min_m)) / 4,
          d = (n * r.length_m) / 4;
        ctx.textAlign = "right";
        ctx.fillText(number(z), b.left - 7, y(z) + 4);
        ctx.textAlign = n === 0 ? "left" : n === 4 ? "right" : "center";
        ctx.fillText(number(d), x(d), b.bottom + 16);
      }
      ctx.textAlign = "left";
      ctx.fillText("Cao độ (m)", 4, 11);
      ctx.textAlign = "center";
      ctx.fillText(
        "Khoảng cách từ đầu tuyến (m)",
        (b.left + b.right) / 2,
        b.height - 3,
      );
      $("transect-reading").textContent = selectedReading(r, position, layer);
    }
    $("transect-draw").addEventListener("click", () => {
      if (busy || !context().id) return;
      activate();
      invalidate();
      drawing = true;
      points = [];
      zoomBackup = map.doubleClickZoom.isEnabled();
      map.doubleClickZoom.disable();
      map.getCanvas().style.cursor = "crosshair";
      $("transect-note").textContent = "Chọn ít nhất 2 điểm.";
      controls();
      redraw();
    });
    function click(event) {
      if (!drawing) return;
      if (points.length >= 100) {
        $("transect-note").textContent = "Tối đa 100 điểm trên một tuyến.";
        return;
      }
      const p = [event.lngLat.lng, event.lngLat.lat],
        last = points.at(-1);
      if (last && p[0] === last[0] && p[1] === last[1]) return;
      points.push(p);
      $("transect-note").textContent =
        points.length < 2
          ? "Đã chọn 1/2 điểm."
          : `${points.length} điểm · có thể hoàn tất.`;
      controls();
      redraw();
    }
    $("transect-finish").addEventListener("click", () => {
      if (points.length < 2) return;
      line = { type: "LineString", coordinates: points.map((p) => [...p]) };
      endDrawing();
      invalidate();
      $("transect-note").textContent =
        `Tuyến đã chọn · ${line.coordinates.length} điểm.`;
      controls();
      redraw();
    });
    $("transect-cancel").addEventListener("click", cancelDrawing);
    $("transect-clear").addEventListener("click", () => {
      endDrawing();
      line = null;
      invalidate();
      $("transect-note").textContent = "";
      redraw();
    });
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && drawing) {
        cancelDrawing();
        $("transect-draw").focus();
      }
    });
    for (const id of ["transect-min", "transect-max"])
      $(id).addEventListener("input", () => {
        invalidate();
        status("Bấm Xem mặt cắt để cập nhật.");
      });
    $("transect-query").addEventListener("click", query);
    $("transect-close").addEventListener("click", () => {
      $("transect-result").hidden = true;
      $("transect-query").focus();
    });
    canvas.addEventListener("click", (event) => {
      // Chọn mẫu gần con trỏ nhất và tầng chứa z; đọc lại cell API thay vì đọc màu pixel.
      if (!saved) return;
      const b = plotBox(),
        rect = canvas.getBoundingClientRect(),
        r = saved.result;
      const px = event.clientX - rect.left,
        py = event.clientY - rect.top;
      if (px < b.left || px > b.right || py < b.top || py > b.bottom) return;
      const d = ((px - b.left) / (b.right - b.left)) * r.length_m,
        z =
          r.z_min_m +
          ((b.bottom - py) / (b.bottom - b.top)) * (r.z_max_m - r.z_min_m);
      position = r.samples.reduce(
        (best, s, n) =>
          Math.abs(s.distance_m - d) < Math.abs(r.samples[best].distance_m - d)
            ? n
            : best,
        0,
      );
      layer = Math.max(
        0,
        r.layers.findIndex((l) => z >= l.overlap_min_m && z <= l.overlap_max_m),
      );
      paint();
    });
    canvas.addEventListener("keydown", (event) => {
      if (
        !saved ||
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      const r = saved.result;
      if (event.key === "ArrowLeft") position = Math.max(0, position - 1);
      if (event.key === "ArrowRight")
        position = Math.min(r.samples.length - 1, position + 1);
      if (event.key === "ArrowUp")
        layer = Math.min(r.layers.length - 1, layer + 1);
      if (event.key === "ArrowDown") layer = Math.max(0, layer - 1);
      if (event.key === "Home") position = 0;
      if (event.key === "End") position = r.samples.length - 1;
      paint();
    });
    $("transect-export").addEventListener("click", async () => {
      // Snapshot request đã thành công; nếu người dùng đổi lựa chọn lúc tải, bỏ response cũ.
      if (!saved || exporting) return;
      const current = saved;
      exporting = true;
      controls();
      try {
        const text = await api(`/runs/${current.run}/transect/csv`, {
          method: "POST",
          body: JSON.stringify(current.body),
          responseType: "text",
        });
        if (saved !== current) return;
        const url = URL.createObjectURL(
          new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }),
        );
        const link = doc.createElement("a");
        link.href = url;
        link.download = `transect-${current.run}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("Đã tải bảng mặt cắt.");
      } catch (error) {
        if (saved === current) status(analysisError(error));
      } finally {
        if (saved === current) {
          exporting = false;
          controls();
        }
      }
    });
    if (typeof root.ResizeObserver === "function")
      new root.ResizeObserver(paint).observe(canvas);
    function layers(z) {
      const path = drawing ? points : line?.coordinates;
      return visible && path?.length > 1
        ? [
            new deck.PathLayer({
              id: "analysis-transect-line",
              data: [path],
              getPath: (p) => p.map((x) => [...x, z + 0.4]),
              getColor: [45, 82, 109],
              getWidth: 4,
              widthUnits: "pixels",
              pickable: false,
            }),
          ]
        : [];
    }
    controls();
    return {
      sync,
      layers,
      click,
      isDrawing: () => drawing,
      cancelDrawing,
      setVisible(value) {
        visible = value;
        if (!value) {
          cancelDrawing();
          $("transect-result").hidden = true;
        }
      },
      show,
    };
  }
  const api = { mount, selectedReading };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerTransect = api;
})(typeof window !== "undefined" ? window : globalThis);
