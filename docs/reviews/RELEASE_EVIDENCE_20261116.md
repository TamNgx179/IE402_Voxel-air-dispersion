# Đối chiếu chiều cao, benchmark AIJ và nghiệm thu IE402

Ngày 16/11/2026, kiểm tra sản phẩm tại commit `04a7c10fb5ade531f74492179c587e1e591b5252`.
Các script phân tích và kiểm chứng bổ sung chạy bên ngoài checkout dùng để dựng ứng dụng.

## PM2.5 theo độ cao tại Nguyễn Huệ

Ghép theo `(i,j)` trên cùng run FV mùa khô `5ce007fc-f25f-4b63-9cd9-2937640ba02c`.
Chỉ tính cột có dữ liệu ô khí ở cả tâm tầng 1 m và 15 m. Dữ liệu nguồn giao thông,
hình học và gió được cố định trong run. Không nội suy nồng độ giữa các voxel.

| Chỉ tiêu | Kết quả |
| --- | ---: |
| Số cột có dữ liệu ở cả hai tầng | 7.683 |
| Trung vị của tỷ số C(15 m) / C(1 m) tính theo từng cột | 0,3060 |
| Số cột giảm khi lên 15 m | 7.579 |
| Số cột tăng khi lên 15 m | 104 |
| Số cột tăng nằm trong hai hàng hoặc hai cột sát biên miền | 26 |
| Số dòng mặt cắt A–B khớp API và CSV | 464 |

| Ô (i,j) | Nồng độ ở 1 m (µg/m³) | Nồng độ ở 15 m (µg/m³) | Chênh lệch (µg/m³) |
| --- | ---: | ---: | ---: |
| (61,99), điểm A | 0,00705 | 0,07684 | +0,06979 |
| (60,99) | 0,01196 | 0,07341 | +0,06144 |
| (59,99) | 0,01692 | 0,07081 | +0,05389 |
| (14,68), điểm B | 0,89017 | 0,15782 | −0,73235 |

Ba cột tăng mạnh nhất nằm cùng hàng biên phía bắc. Kết quả cho thấy vị trí lấy mẫu
có ảnh hưởng đến kết luận theo cao độ. Phép đối chiếu này chưa xác định nguyên nhân
động lực của các ngoại lệ hoặc độ nhạy với vị trí biên miền. Giá trị là phần nồng độ
PM2.5 do nguồn giao thông đã mô hình hóa trong kịch bản mùa khô.

Hình `height-evidence.png` dùng cùng thang màu ở hai lát cắt và mặt cắt A–B.
Sai khác về trạng thái ô rắn, ô khí hoặc thiếu dữ liệu được giữ trong CSV mặt cắt.
Input hash là `sha256:ddb97847c8c8c422d366bec59be9aec352e4e9155ee61ccdf7cc399f3fb6cdbb`.
SHA-256 của manifest là `87d65509be489906614a3475239b67be2e4ac2c7556a07218bdf604c4366b7e9`.
SHA-256 của CSV mặt cắt là `ff2e47fe883738f20b0914c1eb7a4d7d6f069147c4be18103ad4e0fda94be988`.

## Kiểm tra vùng khuất gió với AIJ Case H

Dùng số đo chất đánh dấu thụ động trong hầm gió của
[AIJ Case H](https://zenodo.org/records/15429872). Giữ nguyên lưới 1 cm, trường gió,
nguồn, khuếch tán ngang và khoảng thời gian 3 s. Thay hệ số khuếch tán đứng
`Kz` bằng 0,5×, 1× và 2× giá trị gốc. Cả ba cấu hình dùng cùng bước thời gian
0,00041806 s. Sai số cân bằng tích phân của mỗi cấu hình thấp hơn 6 × 10⁻¹⁵.

Chia trạm theo vị trí dọc gió `x`, luân phiên giữ trọn trạm để kiểm tra. Tập chọn
cấu hình có 80 điểm wake và 329 điểm ngoài wake. Tập kiểm tra có 80 và 319 điểm.
Năm điểm có stencil chạm công trình bị loại như benchmark gốc. Dùng RMSE wake
trên tập chọn cấu hình để chọn hệ số, rồi chấm trên các trạm giữ riêng. Hai tập
thuộc cùng một thí nghiệm, có thể còn tương quan không gian.

| Hệ số Kz | RMSE wake, tập chọn | RMSE wake, tập kiểm tra | RMSE ngoài wake, tập kiểm tra | Thời gian vận chuyển (s) |
| --- | ---: | ---: | ---: | ---: |
| 0,5× | 12,769 | 18,503 | 2,756 | 106,0 |
| 1× | 10,955 | 16,290 | 2,818 | 112,0 |
| 2× | 10,248 | 14,723 | 2,957 | 94,8 |

RMSE dùng đại lượng nồng độ chất đánh dấu chuẩn hóa `C/C₀`. Hệ số 2× giảm khoảng
9,6% RMSE wake trên các trạm giữ riêng, đồng thời tăng khoảng 5,0% RMSE ngoài wake.
Thời gian là một lần đo cho mỗi cấu hình trên cùng máy, trong lúc chạy các phép
kiểm khác. Số bước bằng nhau. Giữ tham số sản xuất hiện tại vì hiệu quả phụ thuộc
vùng đánh giá và dữ liệu hầm gió dùng một công trình với nguồn điểm.

## Nghiệm thu và tái lập

Checkout sạch dựng Docker, seed DB mới, chạy hai kịch bản FV mùa khô và mùa mưa,
kiểm các cổng chất lượng, đối chiếu PostGIS và CSV, kiểm checksum tải xuống và
khởi động lại. Cả tám bước của rehearsal đạt, gồm Chrome headless ở desktop,
390 px và 320 px. Run mùa mưa là `144f3f63-b191-4e38-8802-a0720294b13b`.

Lượt Chrome mở rộng đạt 17 kiểm tra trên cùng image và run mùa khô. Lượt này lưu
bản đồ tại 1 m và 15 m, xác nhận CSV mặt cắt tải từ UI đúng run, mô phỏng ngắt mạng
và kiểm bản đồ trở lại trong cùng tài liệu với đúng run và tầng đã chọn. Proxy
loopback ngắt riêng máy chủ demo để kiểm cả trang dự phòng trong cache và quá trình
tự mở lại khi máy chủ phục hồi. Container và volume của stack nghiệm thu đã được dọn.

Bằng chứng cục bộ nằm trong `artifacts/score-review/release-04a7c10` và
`artifacts/score-review/wake-holdout`.

Lệnh dựng và kiểm trên checkout sạch có Chrome và Docker.

```powershell
npm ci --prefix app
node scripts/rehearse.mjs --port 3117 --out artifacts/release-check --keep
```

Từ checkout có các script phân tích, chạy các lệnh sau trong lúc máy chủ nghiệm
thu đang hoạt động. `$evidenceDir` là thư mục kết quả của rehearsal.

```powershell
node scripts/verify-height-evidence.mjs "$evidenceDir/rehearsal.json"
python scripts/plot-height-evidence.py "$evidenceDir"
$runId = (Get-Content "$evidenceDir/height-evidence.json" -Raw | ConvertFrom-Json).run_id
node scripts/viewer-smoke.mjs --base http://127.0.0.1:3117 --out "$evidenceDir/browser-extended" --evidence-run $runId
$env:PYTHONPATH = '.'
python scripts/benchmark-aij-case-h.py artifacts/score-review/aij-input artifacts/score-review/wake-holdout --compare-mixing
```

Thư mục dữ liệu AIJ cần hai CSV gốc `AF_caseH.csv` và `RS_caseH.csv`. Script
kiểm MD5 trước khi chạy và yêu cầu đường dẫn kết quả mới. Giải phóng đúng stack
đã tạo bằng tên `compose_project` trong `rehearsal.json` sau khi đã lưu bằng chứng.
