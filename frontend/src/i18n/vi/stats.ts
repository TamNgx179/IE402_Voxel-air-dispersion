import type { Messages } from '../types';
import type en from '../en/stats';

const stats: Messages<typeof en> = {
  toolLabel: 'Thống kê',
  title: 'Nồng độ tầng đang xem',
  helpLabel: 'Cách đọc thống kê nồng độ',
  help: 'Số liệu thuộc tầng đang xem. Trung bình tính trên các ô không khí có dữ liệu; cao nhất là giá trị lớn nhất trong tầng.',
  context: 'Tầng {min}–{max} m',
  contextAdjusted: 'Tầng {min}–{max} m · Minh họa',
  mean: 'Trung bình',
  max: 'Cao nhất',

  thresholdTitle: 'Tô vùng vượt ngưỡng',
  thresholdHelpLabel: 'Cách xem vùng vượt ngưỡng',
  thresholdHelp: 'Chọn ngưỡng để tô phần vượt trên bản đồ. Ngưỡng 24 giờ chỉ để tham khảo; số liệu mô phỏng không thay cho quan trắc.',
  thresholdToggle: 'Tô vùng vượt {label}: {value} µg/m³',
  thresholdNone: 'Chưa có số liệu.',
  thresholdLoading: 'Đang tải số liệu…',
  thresholdFailed: 'Chưa tải được số liệu.',
  thresholdZero: 'Không có ô nào có nồng độ lớn hơn {value} µg/m³ ở tầng này.',
  thresholdArea: '{area} m² vượt ngưỡng ở tầng này.',

  cellTitle: 'Ô được chọn',
  cellSectionLabel: 'Xem từng ô',
  cellHelpLabel: 'Cách xem một ô',
  cellHelp: 'Bấm một ô trên bản đồ để xem nồng độ tại các tầng cao độ của ô đó.',
  profileLoading: 'Đang tải dữ liệu theo độ cao…',
  profileFailed: 'Chưa tải được dữ liệu theo độ cao.',
  profileSourceExact: 'Dữ liệu truy vấn',
  profileSourceAdjusted: 'Ước tính điều chỉnh (minh họa)',
  profileChartLabel: 'Profile nồng độ theo độ cao tại ô {i}, {j}',
  profileAxisX: 'Nồng độ (µg/m³, log)',
  profileAxisY: 'Độ cao (m)',
  profileSummary: 'Ô {i}, {j} · cao nhất {max} µg/m³',
  profileTableToggle: 'Xem dạng bảng số liệu',
  profileTableCaption: 'Nồng độ theo tầng tại ô {i}, {j}',
  profileColLevel: 'Tầng',
  profileColHeight: 'Độ cao (m)',
  profileColValue: 'Nồng độ (µg/m³)',
  profileSolid: 'Tòa nhà',
  profileCurrent: '(tầng đang xem)',
};
export default stats;
