# Dàn slide bảo vệ — bản thảo 02/11/2026

Nội dung trình chiếu cần chuyển thành deck, bổ sung hình có chú giải và số
production cùng release. Chưa coi file Markdown là slide cuối đã nghiệm thu.

1. **Bài toán:** nồng độ theo chiều cao và vật cản trong miền đô thị. Hình cảnh,
   câu hỏi nghiên cứu; nói rõ đóng góp nguồn theo kịch bản.
2. **Chọn mô hình GIS:** voxel so với B-rep/CSG; hình một ô và sáu ô kề.
   Đánh đổi geometry, truy vấn và chi phí bộ nhớ.
3. **Dữ liệu:** OSM/GOB, EDGAR, gió; CRS, đơn vị, provenance. Hình nguồn chiều cao.
4. **Kiến trúc:** web → NestJS → PostGIS/Python → artifacts. Phân biệt run nền
   với request; sơ đồ trong ARCHITECTURE.
5. **CSDL:** ERD, khóa ứng viên và hai phụ thuộc hàm tiêu biểu. Minh họa
   `(run_id,i,j,k)` và cách đọc `c_ug_m3[k+1]`. Giải thích ô rắn, ô thiếu dữ liệu
   và giá trị 0. Chiếu execution plan vùng đệm và chỉ rõ GiST lọc ứng viên ở đâu.
6. **Physics:** gió bảo toàn khối lượng và FV tải–khuếch tán. Gaussian là baseline.
7. **Verification:** wind spike, positivity, mass ledger và CFL. Hình vector quanh
   nhà, đơn vị và ngưỡng rõ ràng.
8. **Sai số:** đồ thị lưới và dt từ bundle 02/11; 10/10 case đạt. Sai số giảm không
   có nghĩa toàn trường/cảnh đô thị đã grid-converged.
9. **Hai mùa và cao độ:** bảng/ảnh cùng thang màu từ bộ production mới; ghi độ cao
   yêu cầu và tâm tầng. Không lấy số candidate lịch sử làm release.
10. **Demo GIS:** hỏi nồng độ thay đổi thế nào theo khoảng cách đến đường và độ cao.
    Chọn cùng một đoạn đường, so ba dải khoảng cách ở hai khoảng cao độ, rồi
    kiểm một ô bằng profile và mở CSV. Chuẩn bị PNG/CSV/JSON từ cùng run ID.
11. **Độ nhạy và hạn chế:** K/chiều cao, upwind, nguồn proxy; khoảng hở đỉnh miền
    tối thiểu 9 m, 3 tag OSM ≥100 m, chưa có kiểm định quan trắc.
12. **Kết quả và hướng tiếp:** chỉ kết luận trong phạm vi kiểm được. Cải thiện dữ
    liệu chiều cao, thử miền cao hơn và bổ sung quan trắc; trả lời Q&A cùng A/B.

Mỗi hình cần caption, trục/đơn vị, run_id hoặc đường dẫn evidence; cỡ chữ phải đọc
được khi chiếu. Rehearsal và thời lượng thực tế vẫn cần ghi nhận.
