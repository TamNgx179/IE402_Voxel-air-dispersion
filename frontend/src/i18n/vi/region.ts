import type { Messages } from '../types';
import type en from '../en/region';

const region: Messages<typeof en> = {
  modeLabel: 'Theo vùng',
  title: 'Phân tích vùng',
  helpLabel: 'Cách vẽ vùng phân tích',
  help: 'Bấm ít nhất 3 điểm trên bản đồ rồi Hoàn tất. Chọn khoảng cao độ để tính nồng độ trong vùng.',

  draw: 'Vẽ vùng',
  redraw: 'Vẽ lại vùng',
  finish: 'Hoàn tất',
  cancel: 'Hủy vẽ',
  clear: 'Xóa vùng',

  'note.selected': 'Vùng đã chọn · {count} đỉnh.',
  'note.keptPrevious': 'Giữ vùng đã chọn trước đó.',
  'note.runChanged': 'Vùng giữ nguyên; phân tích lại để xem kết quả mới.',
  'note.noRun': 'Chọn một kết quả mô phỏng trước khi khoanh vùng.',
  'note.start': 'Chọn ít nhất 3 điểm.',
  'note.maxVertices': 'Tối đa {max} đỉnh.',
  'note.progress': 'Đã chọn {count}/3 điểm.',
  'note.ready': '{count} điểm · có thể hoàn tất.',
  'note.inputChanged': 'Bấm Phân tích vùng để cập nhật.',

  heightTitle: 'Khoảng cao độ',
  min: 'Độ cao từ (m)',
  max: 'Đến độ cao (m)',
  threshold: 'Ngưỡng tham chiếu (µg/m³)',
  thresholdHelpLabel: 'Giải thích ngưỡng tham chiếu',
  thresholdHelp:
    'Tính phần thể tích khí vượt mức này. Chỉ tham khảo mô hình, không đánh giá chất lượng không khí thực tế.',

  query: 'Phân tích vùng',
  requery: 'Phân tích lại',
  querying: 'Đang phân tích…',

  'feedback.illustration': 'Đang dùng minh họa. Vào Minh họa → Về dữ liệu gốc để phân tích.',
  'feedback.loading': 'Đang tính thống kê trong vùng…',
  'feedback.csvDone': 'Đã tải bảng CSV.',

  resultLabel: 'Kết quả phân tích vùng',
  resultTitle: 'Kết quả trong vùng',
  resultHelpLabel: 'Cách đọc kết quả vùng',
  resultHelp:
    'Trung bình tính theo thể tích không khí, bỏ ô rắn và ô thiếu dữ liệu. Đây không phải số đo không khí thực tế.',
  export: 'Tải CSV',
  exporting: 'Đang tải CSV…',

  'summary.context': '{run} · {min}–{max} m',
  'summary.runFallback': 'Kết quả đang chọn',
  'summary.noAir':
    'Không có dữ liệu không khí trong vùng và khoảng độ cao này. Thử vùng khác hoặc mở rộng khoảng độ cao.',
  'summary.noAirNote': 'Không có dữ liệu không đồng nghĩa với nồng độ bằng 0.',
  'summary.mean': 'Nồng độ trung bình',
  'summary.max': 'Nồng độ cao nhất',
  'summary.exceedance': 'Thể tích vượt ngưỡng',
  'summary.airVolume': 'Thể tích không khí',
  'summary.exceeds': '{percent}% thể tích khí vượt {threshold} µg/m³ ({volume} m³).',
  'summary.noExceedance': 'Không có phần không khí vượt {threshold} µg/m³ trong vùng đã chọn.',
  'summary.area': 'Diện tích: {area} m².',
  'summary.layersTitle': 'Nồng độ theo độ cao',
  'summary.tableLabel': 'Bảng nồng độ theo độ cao, cuộn để xem các tầng',
  'summary.caption': 'Nồng độ theo tầng (µg/m³); chỉ tính phần nằm trong khoảng độ cao đã chọn',
  'summary.colCentre': 'Tâm tầng (m)',
  'summary.colMean': 'Trung bình',
  'summary.colMax': 'Cao nhất',
  noData: 'Không có dữ liệu',
};
export default region;
