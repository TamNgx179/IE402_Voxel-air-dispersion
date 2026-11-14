import type { Messages } from '../types';
import type en from '../en/mapOptions';

const mapOptions: Messages<typeof en> = {
  toolLabel: 'Bản đồ',
  title: 'Lớp bản đồ',
  helpLabel: 'Giải thích lớp bản đồ',
  help: 'Bật hoặc tắt lớp hiển thị. Các lựa chọn này không thay đổi dữ liệu mô phỏng.',
  gridSize: 'Ô {dx} × {dy} m · lưới {nx} × {ny}',

  basemap: 'Nền bản đồ',
  basemapVector: 'Nền sáng',
  basemapRaster: 'Đường phố OSM',

  buildings: 'Toà nhà',
  facades: 'Chi tiết mặt đứng',
  facadesHelpLabel: 'Giải thích chi tiết mặt đứng',
  facadesHelp: 'Cửa sổ và vật liệu là minh họa. Hình khối và chiều cao tòa nhà lấy từ dữ liệu GIS.',
  buildingSelected: 'Tòa nhà đã chọn · {height} m',
  roads: 'Đường',
  wind: 'Gió chuyển động',
  windHelpLabel: 'Giải thích gió chuyển động',
  windHelp: 'Vệt đi theo trường gió mô phỏng, hiển thị nhanh gấp 6 lần để dễ quan sát; không phải khói ô nhiễm.',
  windLoading: 'Đang tải trường gió của kết quả.',
  windMissing: 'Chưa có dữ liệu gió cho kết quả này.',

  resultInfo: 'Thông tin kết quả',
  resultInfoHelpLabel: 'Giải thích mô hình và thời gian',
  resultInfoHelp:
    'Thời gian tính: thời gian máy chạy. Thời gian mô phỏng: thời gian diễn biến trong mô hình. Nhà mái phẳng, nền cao độ 0; cửa sổ minh họa.',

  exportLabel: 'Xuất kết quả',
  exportTitle: 'Tải kết quả',
  exportPng: 'Ảnh',
  exportPngLabel: 'Tải ảnh bản đồ PNG',
  exportCsv: 'CSV',
  exportCsvLabel: 'Tải số liệu CSV',
  exportJson: 'JSON',
  exportJsonLabel: 'Tải thông tin kết quả JSON',
  exportPreparing: 'Đang chuẩn bị tệp…',
  exportDone: 'Đã tải tệp.',
  exportFailed: 'Chưa xuất được: {message}',

  'error.mapBusy': 'Chờ bản đồ tải xong và dừng di chuyển rồi thử lại.',
  'error.mapNotReady': 'Bản đồ chưa sẵn sàng.',
  'error.captureTimeout': 'Chưa lấy được khung hình. Hãy thử lại.',
  'error.changed': 'Lựa chọn đã thay đổi. Hãy xuất lại.',

  'png.title': 'PM2.5 · {title}',
  'png.layer': 'Tầng {min}–{max} m · tâm {centre} m · {mode}',
  'png.run': 'Run: {run}',
  'png.comparisonRun': ' | So sánh: {run}',
  'png.model': 'Model: {model} | Input: {input}',
  'png.comparisonModel': 'Model so sánh: {model} | Input: {input}',
  'png.source': 'Nguồn: {attribution}',
  'png.exported': 'Xuất: {time} | GIS LoD1, nền phẳng z=0 | Camera: {camera}',
};
export default mapOptions;
