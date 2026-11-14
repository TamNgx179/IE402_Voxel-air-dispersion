import type { Messages } from '../types';
import type en from '../en/common';

const common: Messages<typeof en> = {
  loading: 'Đang tải…',
  retry: 'Thử lại',
  close: 'Đóng',
  none: '–',
  notAvailable: 'Chưa có',
  unitConcentration: 'µg/m³',
  languageSwitch: 'Ngôn ngữ',
  languageEnglish: 'English',
  languageVietnamese: 'Tiếng Việt',
  switchToEnglish: 'Chuyển ngôn ngữ sang tiếng Anh',
  switchToVietnamese: 'Chuyển ngôn ngữ sang tiếng Việt',
  helpTooltip: 'Trợ giúp',
  downloadCsv: 'Tải CSV',
};
export default common;
