# Công trình 3D và luồng gió

## Mặt đứng minh họa — 12/10/2026

Theo yêu cầu mới, viewer **không sử dụng texture ảnh thật**. Đã bỏ tải ảnh, lớp
Bitmap/UV và nút xem texture Sunwah. Registry texture rỗng đã được gỡ vì không còn nơi sử dụng.
Ảnh thử nghiệm trước đó được lưu ngoài web tại `artifacts/former-texture-pilot/`
(local, không commit), có thể khôi phục nếu cần nghiên cứu sau.

Nhà dùng bảng màu ngà/pearl/xám xanh rất nhạt, kính xanh ít bão hòa. Ambient +
key/fill được cấu hình riêng để không trắng chói hay tối xám; không dùng specular.
Cửa sổ thưa hơn, ít biến thiên màu; chi tiết mờ khi zoom xa và rõ dần khi zoom gần.
Ánh sáng cố định chỉ phục vụ đọc bản đồ, không phải mô hình ánh sáng mặt trời.
Nguồn và lập luận tham khảo Esri/Cesium/MapLibre/CityOnStats/VoxCity ở
[RESEARCH.md](../../../docs/RESEARCH.md#tham-khảo-cách-dựng-và-hiển-thị-công-trình-gis-3d--12102026).
Màu/cửa sổ sinh ổn định theo building ID, chỉ là minh họa ngoại hình, **không phải**
ảnh khảo sát, số tầng thật hay mô hình LoD2/LoD3. Footprint/chiều cao GIS, solid mask,
DB và kết quả solver không đổi. Mặt đứng lệch ra ngoài 8 cm chỉ để tránh z-fighting.
Có thể tắt Chi tiết mặt đứng để so sánh.

## Luồng gió

Không còn đầu mũi tên: dùng các vệt ngắn, mờ dần ở hai đầu, chuyển động liên tục.
Hạt di chuyển theo `u,v,w` solver; đường vệt tích phân ngược qua trường vận tốc
với midpoint và bước tối đa 1/4 ô nhỏ nhất. Dừng khi thiếu mẫu, gặp solid hoặc biên.
Giới hạn 48 điểm/vệt để giữ chi phí render có kiểm soát. Không thêm dao động ngẫu
nhiên, xoáy giả hoặc vận tốc nền để ép gió xuyên nhà.

Animation phóng thời gian 6 lần nhằm quan sát; vệt là ký hiệu trực quan của trường
gió steady, không phải khói, nồng độ PM2.5 hay mô phỏng rối transient. Gió gần zero
di chuyển chậm; zero không vẽ vệt. Pause/reduced-motion/tab ẩn vẫn được giữ.

## Ảnh pilot cũ (chỉ lưu nghiên cứu, không hiển thị)

`sunwah-delso-2013.jpg`: Diego Delso, delso.photo, CC BY-SA 3.0, chụp 14/08/2013.
[Nguồn](https://commons.wikimedia.org/wiki/File:Sun_Wah_Tower,_Ciudad_Ho_Chi_Minh,_Vietnam,_2013-08-14,_DD_01.JPG),
[giấy phép](https://creativecommons.org/licenses/by-sa/3.0/).
SHA256: `92f041bdf2f3dde92846b8648128692c040ad12dd0fa8829491a5f211846a8db`.
Không phân phối ảnh nếu không kèm attribution/giấy phép phù hợp.
