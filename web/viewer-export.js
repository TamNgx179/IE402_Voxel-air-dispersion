/* Xuất cùng snapshot với hình vẽ. CSV/JSON giữ số gốc, PNG là hình minh họa. */
(function (root) {
  "use strict";
  function csv(rows) {
    return (
      rows
        .map((row) =>
          row
            .map((value) => {
              if (value === null || value === undefined) return "";
              let text = String(value);
              if (typeof value === "string" && /^[\s]*[=+@-]/.test(text))
                text = "'" + text;
              return '"' + text.replaceAll('"', '""') + '"';
            })
            .join(","),
        )
        .join("\r\n") + "\r\n"
    );
  }
  function layerCsv(report) {
    const meta = report.metadata,
      rows = [
        [
          "run_id",
          "model_version",
          "input_hash",
          "z_min_m",
          "z_max_m",
          "z_center_m",
          "mean_ug_m3",
          "max_ug_m3",
          "air_cells",
          "units",
        ],
      ];
    for (const layer of report.summary.layers)
      rows.push([
        meta.run_id,
        meta.model_version,
        meta.input_hash,
        layer.z_m - report.summary.grid.dz_m / 2,
        layer.z_m + report.summary.grid.dz_m / 2,
        layer.z_m,
        layer.mean_ug_m3,
        layer.max_ug_m3,
        layer.air_cells,
        report.summary.units,
      ]);
    return csv(rows);
  }
  function comparisonCsv(data) {
    const rows = [
      [
        "baseline_run_id",
        "comparison_run_id",
        "baseline_version",
        "comparison_version",
        "baseline_input_hash",
        "comparison_input_hash",
        "requested_z_m",
        "z_center_m",
        "i",
        "j",
        "baseline_ug_m3",
        "comparison_ug_m3",
        "delta_ug_m3",
        "units",
      ],
    ];
    for (const f of data.feature_collection.features) {
      const p = f.properties;
      rows.push([
        data.baseline_run_id,
        data.comparison_run_id,
        data.baseline_version,
        data.comparison_version,
        data.baseline_input_hash,
        data.comparison_input_hash,
        data.requested_z_m,
        data.z_center_m,
        p.i,
        p.j,
        p.baseline_ug_m3,
        p.comparison_ug_m3,
        p.delta_ug_m3,
        data.units,
      ]);
    }
    return csv(rows);
  }
  function comparisonLegend(data, view, format) {
    // Không ép null thành 0: miền không có ô khí khác với hai nghiệm trùng nhau.
    if (!data.feature_collection.features.length || data.stats.air_cells === 0)
      return {
        title: "Không có dữ liệu so sánh ở tầng này",
        categories: [
          { label: "Không có ô không khí chung có dữ liệu", color: "#cbd5db" },
        ],
        labels: [],
      };
    const delta = view === "delta";
    const min = delta ? Math.min(0, data.stats.delta.min_ug_m3) : 0;
    const max = delta
      ? Math.max(0, data.stats.delta.max_ug_m3)
      : Math.max(
          0,
          ...data.feature_collection.features.flatMap((f) => [
            f.properties.baseline_ug_m3,
            f.properties.comparison_ug_m3,
          ]),
        );
    const limit = Math.max(Math.abs(min), Math.abs(max));
    if (delta && limit === 0)
      return {
        title: "Chênh lệch bằng 0 (µg/m³)",
        categories: [
          { label: "0 · Không có chênh lệch ở tầng này", color: "#f5f2e8" },
        ],
        labels: [],
      };
    return delta
      ? {
          title: "ΔC (µg/m³, thang tuyến tính đối xứng)",
          stops: [
            [0, "#4b6f8c"],
            [0.5, "#f5f2e8"],
            [1, "#9d534e"],
          ],
          labels: [format(-limit), "0", format(limit)],
        }
      : {
          title: "Nồng độ (µg/m³, thang tuyến tính chung)",
          stops: [
            [0, "#f8eed3"],
            [1, "#703541"],
          ],
          labels: ["0", format(max)],
        };
  }
  function download(doc, blob, filename) {
    const url = URL.createObjectURL(blob),
      a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function copyCanvas(doc, source) {
    if (!source?.width || !source?.height)
      throw new Error("Bản đồ chưa sẵn sàng.");
    const out = doc.createElement("canvas");
    out.width = source.width;
    out.height = source.height;
    out.getContext("2d").drawImage(source, 0, 0);
    return out;
  }
  function compose(doc, base, overlay, report) {
    const width = Math.max(1000, Math.min(2400, base.width)),
      mapHeight = Math.round((base.height * width) / base.width);
    const out = doc.createElement("canvas");
    out.width = width;
    const c = out.getContext("2d"),
      m = report.metadata;
    const footer = [
      `Run: ${m.run_id}${m.comparison_run_id ? " | So sánh: " + m.comparison_run_id : ""}`,
      `Model: ${m.model_version} | Input: ${m.input_hash}`,
      ...(report.comparison
        ? [
            `Model so sánh: ${report.comparison.comparison_version} | Input: ${report.comparison.comparison_input_hash}`,
          ]
        : []),
      report.notice,
      "Nguồn: " + report.attribution,
      `Xuất: ${m.exported_at} | GIS LoD1, nền phẳng z=0 | Camera: ${JSON.stringify(m.camera)}`,
    ];
    c.font = "14px system-ui";
    const wrapped = footer.flatMap((text) => {
      const lines = [];
      let line = "";
      for (const char of text) {
        if (c.measureText(line + char).width > width - 48) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
      lines.push(line);
      return lines;
    });
    out.height = mapHeight + 210 + wrapped.length * 19;
    c.fillStyle = "#fff";
    c.fillRect(0, 0, out.width, out.height);
    c.fillStyle = "#243c4c";
    c.font = "600 24px system-ui";
    c.fillText("PM2.5 · " + report.title, 24, 34);
    c.font = "16px system-ui";
    c.fillText(
      `Tầng ${m.z_min_m}–${m.z_max_m} m · tâm ${m.z_center_m} m · ${report.mode}`,
      24,
      62,
    );
    c.drawImage(base, 0, 82, width, mapHeight);
    if (overlay) c.drawImage(overlay, 0, 82, width, mapHeight);
    let y = mapHeight + 110;
    c.fillStyle = "#243c4c";
    c.font = "600 16px system-ui";
    c.fillText(report.legend.title, 24, y);
    y += 16;
    if (report.legend.categories) {
      report.legend.categories.forEach((item, i) => {
        const x = 24 + (i * (width - 48)) / report.legend.categories.length;
        c.fillStyle = item.color;
        c.fillRect(x, y, 16, 16);
        c.fillStyle = "#253039";
        c.font = "14px system-ui";
        c.fillText(item.label, x + 24, y + 13);
      });
    } else {
      const gradient = c.createLinearGradient(24, 0, width - 24, 0);
      report.legend.stops.forEach(([t, color]) =>
        gradient.addColorStop(t, color),
      );
      c.fillStyle = gradient;
      c.fillRect(24, y, width - 48, 14);
    }
    y += 34;
    c.fillStyle = "#253039";
    c.font = "14px system-ui";
    const labels = report.legend.labels;
    labels.forEach((label, i) => {
      c.textAlign =
        i === 0 ? "left" : i === labels.length - 1 ? "right" : "center";
      c.fillText(
        label,
        24 + (i * (width - 48)) / Math.max(1, labels.length - 1),
        y,
      );
    });
    c.textAlign = "left";
    y += 26;
    for (const line of wrapped) {
      c.fillText(line, 24, y);
      y += 19;
    }
    return out;
  }
  function png(canvas) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("Không tạo được ảnh PNG.")),
          "image/png",
        );
      } catch (e) {
        reject(
          new Error(
            "Nền bản đồ không cho phép xuất ảnh (CORS). Hãy đổi nền rồi thử lại.",
          ),
        );
      }
    });
  }
  const api = {
    csv,
    layerCsv,
    comparisonCsv,
    comparisonLegend,
    download,
    copyCanvas,
    compose,
    png,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ViewerExport = api;
})(typeof window !== "undefined" ? window : globalThis);
