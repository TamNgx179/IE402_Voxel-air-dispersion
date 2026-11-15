/* Run evidence is read from the exact API summary, never the render uint8. */
(function (root) {
  'use strict';

  const CHECK_NAMES = {
    cfl: 'CFL',
    face_divergence: 'Divergence mặt ô',
    positivity: 'Nồng độ không âm',
    wall_flux: 'Thông lượng qua nhà',
    mass_balance: 'Bảo toàn khối lượng',
    sor_convergence: 'Hội tụ trường gió',
    steady_state: 'Hội tụ trạng thái ổn định',
  };

  function number(value, unit = '') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Chưa có';
    const text = value !== 0 && Math.abs(value) < 0.001
      ? value.toExponential(3)
      : value.toLocaleString('vi-VN', { maximumSignificantDigits: 5 });
    return unit ? `${text} ${unit}` : text;
  }

  function viewModel(summary, runId) {
    if (!summary) return { state: 'empty', message: 'Chọn kết quả để xem thông tin kiểm chứng.' };
    if (summary.run_id !== runId) {
      return { state: 'error', message: 'Thông tin kiểm chứng không khớp kết quả đang xem.' };
    }
    const metrics = summary.metrics || {};
    const checks = summary.verification?.checks || [];
    const passed = checks.filter((check) => check.status === 'pass').length;
    const verified = summary.verification?.status === 'pass' && checks.length > 0 && passed === checks.length;
    const warnings = Array.isArray(summary.warnings)
      ? summary.warnings.filter((item) => typeof item === 'string')
      : [];
    const history = Array.isArray(metrics.convergence_history) ? metrics.convergence_history : [];
    const last = history[history.length - 1];
    const mass = [metrics.emitted_kg, metrics.remaining_kg, metrics.escaped_kg];
    const massError = mass.every((value) => typeof value === 'number' && Number.isFinite(value))
      ? metrics.emitted_kg - metrics.remaining_kg - metrics.escaped_kg
      : null;
    return {
      state: verified ? 'pass' : 'unverified',
      message: verified ? `${passed}/${checks.length} kiểm tra đạt` : 'Kết quả chưa có đủ kiểm tra đạt',
      identity: [
        ['Run', runId],
        ['Mô hình', summary.model || 'Chưa có'],
        ['Phiên bản', summary.model_version || 'Chưa có'],
        ['Input hash', summary.input_hash || 'Chưa có'],
        ['Đơn vị', summary.units || 'Chưa có'],
      ],
      metrics: [
        ['Thời gian tính', number(metrics.wall_clock_s, 's')],
        ['Thời gian mô phỏng', number(metrics.simulated_s, 's')],
        ['Số bước', number(metrics.steps)],
        ['Bước thời gian', number(metrics.dt_s, 's')],
        ['Tiêu chí dừng', metrics.stopping_criterion === 'steady_state' ? 'Trạng thái ổn định' : (metrics.stopping_criterion || 'Chưa có')],
        ['Residual cuối', number(last?.relative_l1_change ?? checks.find((check) => check.name === 'steady_state')?.value)],
        ['Khối lượng phát', number(metrics.emitted_kg, 'kg')],
        ['Khối lượng còn lại', number(metrics.remaining_kg, 'kg')],
        ['Khối lượng thoát', number(metrics.escaped_kg, 'kg')],
        ['Chênh lệch mass', number(massError, 'kg')],
        ['Hiệu chỉnh mass', number(metrics.correction_kg, 'kg')],
      ],
      checks: checks.map((check) => ({
        name: CHECK_NAMES[check.name] || check.name,
        status: check.status === 'pass' ? 'Đạt' : 'Không đạt',
        value: number(check.value),
        tolerance: number(check.tolerance),
      })),
      warnings,
      summaryUrl: `/api/runs/${encodeURIComponent(runId)}/summary`,
      artifactsUrl: `/api/runs/${encodeURIComponent(runId)}/artifacts`,
    };
  }

  // Count actual scene attributes, never infer measurement quality from a height alone.
  function dataQuality(buildings, provenance = {}) {
    const features = buildings?.features;
    if (!Array.isArray(features)) return { state: 'missing', total: null, groups: [] };
    const counts = { gob: 0, tagged: 0, levels: 0, fallback: 0, unknown: 0 };
    const labels = { gob: 'Ước tính vệ tinh', tagged: 'Chiều cao gắn nhãn',
      levels: 'Suy từ số tầng', fallback: 'Giá trị thay thế', unknown: 'Chưa rõ nguồn chiều cao' };
    for (const feature of features) {
      const p = feature?.properties || {}, source = String(p.height_source || '');
      const valid = typeof p.height_m === 'number' && Number.isFinite(p.height_m) && p.height_m > 0;
      const key = !valid ? 'unknown' : /^gob:/.test(source) ? 'gob'
        : (/^(direct:)/.test(source) || source === 'osm:height') ? 'tagged' : (/^levels:/.test(source) || source === 'osm:building:levels') ? 'levels'
        : (/^(fallback|median|fixed)(:|$)/.test(source) || source === 'derived:median') ? 'fallback' : 'unknown';
      counts[key]++;
    }
    return { state: features.length ? 'ready' : 'empty', total: features.length,
      counts: { ...counts },
      groups: Object.entries(counts).filter(([, count]) => count > 0)
        .map(([key, count]) => ({ key, label: labels[key], count })),
      footprint_source: typeof provenance.buildings?.footprint === 'string' ? provenance.buildings.footprint : null,
      height_source: typeof provenance.buildings?.height === 'string' ? provenance.buildings.height : null,
      geometry: 'LoD1', terrain: 'flat', materials: 'illustrative' };
  }

  function render(container, model, doc = document) {
    if (!container) return;
    const roots = [];
    function element(tag, text, className) {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    if (!model.identity) {
      roots.push(element('p', model.message, `evidence-status evidence-${model.state}`));
    } else {
      // Keep the primary scan path short: method/status, time, then source quality.
      const overview = element('section', undefined, 'result-overview');
      const header = element('div', undefined, 'result-overview-heading');
      const code = model.identity.find(([label]) => label === 'Mô hình')?.[1];
      header.append(element('h3', code === 'fv' ? 'Mô hình voxel 3D'
        : code === 'gaussian' ? 'Tham chiếu Gaussian' : 'Mô phỏng không khí'));
      header.append(element('span', model.state === 'pass' ? 'Kiểm tra: đạt' : 'Chưa đủ kiểm tra',
        `result-state evidence-${model.state}`));
      overview.append(header);
      const times = element('dl', undefined, 'result-times');
      for (const [label, name] of [['Thời gian tính', 'Thời gian tính toán'], ['Thời gian mô phỏng', 'Thời gian mô phỏng']]) {
        const metric = element('div');
        const value = model.metrics.find(([key]) => key === label)?.[1] || 'Chưa có';
        metric.append(element('dt', name), element('dd', value));
        times.append(metric);
      }
      overview.append(times);
      roots.push(overview);
      if (model.quality) {
        const q = model.quality;
        const card = element('section', undefined, 'scene-quality');
        const heading = element('div', undefined, 'quality-heading');
        heading.append(element('h3', 'Dữ liệu tòa nhà'));
        if (q.total !== null) heading.append(element('span', number(q.total) + ' nhà', 'quality-count'));
        card.append(heading);
        if (q.total === null) card.append(element('p', 'Chưa có thông tin chiều cao.', 'quality-empty'));
        else if (!q.total) card.append(element('p', 'Chưa có tòa nhà trong khu vực này.', 'quality-empty'));
        else {
          const sources = element('dl', undefined, 'quality-sources');
          sources.append(element('dt', 'Hình dạng'), element('dd', q.footprint_source?.replace(' contributors', '') || 'Chưa rõ nguồn'));
          sources.append(element('dt', 'Chiều cao'), element('dd', q.height_source?.replace(' 2.5D Temporal', '') || 'Chưa rõ nguồn'));
          card.append(sources);
          // One complete source does not need a second repeated building count.
          if (q.groups.length === 1 && q.groups[0].count === q.total) {
            const captions = {
              gob: '100% chiều cao ước tính từ ảnh vệ tinh.',
              tagged: '100% dùng chiều cao gắn nhãn trong dữ liệu.',
              levels: '100% chiều cao suy từ số tầng.',
              fallback: '100% dùng chiều cao thay thế.',
              unknown: '100% chưa rõ nguồn chiều cao.',
            };
            card.append(element('p', captions[q.groups[0].key] || q.groups[0].label, 'quality-coverage'));
          } else {
            const coverage = element('dl', undefined, 'quality-sources quality-breakdown');
            for (const group of q.groups)
              coverage.append(element('dt', group.label), element('dd', number(group.count)));
            card.append(coverage);
          }
        }
        roots.push(card);
      }
      // Keep this caveat visible; explanations and raw provenance remain available separately.
      const caveat = element('aside', undefined, 'model-caveat');
      caveat.append(element('strong', 'Lưu ý'), element('p', 'Nồng độ được tính từ mô hình theo kịch bản đã chọn, không phải số đo tại hiện trường.'));
      roots.push(caveat);
      if (model.warnings.some(warning => !/not.?validated|not field validation|not validated against field observations/i.test(warning)))
        roots.push(element('p', 'Có cảnh báo dữ liệu.', 'model-warning'));
    }
    container.replaceChildren(...roots);
  }

  const api = { number, viewModel, render, dataQuality };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ViewerEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
