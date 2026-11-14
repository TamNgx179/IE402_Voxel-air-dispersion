import type { Messages } from '../types';
import type en from '../en/analysis';

const analysis: Messages<typeof en> = {
  toolLabel: 'Phân tích',
  title: 'Phân tích nâng cao',

  'error.invalidPolygon':
    'Vùng đã vẽ không hợp lệ. Hãy vẽ lại, tránh để các cạnh cắt nhau hoặc các điểm nằm trên cùng một đường thẳng.',
  'error.outsideArea':
    'Vùng đã chọn nằm ngoài khu vực mô phỏng. Hãy vẽ lại hoàn toàn bên trong khu vực có dữ liệu.',
  'error.heightRange':
    'Khoảng độ cao không hợp lệ. Chọn độ cao nằm trong mô hình và để độ cao bắt đầu nhỏ hơn độ cao kết thúc.',
  'error.incompatibleRuns':
    'Hai kết quả không cùng lưới hoặc mô hình tòa nhà nên không thể so sánh. Hãy chọn kết quả khác.',
  'error.notSucceeded': 'Mô phỏng chưa hoàn tất. Chọn một kết quả đã chạy thành công.',
  'error.notFound': 'Không tìm thấy kết quả mô phỏng. Hãy chọn lại kết quả.',
  'error.permission': 'Bạn chưa có quyền truy cập kết quả này.',
  'error.timeout': 'Yêu cầu mất quá nhiều thời gian. Hãy thử lại.',
  'error.network': 'Mất kết nối với ứng dụng. Kiểm tra kết nối rồi thử lại.',
  'error.server': 'Hệ thống chưa xử lý được yêu cầu. Vui lòng thử lại sau.',
  'error.conflict': 'Kết quả hiện tại chưa phù hợp để phân tích. Hãy chọn một kết quả đã hoàn tất và thử lại.',
  'error.validation': 'Thông tin phân tích chưa hợp lệ. Kiểm tra lại vùng, độ cao và ngưỡng tham chiếu.',
  'error.unknown': 'Chưa thực hiện được thao tác. Vui lòng thử lại.',
  'error.csvFailed': 'Chưa tải được bảng số liệu. {reason}',

  'error.transect.vertices': 'Tuyến cần từ 2 đến 100 điểm.',
  'error.transect.outsideArea': 'Tuyến phải nằm hoàn toàn trong khu vực mô phỏng.',
  'error.transect.outsideGrid': 'Tuyến nằm ngoài lưới hoặc trên biên ngoài cùng. Hãy vẽ vào bên trong.',
  'error.transect.zeroLength': 'Hai điểm liên tiếp phải khác nhau; tuyến cần có chiều dài.',
  'error.transect.step': 'Bước lấy mẫu phải lớn hơn 0 và không quá {max} m.',
  'error.transect.tooManySamples':
    'Mặt cắt vượt giới hạn 20.000 mẫu. Hãy rút ngắn tuyến, thu hẹp khoảng cao độ hoặc tăng bước lấy mẫu.',
  'error.transect.heightRange': 'Khoảng cao độ phải nằm trong mô hình, từ thấp đến cao.',
  'error.transect.invalidLine': 'Tuyến chưa hợp lệ. Hãy vẽ lại.',

  'error.corridor.roadMismatch': 'Một số đoạn đường không thuộc cảnh của kết quả này. Hãy chọn lại đường.',

  'polygon.minVertices': 'Cần ít nhất 3 đỉnh.',
  'polygon.invalidVertices': 'Tọa độ không hợp lệ hoặc quá nhiều đỉnh.',
  'polygon.shape': 'Cần GeoJSON Polygon với 1–20 vòng.',
  'polygon.ringSize': 'Mỗi vòng cần ít nhất 4 tọa độ, gồm điểm đóng.',
  'polygon.maxCoordinates': 'Tối đa 500 tọa độ.',
  'polygon.coordinates': 'Dùng cặp kinh độ/vĩ độ hữu hạn, không có tọa độ z.',
  'polygon.ringClosed': 'Vòng polygon phải đóng.',

  'validation.noPolygon': 'Chọn hoặc nhập vùng trước.',
  'validation.noRun': 'Chưa có run gốc.',
  'validation.modified': 'Đặt hệ số về ×1 và nền về 0 để xem số liệu gốc.',
  'validation.heightRange': 'Nhập khoảng độ cao: 0 ≤ từ < đến ≤ {max} m.',
  'validation.threshold': 'Ngưỡng tham chiếu phải là số không âm.',

  'transect.noLine': 'Vẽ một tuyến trước.',
  'transect.noRun': 'Chọn kết quả mô phỏng trước.',
  'transect.modified': 'Đưa hệ số về ×1 và nền 0 để xem dữ liệu gốc.',
  'transect.heightRange': 'Chọn khoảng cao độ: 0 ≤ từ < đến ≤ {max} m.',
  'transect.maxPoints': 'Tối đa {max} điểm trên một tuyến.',
  'transect.readingSolid': 'Tòa nhà',
  'transect.readingNoData': 'Không có dữ liệu',
  'transect.readingAir': '{value} µg/m³',
  'transect.reading': '{distance} m từ đầu tuyến · tâm tầng {z} m · ô ({i}, {j}, {k}): {reading}',

  'corridor.distanceCount': 'Nhập 1–{max} mốc khoảng cách, ví dụ 10, 25, 50.',
  'corridor.distanceRange': 'Mỗi mốc khoảng cách phải từ 0,1 đến 100 m.',
  'corridor.distanceOrder': 'Các mốc khoảng cách phải tăng dần, không trùng nhau.',
  'corridor.noRoads': 'Chọn ít nhất một đoạn đường.',
  'corridor.maxRoads': 'Chọn tối đa {max} đoạn đường.',
  'corridor.noRun': 'Chưa có kết quả gốc.',
  'corridor.roadLabel': 'Đoạn {index} · {kind} · {length} m',
  'corridor.class.primary': 'đường chính',
  'corridor.class.secondary': 'đường cấp 2',
  'corridor.class.tertiary': 'đường cấp 3',
  'corridor.class.residential': 'đường nội bộ',
  'corridor.class.service': 'đường dịch vụ',
  'corridor.class.unclassified': 'đường khác',
  'corridor.class.default': 'đường',

  'legend.compareEmptyTitle': 'Không có dữ liệu so sánh ở tầng này',
  'legend.compareEmptyLabel': 'Không có ô không khí chung có dữ liệu',
  'legend.deltaZeroTitle': 'Chênh lệch bằng 0 (µg/m³)',
  'legend.deltaZeroLabel': '0 · Không có chênh lệch ở tầng này',
  'legend.deltaTitle': 'ΔC (µg/m³, thang tuyến tính đối xứng)',
  'legend.concentrationTitle': 'Nồng độ (µg/m³, thang tuyến tính chung)',

  'export.mapNotReady': 'Bản đồ chưa sẵn sàng.',
  'export.pngFailed': 'Không tạo được ảnh PNG.',
  'export.pngCors': 'Nền bản đồ không cho phép xuất ảnh (CORS). Hãy đổi nền rồi thử lại.',

  switchLabel: 'Loại phân tích',
};
export default analysis;
