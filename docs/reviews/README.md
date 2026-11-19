# Bàn giao B8/B9 — 01/11/2026

Bằng chứng mới nhất: [nghiệm thu checkout sạch và đối chiếu chiều cao 16/11](RELEASE_EVIDENCE_20261116.md).
Các đợt trước: [kiểm tra và bundle candidate 02/11](CONTINUATION_20261102.md).
Trạng thái từng task xem [ROADMAP](../ROADMAP.md); trang này giữ lịch sử review.

Các báo cáo dưới đây được giữ trong Git; bản gốc cùng dữ liệu/hình nằm trong
`artifacts/` (bị Git bỏ qua). Các review gốc mô tả kết quả tại thời điểm review,
không phải xác nhận mọi ghi chú đã được sửa.

- [Vùng và comparison](B8_1_REGION_COMPARISON.md): review độc lập và phần tiếp nối đóng R1; fixture khớp scene, SQL bảo vệ mask và PostGIS đã chạy lại.
- [Lưới và bước thời gian](B8_B9_GRID_STUDY.md): thiết kế, pilot/full, bảng số,
  giới hạn GCI và hướng tái lập; B8.2/B8.3/B9.1 đã có đầu ra.
- [Mặt cắt và chiều cao](B9_4_TRANSECT_HEIGHT.md): PASS có ghi chú; cần E2E
  PostGIS đã chạy lại trong đợt tiếp nối bên dưới.
- [Khả thi LoD2](B9_5_LOD2_FEASIBILITY.md): quyết định giữ LoD1.
- [Lựa chọn PM2.5 và kích thước voxel](PM25_VOXEL_DECISIONS.md): lý do chọn chất ô nhiễm, ô 5 × 5 × 2 m và kết quả đổi độ phân giải.
- [Kiểm toán khoa học](THANH_SCIENCE_AUDIT.md): đối chiếu NetCDF/API độc lập và độ nhạy đô thị.
- [Nghiệm thu 16/11](RELEASE_EVIDENCE_20261116.md): PM2.5 theo độ cao tại Nguyễn Huệ, benchmark AIJ Case H và rehearsal checkout sạch.

## Kiểm tra tiếp nối

Chạy lại toàn bộ Python: **304 passed**, 12 warnings (NumPy/NetCDF và API
deprecation), 38.54 s. Lệnh dùng Python 3.12.15 đã có trên máy, do executable
của `.venv` trỏ tới đường dẫn cũ không tồn tại:

```powershell
$env:PYTHONPATH='.venv/Lib/site-packages'
$env:MPLBACKEND='Agg'
New-Item -ItemType Directory -Force artifacts/continuation-check
& 'C:/Users/thanh/AppData/Roaming/uv/python/cpython-3.12.15-windows-x86_64-none/python.exe' -m pytest --basetemp artifacts/continuation-check/fresh-tmp -p no:cacheprovider
```

Đây là cách chạy tạm trên máy hiện tại, không phải môi trường cài đặt mới.
Log được lưu ở `artifacts/continuation-check/pytest-final.txt`. Đã bổ sung
ghi chú không dùng DEM vào RESEARCH để khôi phục yêu cầu tài liệu hiện có.

Lượt đầu `npm run test:e2e` trong `app/`: **17 passed, 79 skipped**. Đã thay assertion
`cell-picker-form` cũ bằng `map-cell-mode`, phù hợp UI chọn ô hiện tại.
PostGIS tại localhost:5433 từ chối kết nối và Docker daemon chưa chạy;
không coi các test bị skip là PASS tích hợp. Khi DB sẵn sàng, dùng
`npm run test:e2e:required` để không bỏ qua kiểm tra DB bắt buộc.

### Chạy lại PostGIS ngày 01/11/2026

Đã khởi động Docker Desktop và `docker --context desktop-linux compose up -d
--wait db`; PostGIS healthy ở cổng 5433. Chạy `npm run test:e2e:required`
với `PYTHON_BIN` trỏ Python 3.12.15, `PYTHONPATH` tuyệt đối tới
`.venv/Lib/site-packages`, `MPLBACKEND=Agg` và TEMP/TMP trong
`artifacts/continuation-check`: **96/96 passed, 0 skipped**, 6 file test,
23.79 s. Bao gồm 21 test spatial analysis, 16 test transect và 2 test solver
thật dry/wet. Báo cáo máy đọc: `artifacts/a7-api-e2e.json`.
Các ghi chú chưa chạy DB trong review gốc là lịch sử; lần chạy này bổ sung
bằng chứng tích hợp. Đây là lượt trước sửa R1; kết quả tiếp nối bên dưới thay thế trạng thái còn mở này.

## Tiếp nối A8.1/B8.1/A9.5

R1 đã đóng bằng fixture đúng scene, tham chiếu B và query PostGIS có mask guard.
Required E2E sau sửa: **98/98 pass, không skip**; 23 spatial và 16 transect.
Hai case real executor đối chiếu NetCDF → CSV writer → importer → DB → profile/slice API.
Writer đã dùng float32 + `.9g`; các repository trả float8 trước JSON.
Web **113/113 pass**; thông tin nguồn/chiều cao đã kiểm trên browser cảnh 62 nhà,
và tải JSON snapshot có chất lượng dữ liệu. Chi tiết ở phần tiếp nối review B8.1.

## Còn mở (cập nhật 19/11/2026)

1. B9.3: lấy bảng/hình hai mùa từ đúng bộ release sau khi freeze. B8.4/B9.2 giảm nguồn đã hoàn thành ngày 07/11.
2. B10.1/A10.5: pin một revision release và chốt freeze; CI, benchmark và rehearsal sạch hiện ở ba revision khác nhau.
3. R5/R6/R7 trong review B8.1 là giới hạn/đề xuất; không mở rộng kết luận sang lưới dz thập phân hoặc miền khác baseline.
4. Run cũ xuất `.6g` không tự trở thành dữ liệu precision mới; tạo run mới khi chốt bộ demo/release.

Đã đóng sau đợt này: A10.2 theo phương án GitHub CI (02/11), A10.3 (09/11) và
B9.4 với hạn chế chiều cao tháp đã ghi (19/11). Không thay scene, mask hoặc
artifact production. Chưa chốt release/tag.
