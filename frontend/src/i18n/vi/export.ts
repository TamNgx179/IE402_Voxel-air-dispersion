import type { Messages } from '../types';
import type en from '../en/export';

const exportCopy: Messages<typeof en> = {
  noRun: 'Chọn một kết quả đã tải xong.',
  finishDrawing: 'Hoàn tất hoặc hủy vẽ trước khi xuất.',
  modeOriginal: 'Kết quả gốc',
  modeAdjusted: 'Minh họa đã điều chỉnh',
  notice: 'Ảnh minh họa từ mô hình; không thay thế số liệu gốc CSV hoặc quan trắc. {wind} Cửa sổ minh họa.',
  windHidden: 'Đã ẩn gió.',
  windPaused: 'Gió đang dừng.',
  windMoving: 'Gió hiển thị ×6.',
  legendTitle: 'Nồng độ (µg/m³, thang log)',
  thresholdLegendTitle: 'Vùng vượt ngưỡng (µg/m³)',
  thresholdNotice: ' Màu vùng theo ngưỡng; nơi không vượt được làm nhạt.',
  defaultAttribution: 'OpenStreetMap contributors; OpenFreeMap/OpenMapTiles',
};
export default exportCopy;
