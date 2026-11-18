# Lựa chọn PM2.5 và kích thước voxel

## Vì sao chọn PM2.5?

PM2.5 là nhóm hạt rắn hoặc giọt lỏng lơ lửng trong không khí có đường kính khí động học khoảng 2,5 µm trở xuống. Hạt đủ nhỏ để có thể đi sâu vào đường hô hấp. Trong kết quả mô phỏng, nồng độ tính bằng µg/m³, tức khối lượng bụi trên một mét khối không khí. [Giải thích thuật ngữ của U.S. EPA](https://www.epa.gov/pm-pollution/particulate-matter-pm-basics)

Nhóm chọn PM2.5 vì đề tài khảo sát phát thải giao thông đô thị và bộ dữ liệu EDGAR v8.1 có ước tính phát thải PM2.5 cho ngành giao thông đường bộ. Nhóm dùng EDGAR để ước tính lượng phát thải trong miền rồi phân bổ xuống mạng đường theo quy tắc đại diện. Cùng một loại chất ô nhiễm và một cách phân bổ nguồn được dùng để so sánh giữa các vị trí, độ cao và kịch bản. Kết quả biểu diễn phần nồng độ do nguồn giao thông được mô hình hóa đóng góp. Để đánh giá tổng nồng độ ngoài thực địa, cần dữ liệu nồng độ nền, các nguồn phát thải khác và quan trắc tương ứng. [Giả định phát thải của đồ án](../emission_assumptions.md)

## Vì sao dùng voxel 5 × 5 × 2 m?

Voxel là một ô thể tích trong lưới ba chiều. Mô hình phân loại ô thuộc công trình và ô không khí, rồi tính nồng độ cho các ô không khí. Với miền 500 × 500 × 100 m, kích thước 5 × 5 × 2 m tạo lưới 100 × 100 × 50, tổng cộng 500.000 ô. [Đặc tả kỹ thuật](../spec.md)

- **5 × 5 m theo mặt bằng** cho phép mô hình biểu diễn vị trí tương đối của đường và công trình với chi phí tính toán phù hợp. Rìa công trình, đường hẹp và các chi tiết dưới kích thước ô được biểu diễn gần đúng khi đưa lên lưới.
- **2 m theo chiều đứng** để phân biệt các lớp không khí gần mặt đất. Chẳng hạn, lớp 0–2 m có tâm ở 1 m và lớp 2–4 m có tâm ở 3 m. Nếu ô cao 5 m, cả hai khoảng này cùng nằm trong tầng 0–5 m và chỉ nhận một giá trị nồng độ đại diện trên mỗi cột. Lớp 14–16 m có tâm ở 15 m, thuận tiện để đối chiếu với lớp sát mặt đất.

### Kết quả đo khi thay đổi độ phân giải

Trong phép thử chiều đứng, nhóm giữ ô ngang 5 × 5 m và dùng cùng bước thời gian. Lưới cao 1 m là tham chiếu số. Mức chênh trường nồng độ được tính trên phần thể tích khí chung trong khoảng cao độ 0–100 m.

| Chiều cao ô | Chênh lệch L2 tương đối so với lưới 1 m | Thời gian chạy ghi nhận |
| --- | ---: | ---: |
| 1 m | Tham chiếu | 201,4 s |
| 2 m | 4,67% | 94,7 s |
| 4 m | 11,01% | 50,1 s |

Lưới 2 m có mức chênh nhỏ hơn lưới 4 m và mất khoảng 47% thời gian chạy của lưới 1 m trong phép thử này. L2 tương đối đo sự khác biệt giữa các kết quả mô phỏng. Thời gian chạy phụ thuộc vào cấu hình và máy thực hiện. Các số trên được đọc từ kết quả cục bộ trước đợt dọn dữ liệu ngày 18/11/2026. Có thể tạo lại thử nghiệm bằng [script khảo sát lưới đứng](../../scripts/study-vertical-resolution.py).

Trong một phép thử mặt bằng riêng, nhóm giữ chiều cao ô 2 m và so với lưới ngang 2,5 m. Trên bộ thống kê hành lang đường được chọn, mức chênh L2 tương đối là **0,66%** với ô ngang 5 m và **2,88%** với ô ngang 10 m. Phép thử dùng một kịch bản mùa khô, cùng bước thời gian và thời lượng mô phỏng 90 s. Số liệu mô tả bộ thống kê đã kiểm tra trong phạm vi đó. Kết quả cục bộ đã được dọn ngày 18/11/2026. Chế độ `numerics` của [script khảo sát đô thị](../../scripts/study-urban-robustness.py) tạo lại phép thử này.

## Nếu tăng hoặc giảm kích thước voxel thì sao?

Giữ nguyên miền 500 × 500 × 100 m, số ô thay đổi như sau.

| Kích thước voxel | Số ô theo ba chiều | Tổng số ô |
| --- | --- | ---: |
| 10 × 10 × 4 m | 50 × 50 × 25 | 62.500 |
| 5 × 5 × 2 m | 100 × 100 × 50 | 500.000 |
| 2,5 × 2,5 × 1 m | 200 × 200 × 100 | 4.000.000 |

- **Tăng kích thước ô** làm giảm số ô cần tính và lưu trữ. Mỗi giá trị đại diện cho một vùng lớn hơn, nên biến thiên gần mặt đất, rìa công trình và các dải nồng độ hẹp có thể bị làm thô.
- **Giảm kích thước ô** cho phép biểu diễn hình học và biến thiên nồng độ chi tiết hơn, đồng thời tăng bộ nhớ, dung lượng kết quả và chi phí tính. Với bộ giải bước thời gian hiện tại, lưới mịn có thể cần bước thời gian ngắn hơn để đáp ứng điều kiện ổn định. Chia đôi cả ba chiều làm số ô tăng 8 lần. Nếu chỉ giảm chiều cao từ 2 m xuống 1 m, số ô tăng gấp đôi lên 1.000.000.

Các số ô trong bảng được tính theo kích thước miền. Thử nghiệm lưới đứng và lưới ngang ở trên thay đổi từng nhóm chiều riêng. Khi đổi kích thước ô trong một lần chạy mới, cần tạo lại lưới, ô công trình và phân bổ nguồn tương ứng, rồi so sánh các kết quả tại cùng vị trí hoặc cùng vùng vật lý. [Nghiên cứu lưới và bước thời gian của nhóm](B8_B9_GRID_STUDY.md) · [Hướng dẫn của NASA về khảo sát tinh lưới](https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html)
