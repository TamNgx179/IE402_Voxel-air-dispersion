import type { Messages } from '../types';
import type en from '../en/compare';

const compare: Messages<typeof en> = {
  modeLabel: 'So sánh kết quả',
  title: 'So sánh kết quả',
  helpLabel: 'Cách so sánh kết quả',
  help: 'Chọn kết quả thứ hai để xem chênh lệch cùng cao độ. Gió và thống kê ngoài mục này vẫn thuộc kết quả gốc.',

  baseline: 'Gốc: {label}',
  noBaseline: 'Chưa có kết quả gốc.',
  run: 'Kết quả so sánh',
  runPlaceholder: 'Chọn kết quả so sánh',
  view: 'Hiển thị trên bản đồ',
  'view.off': 'Bản đồ thông thường',
  'view.baseline': 'Gốc · dữ liệu chính xác',
  'view.comparison': 'So sánh · dữ liệu chính xác',
  'view.delta': 'Chênh lệch · so sánh − gốc',
  retry: 'Cập nhật so sánh',

  'note.modified': 'Tắt hệ số/nền minh họa (×1, nền 0) để phân tích dữ liệu gốc.',
  'note.choose': 'Chọn một kết quả so sánh.',
  'note.loading': 'Đang tải số liệu…',
  'note.off': 'Chọn lớp xem để bật so sánh.',
  'note.loaded': '{cells} ô khí · {z} m',
  'note.noAir': 'Tầng không có ô khí chung.',

  'summary.deltaScale': 'ΔC: {min} → 0 → {max} µg/m³ · so sánh − gốc',
  'summary.linearScale': '0 → {max} µg/m³ · thang tuyến tính chung',
  'summary.meanBaseline': 'Trung bình · gốc',
  'summary.meanComparison': 'Trung bình · so sánh',
  'summary.meanDelta': 'Chênh lệch trung bình',
  'summary.noShared': 'Không có ô khí chung để so sánh.',
  'summary.same': 'Hai kết quả có cùng nồng độ trung bình ở tầng này.',
  'summary.higher': 'Kết quả so sánh cao hơn gốc {value} µg/m³ ở tầng này.',
  'summary.lower': 'Kết quả so sánh thấp hơn gốc {value} µg/m³ ở tầng này.',
  'summary.barBaseline': 'Gốc',
  'summary.barComparison': 'So sánh',
  noData: 'Không có dữ liệu',

  waitForComparison: 'Chờ kết quả so sánh tải xong rồi thử lại.',
  'report.baseline': 'Kết quả gốc',
  'report.comparison': 'Kết quả đối chiếu',
  'report.delta': 'Chênh lệch: so sánh − gốc',
};
export default compare;
