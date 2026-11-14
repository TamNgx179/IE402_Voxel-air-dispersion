import type { Messages } from '../types';
import type en from '../en/illustration';

const illustration: Messages<typeof en> = {
  toolLabel: 'Minh họa',
  title: 'Điều chỉnh minh họa',
  helpLabel: 'Giải thích điều chỉnh minh họa',
  help: 'Chỉ thay đổi nồng độ minh họa trên bản đồ; không chạy lại solver hoặc đổi dữ liệu truy vấn gốc.',
  multiplier: 'Hệ số nguồn',
  multiplierEdgar: '× 1 (EDGAR)',
  background: 'Nồng độ nền (µg/m³)',
  reset: 'Về dữ liệu gốc',
};
export default illustration;
