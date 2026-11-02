# Báo cáo tổng hợp — GIS 3D voxel và lan truyền PM2.5

Bản thảo ngày 02/11/2026 để review A10.4/B10.2. Chưa phải báo cáo đã nghiệm thu;
cần bổ sung tên thành viên, định dạng của giảng viên và bộ số production cùng release.

## 1. Bài toán và phạm vi

Xây dựng mô hình GIS 3D cho một miền đô thị 500 × 500 × 100 m, biểu diễn
vật cản và nồng độ PM2.5 theo chiều cao. Đầu ra cho phép xem lát ngang, profile,
mặt cắt theo tuyến, thống kê vùng và so sánh hai kịch bản gió đại diện mùa khô/mưa.
Đây là mô phỏng đóng góp của nguồn theo kịch bản; không phải AQI, số đo hay dự báo
sức khỏe. Nền nồng độ bằng 0 không đại diện toàn bộ PM2.5 thực tế.

## 2. Lựa chọn mô hình GIS và dữ liệu

| Mô hình | Khả năng | Đánh đổi trong bài toán này |
|---|---|---|
| Mảng voxel 3D | Lưu trường C, mask rắn/khí và quan hệ sáu ô kề trực tiếp | Tốn bộ nhớ và lượng tử hóa mặt nhà theo kích thước ô |
| B-rep | Biểu diễn biên nhà sắc nét | Cần lưới thể tích riêng để giải trường trong không khí |
| CSG | Mô tả vật thể bằng phép toán khối | Không trực tiếp biểu diễn trường nồng độ và thông lượng trên miền |

Chọn lưới đều 100 × 100 × 50, dx = dy = 5 m, dz = 2 m; thứ tự mảng z,y,x.
Tâm ô dùng cho raster hóa/lấy mẫu. Độ cao yêu cầu 1,5 m đọc tầng [0,2), tâm 1 m;
15 m đọc tầng [14,16), tâm 15 m. Không nội suy theo chiều đứng.

Footprint và đường có nguồn OSM; chiều cao cảnh hiện tại của 62 nhà dùng GOB.
Phát thải EDGAR phân bổ xuống đường bằng proxy, không thay thế số đếm giao thông.
Nguồn, CRS, checksum và giả định được lưu cùng config/manifest; xem
[RESEARCH](RESEARCH.md) và [giả định phát thải](emission_assumptions.md).

## 3. Kiến trúc và ánh xạ dữ liệu

Web GIS gọi NestJS modular monolith. Backend ghi run_id và config snapshot,
chạy Python subprocess ở nền, kiểm manifest/verification rồi nhập kết quả truy vấn
vào PostgreSQL/PostGIS. Tensor đầy đủ lưu NetCDF; không chuyển mảng 3D qua JSON.
Các cột kết quả trong DB phục vụ lát, profile, tuyến và polygon. Mask rắn phân biệt
NULL trong nhà với nồng độ 0 hợp lệ; API/CSV giữ số đã lưu.

Sơ đồ kiến trúc: [ARCHITECTURE](ARCHITECTURE.md). ERD, index, truy vấn và số đo:
[DATABASE](DATABASE.md). Hợp đồng API/solver và ca nghiệm thu: [spec](spec.md).

## 4. Phương pháp mô phỏng

Trường gió chẩn đoán được hiệu chỉnh bảo toàn khối lượng, có mask vật cản.
SOR dùng cho spike; production dùng hệ thưa/CG theo cấu hình. Tải–khuếch tán
giải bằng thể tích hữu hạn, upwind bậc một và bước thời gian thỏa điều kiện ổn định.
Kiểm divergence, dòng xuyên tường, positivity, cân bằng khối lượng và hội tụ trước
khi công nhận run thành công. Gaussian là baseline có giả thiết khác, không phải
nghiệm đúng để validation cảnh đô thị.

## 5. Kiểm tra số trị và kết quả

Wind spike lưu bằng chứng SOR hội tụ, divergence dưới ngưỡng và dòng lệch quanh
vật cản. Nghiên cứu puff giải tích tách sai số không gian/thời gian trên cùng miền
vật lý. Các đại lượng này kiểm chương trình giải phương trình, không chứng minh
mô hình khớp quan trắc đô thị.

Nghiên cứu lưới chạy lại ngày 02/11 ở
`artifacts/release-candidate-20261102/grid-study/`: 10/10 case qua verification.
Sai số L2 tương đối ở ba lưới với dt chung giảm 0,462663 → 0,305247 → 0,178177.
Không công bố GCI chung cho toàn trường; không suy ra cảnh có nhà đã hội tụ lưới.
Phương pháp và giới hạn ở [review lưới](reviews/B8_B9_GRID_STUDY.md).

Bộ candidate mới ngày 02/11 ở `artifacts/release-candidate-20261102/production/`
có 5/5 ca đạt verification và hội tụ trạng thái ổn định. Đã kiểm checksum/size
35 artifact khai báo trong năm manifest; chưa đóng freeze/release.

| Mùa | Độ cao yêu cầu / tâm tầng (m) | Mean (µg/m³) | Max (µg/m³) | run_id |
|---|---|---:|---:|---|
| Khô | 1,5 / 1 | 0,200461 | 0,890170 | `412ca814-f36c-405a-bb43-2bea88306760` |
| Khô | 15 / 15 | 0,062825 | 0,322770 | `412ca814-f36c-405a-bb43-2bea88306760` |
| Mưa | 1,5 / 1 | 0,197119 | 0,842742 | `55ddebf0-7556-41eb-a92a-edf446aa94ed` |
| Mưa | 15 / 15 | 0,063943 | 0,273018 | `55ddebf0-7556-41eb-a92a-edf446aa94ed` |

Mean tầng tính trên ô khí. Trên cùng 7.683 cột khí ở hai tầng, trung vị C15/C1
là 0,3060 (khô) và 0,3018 (mưa); tỷ lệ cột có C15 > C1 lần lượt 1,35% và 1,00%.
Các cột có nồng độ tầng trên cao hơn không bị xóa để ép gradient đơn điệu.
Đổi gió đại diện làm mean ở tầng 1 m giảm khoảng 1,67% nhưng ở 15 m tăng khoảng
1,78%; chưa đủ để suy ra quan hệ khí hậu hoặc hiệu ứng mưa rửa trôi.

Ba ca độ nhạy cùng nguồn/điều kiện tương ứng: `k_half`
(`2ca08700-4561-4679-9ad3-9707f27818a3`), `height_low`
(`e8075146-8433-4aa2-aa05-cb0112788513`) và `height_high`
(`feec73f6-59ad-455b-9924-d0ddcb8adb56`). Các số là kết quả mô hình,
không phải khoảng tin cậy thống kê. Bảng/hình FV–Gaussian và độ nhạy được tạo
bằng `python -m src.production_analysis --root artifacts/release-candidate-20261102/production
--include-root artifacts/release-candidate-20261102/no-extra-runs`.
Đường include rỗng ngăn lẫn ca lịch sử vào bảng cùng đợt.

| Đối chiếu với baseline khô | Thay đổi mean toàn miền | Thay đổi max toàn miền |
|---|---:|---:|
| K ngang/đứng ×0,5 | +8,77% | +43,46% |
| Chiều cao ×0,8 | −3,87% | −1,95% |
| Chiều cao ×1,2 | +3,77% | +2,16% |

Mean toàn miền lấy trên ô khí của từng ca; thay chiều cao cũng đổi tập ô khí.
Vì vậy đây không phải so sánh trên cùng tập voxel giữa các ca hình học.
FV–Gaussian có MAE/RMSE lần lượt 0,011872/0,032441 µg/m³ (khô) và
0,011355/0,035183 µg/m³ (mưa), tính trên ô có dữ liệu ở cả hai trường. Chúng
định lượng khác biệt hai mô hình, không phải sai số so quan trắc.

Hình trong cùng thư mục production: `vertical-comparison.png` (mean/max theo
tâm tầng, hai mùa), `height-slices.png` (lát 1/15 m, chung thang log),
`convergence.png` (relative L1 theo thời gian mô phỏng) và `geometry-overlay.png`
(footprint/mask mặt đất). Hình lưới nằm ở thư mục grid-study cùng đợt.

## 6. Chất lượng chiều cao và giới hạn

Audit tái lập bằng `python -m src.analysis.height_audit --out artifacts/height-audit`.
Cảnh hiện tại có 62 nhà dùng GOB, không nhà nào chạm đỉnh miền 100 m;
khoảng cách nhỏ nhất đến đỉnh miền là 9 m (4,5 dz). Có 14 tag OSM height đọc được,
trong đó 3 tag từ 100 m trở lên. OSM không mặc nhiên là ground truth.
Hai nhà thấp hơn tâm voxel đầu 1 m không tạo voxel rắn theo quy tắc tâm ô.

Khoảng hở 9 m không chứng minh điều kiện biên trên đủ xa. Cần thí nghiệm thay
đỉnh miền và kiểm nguồn chiều cao trước khi kết luận ảnh hưởng của tháp cao.
Không dùng phép nhân chiều cao ±20% thay thế cho thí nghiệm miền hoặc xác minh
GOB/OSM. Khuếch tán số upwind, phát thải proxy, địa hình phẳng, LoD1 và thiếu
quan trắc theo chiều cao đều hạn chế diễn giải. Chưa có căn cứ khẳng định ảnh
hưởng sai chiều cao tới tầng thấp là nhỏ.

LoD render thay số geometry hiển thị, giữ nguyên mask và kết quả solver.
Giữ LoD1 theo [review LoD2](reviews/B9_5_LOD2_FEASIBILITY.md); chưa có nguồn mái
được kiểm chứng để nâng mô hình hình học.

## 7. Tái lập và điều kiện bàn giao

Lệnh cài đặt, Compose, preflight, luồng demo và phục hồi ở [README](../README.md).
Môi trường làm việc hiện tại dùng `.venv-work/Scripts/python.exe`; danh sách
dependency đã cài được lưu local tại `artifacts/verification-20261102/`.

Trước bàn giao cần chốt bộ nghiên cứu/freeze cùng revision, kiểm responsive/bàn phím/
hiệu năng, hình dự phòng và review chéo báo cáo/slide. Bộ demo ca82a50 đã pin riêng;
PostGIS E2E tại máy đạt 98/98. Theo lựa chọn người dùng khi không có máy cá nhân khác,
[GitHub-hosted CI](https://github.com/TamNgx179/IE402_Voxel-air-dispersion/actions/runs/41465927344)
đã kiểm độc lập SHA 02185fb: build/seed, hai solver thật, checksum, query và restart.
Đây là VM ngoài laptop, chưa phải thử trên PC cá nhân thứ hai hoặc UI automation;
chi tiết phạm vi ở ROADMAP A10.2. Freeze B7 vẫn là candidate lịch sử và báo cáo này
chưa phải phê duyệt release khoa học.
