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

  function render(container, model, doc = document) {
    if (!container) return;
    const nodes = [];
    function element(tag, text, className) {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    nodes.push(element('p', model.message, `evidence-status evidence-${model.state}`));
    if (model.identity) {
      for (const [title, values] of [['Nhận dạng', model.identity], ['Số liệu solver', model.metrics]]) {
        nodes.push(element('h3', title));
        const list = element('dl', undefined, 'evidence-values');
        values.forEach(([label, value]) => {
          list.append(element('dt', label), element('dd', value));
        });
        nodes.push(list);
      }
      const table = element('table', undefined, 'evidence-checks');
      table.setAttribute('aria-label', 'Kiểm tra số trị của run');
      const head = element('thead');
      const header = element('tr');
      ['Kiểm tra', 'Kết quả', 'Giá trị', 'Tolerance'].forEach((label) => {
        const cell = element('th', label);
        cell.setAttribute('scope', 'col');
        header.append(cell);
      });
      head.append(header);
      const body = element('tbody');
      model.checks.forEach((check) => {
        const row = element('tr');
        [check.name, check.status, check.value, check.tolerance].forEach((value) => row.append(element('td', value)));
        body.append(row);
      });
      table.append(head, body);
      const scroll = element('div', undefined, 'evidence-table-scroll');
      scroll.append(table);
      nodes.push(scroll);
      nodes.push(element('h3', 'Nguồn và hạn chế'));
      const warnings = element('ul', undefined, 'evidence-warnings');
      (model.warnings.length ? model.warnings : ['Chưa có cảnh báo nguồn dữ liệu trong run này.'])
        .forEach((warning) => warnings.append(element('li', warning)));
      nodes.push(warnings);
      nodes.push(element('p', 'Số liệu trên là output gốc của solver. Hệ số nguồn/nền minh họa không thay đổi kiểm chứng này.', 'note'));
      const links = element('p', undefined, 'evidence-links');
      [['JSON số liệu', model.summaryUrl], ['Danh sách artifact / checksum', model.artifactsUrl]].forEach(([label, url]) => {
        const link = element('a', label);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener';
        links.append(link);
      });
      nodes.push(links);
    }
    container.replaceChildren(...nodes);
  }

  const api = { number, viewModel, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ViewerEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
