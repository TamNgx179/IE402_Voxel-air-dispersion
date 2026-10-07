# Giả định phát thải

> **File sinh tự động — không sửa tay.** Tạo bởi `src/emission/assumptions.py` lúc 2026-10-07 14:44 UTC. Chạy lại pipeline phát thải để cập nhật. Mọi số dưới đây đọc từ `config/project.yaml` hoặc đo từ file pipeline đã ghi; bước chưa chạy ghi `not-run`.

## 1. Bảng giả định

| # | Giả định | Giá trị | Nguồn | Hệ quả / hạn chế |
|---|---|---|---|---|
| 1 | Mạng đường là đồ thị `drive` của OSM, **mỗi phố hai chiều tính một lần** | 67 cạnh, 6395.5 m; tertiary 32 cạnh / 3132 m, residential 27 cạnh / 2723 m, primary 3 cạnh / 277 m, secondary 5 cạnh / 263 m | OSM qua osmnx; bỏ cạnh ngược trùng ở `emission/roads.py::drop_reverse_duplicates` | Phố đi bộ Nguyễn Huệ (`highway=pedestrian`) không phát thải — đúng. Hướng lưu thông không phải trọng số |
| 2 | Phân bổ theo **cấp đường** (`highway=`), trọng số → tỉ trọng phát thải | tertiary 0.50 → 57.6 %, residential 0.25 → 25.0 %, primary 1.00 → 10.2 %, secondary 0.75 → 7.3 % | **Giả định mô hình, không có số đếm** (`config/project.yaml` `emissions.allocation`) | Bất định lớn nhất của nguồn thải; cần phân tích độ nhạy trọng số |
| 3 | **Không dùng `maxspeed`** | — | Độ phủ thẻ OSM trên miền: `maxspeed` 47 %, cấp đường 100 % | Không mô tả được ùn tắc / tốc độ |
| 4 | Hệ số phát thải xe máy | **0.053 g/(xe·km)**, nhãn `PM` | Tran et al. (2024), IOP Conference Series: Earth and Environmental Science 1391 012007 (10.1088/1755-1315/1391/1/012007) — đo ở **Hà Nội** | **Bị triệt tiêu khi chuẩn hoá EDGAR**: không ảnh hưởng trường S cuối; chỉ còn dùng cho phép đối chiếu lưu lượng ở §2 |
| 5 | Nhãn chất ô nhiễm | proxy `PM` → đích `PM2.5` | config | EF là PM tổng, EDGAR là PM2.5: chỉ dùng tỉ lệ không gian của PM, không dùng trị tuyệt đối |
| 6 | Chiều cao nguồn | 1.0 m → tầng voxel k = 0 (tâm 1 m) | ống xả xe máy | Không có rối do xe cộ (spec *Ngoài phạm vi*, AC-25) |
| 7 | Đoạn đường nằm dưới voxel rắn bị loại, phần còn lại **chuẩn hoá lại trên toàn miền** | 0.0010 % proxy bị loại; 59/67 cạnh cắt miền | `emission/rasterizer.py` | Bảo toàn tổng; lượng bị loại phân bổ lên mọi đường chứ không lên ô khí gần nhất — với tỉ lệ này ảnh hưởng không đáng kể |
| 8 | Tổng phát thải đặt bằng **EDGAR** | EDGAR v8.1 TRO 2022: flux 1.229e-11 kg m⁻² s⁻¹ → **3.073e-06 kg/s** cho miền 500 × 500 m | European Commission, Joint Research Centre (JRC), EDGAR v8.1 Global Air Pollutant Emissions | EDGAR là **trung bình ô 0,1° (~11 km)**, gồm cả vùng ít xe; áp cho lõi Quận 1 nhiều khả năng **thấp hơn thực tế** — xem §2 |
| 9 | Lệch năm | EDGAR 2022 ↔ khí tượng 2025-01-01 – 2025-12-31 | config | Chấp nhận được cho phân bố không gian; không dùng để so trị tuyệt đối theo năm |
| 10 | **Flux trung bình năm** áp cho **một giờ gió tựa dừng** | không có hệ số theo giờ trong ngày | thiết kế mô hình | Nồng độ là mức **đại diện trung bình**, không phải giờ cao điểm |
| 11 | Nồng độ nền (background) | 0 | thiết kế mô hình | Chỉ là **phần đóng góp của giao thông trong miền**; không so thẳng được với trạm quan trắc |

## 2. Đối chiếu độc lập: EDGAR ngụ ý bao nhiêu xe?

`lưu lượng (xe/h) = tổng EDGAR (g/s) ÷ Σ(EF · trọng số · km) (g/xe) × 3600 × trọng số cấp`

| Cấp đường | Trọng số | Lưu lượng xe máy EDGAR ngụ ý |
|---|---|---|
| primary | 1.00 | **99 xe/h** |
| secondary | 0.75 | **74 xe/h** |
| tertiary | 0.50 | **49 xe/h** |
| residential | 0.25 | **25 xe/h** |

**Trạng thái: `computed`.** Số liệu công bố để đối chiếu (bối cảnh, không phải số đếm trong miền mô hình):

- Nút giao Hàng Xanh: cao điểm ~22.000 xe/h (tổng mọi hướng), 85–90 % xe máy — Nguyen H.K. (2026), Mathematical Modelling of Engineering Problems 13(5):889-896, doi:10.18280/mmep.130509. *Giới hạn:* tổng một nút giao lớn, số 'reported' từ Sở GTVT, không phải một đoạn đường; nút nằm ngoài miền mô hình.
- Xe máy chiếm 80 % số xe đếm trên 70 tuyến phố TP.HCM (06:00-19:00, 2021) — Ho et al. (2022), International Journal of Environmental Research and Public Health, doi:10.3390/ijerph192316156. *Giới hạn:* tỉ lệ thành phần, không có lưu lượng theo từng tuyến.

**Đọc:** lưu lượng EDGAR ngụ ý (hàng chục tới ~100 xe/h mỗi tuyến) thấp hơn **rất nhiều** so với bậc lưu lượng xe máy ở lõi TP.HCM. Nhất quán với việc EDGAR là trung bình ô ~11 km. Kết luận: nồng độ tuyệt đối là **cận dưới**; phân bố không gian và so sánh giữa kịch bản không bị ảnh hưởng, vì mô hình tuyến tính theo nguồn. Web có hệ số nhân phát thải để khảo sát độ nhạy này.

## 3. Dùng kết quả thế nào

- **Dùng được:** phân bố không gian, gradient theo độ cao, so sánh giữa kịch bản gió, tỉ lệ vượt ngưỡng tương đối.
- **Không dùng được như số đo:** nồng độ µg/m³ tuyệt đối. Báo cáo phải gọi là *nồng độ mô phỏng chuẩn hoá theo EDGAR*, không gọi là dự báo chất lượng không khí.
