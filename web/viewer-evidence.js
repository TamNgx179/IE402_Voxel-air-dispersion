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
    const roots = [];
    function element(tag, text, className) {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    }
    const status=model.identity ? (model.state==='pass'?'Kiểm tra tính toán: đạt':'Kiểm tra tính toán: chưa đạt đầy đủ') : model.message;
    roots.push(element('p', status, `evidence-status evidence-${model.state}`));
    if (model.identity) {
      const summary=element('dl',undefined,'run-summary');
      const code=model.identity.find(([label])=>label==='Mô hình')?.[1];
      for(const [label,value] of [['Phương pháp',code==='fv'?'Mô hình khối không gian 3D':code==='gaussian'?'Mô hình tham chiếu Gaussian':'Mô phỏng không khí'],...model.metrics.filter(([label])=>['Thời gian tính','Thời gian mô phỏng'].includes(label))]) {
        summary.append(element('dt',label),element('dd',value));
      }
      roots.push(summary,element('p','Kết quả từ mô hình, chưa được xác nhận bằng đo đạc thực tế. Kiểm tra tính toán không phải đánh giá chất lượng không khí.','science-caution'));
      if(model.warnings.some(warning=>!/not.?validated|not field validation|not validated against field observations/i.test(warning))) {
        roots.push(element('p','Dữ liệu có cảnh báo bổ sung. Cần kiểm tra nguồn dữ liệu trước khi dùng cho báo cáo.','science-caution'));
      }
    }
    container.replaceChildren(...roots);
  }

  const api = { number, viewModel, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ViewerEvidence = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
