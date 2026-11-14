import type { Messages } from '../types';
import type en from '../en/errors';

const errors: Messages<typeof en> = {
  'api.timeout': 'Kết nối quá thời gian. Bạn có thể thử lại.',
  'api.network': 'Không kết nối được API. Kiểm tra ứng dụng và mạng.',
  'api.invalid': 'API trả dữ liệu không hợp lệ. Kiểm tra đúng ứng dụng/cổng đang chạy.',
  'api.notFound': 'Không tìm thấy dữ liệu. Hãy chọn lại kết quả.',
  'api.conflict': 'Dữ liệu chưa sẵn sàng hoặc không tương thích. Hãy chọn lại kết quả.',
  'api.permission': 'Bạn chưa có quyền truy cập dữ liệu này.',
  'api.server': 'Ứng dụng chưa xử lý được yêu cầu. Hãy thử lại sau.',
  'api.validation': 'Thông tin chưa hợp lệ. Kiểm tra lại lựa chọn của bạn.',
  unknown: 'Đã có lỗi. Vui lòng thử lại.',
  noStudyArea: 'DB chưa có study area; chạy db:seed.',
  runNotFound: 'Không tìm thấy run {id}.',
  windMismatch: 'Trường gió không khớp kết quả.',
  mapUnavailable: 'Không khởi tạo được bản đồ trên trình duyệt này (cần WebGL).',
};
export default errors;
