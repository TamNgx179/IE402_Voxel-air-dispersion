import type { Messages } from '../types';
import type en from '../en/transect';

const transect: Messages<typeof en> = {
  modeLabel: 'Mặt cắt đứng',
  title: 'Mặt cắt đứng',
  helpLabel: 'Cách vẽ tuyến mặt cắt',
  help: 'Bấm từ 2 điểm trên bản đồ, rồi Hoàn tất tuyến để xem nồng độ theo khoảng cách và độ cao.',
  draw: 'Vẽ tuyến',
  redraw: 'Vẽ lại tuyến',
  finish: 'Hoàn tất tuyến',
  cancel: 'Hủy tuyến',
  clear: 'Xóa tuyến',
  min: 'Cao độ bắt đầu (m)',
  max: 'Cao độ kết thúc (m)',
  query: 'Xem mặt cắt',
  queryAgain: 'Xem lại mặt cắt',
  querying: 'Đang lấy mặt cắt…',
  notePickTwo: 'Chọn ít nhất 2 điểm.',
  noteOne: 'Đã chọn 1/2 điểm.',
  noteCount: '{count} điểm · có thể hoàn tất.',
  noteChosen: 'Tuyến đã chọn · {count} điểm.',
  noteKept: 'Giữ tuyến đã chọn trước đó.',
  loading: 'Đang lấy dữ liệu theo tuyến…',
  refresh: 'Bấm Xem mặt cắt để cập nhật.',
  illustration: 'Đang dùng minh họa. Vào Minh họa → Về dữ liệu gốc để phân tích.',
  csvDone: 'Đã tải bảng mặt cắt.',
  currentResult: 'Kết quả đang chọn',
  resultTitle: 'Mặt cắt nồng độ',
  resultHelpLabel: 'Cách đọc mặt cắt',
  resultHelp:
    'Ngang: khoảng cách. Dọc: cao độ trên nền phẳng. Chọn ô hoặc dùng phím mũi tên để đọc giá trị tại tâm ô, không nội suy.',
  context: '{run} · tuyến {length} m · cao độ {min}–{max} m',
  empty:
    'Tuyến và khoảng cao độ này không có mẫu không khí. Vẽ tuyến khác hoặc mở rộng cao độ; ô trống không có nghĩa là nồng độ bằng 0.',
  chartLabel:
    'Mặt cắt đứng: trục ngang là khoảng cách, trục dọc là cao độ. Nhấn vào ô hoặc dùng các phím mũi tên để đọc giá trị.',
  chartFallback: 'Dữ liệu mặt cắt có thể tải dưới dạng CSV.',
  scale: '0 → {max} µg/m³ · tuyến tính',
  legendSolid: 'Tòa nhà',
  legendNoData: 'Thiếu dữ liệu',
  axisZ: 'Cao độ (m)',
  axisDistance: 'Khoảng cách từ đầu tuyến (m)',
  download: 'Tải CSV',
  downloading: 'Đang tải…',
  close: 'Đóng mặt cắt',
};
export default transect;
