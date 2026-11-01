# Bàn giao B8/B9 — 01/11/2026

Các báo cáo dưới đây được giữ trong Git; bản gốc cùng dữ liệu/hình nằm trong
`artifacts/` (bị Git bỏ qua). Các review gốc mô tả kết quả tại thời điểm review,
không phải xác nhận mọi ghi chú đã được sửa.

- [Vùng và comparison](B8_1_REGION_COMPARISON.md): PASS có ghi chú; R1 fixture
  không khớp solid scene còn mở, chưa đóng XG-2.
- [Lưới và bước thời gian](B8_B9_GRID_STUDY.md): thiết kế, pilot/full, bảng số,
  giới hạn GCI và hướng tái lập; B8.2/B8.3/B9.1 đã có đầu ra.
- [Mặt cắt và chiều cao](B9_4_TRANSECT_HEIGHT.md): PASS có ghi chú; cần E2E
  PostGIS đã chạy lại trong đợt tiếp nối bên dưới.
- [Khả thi LoD2](B9_5_LOD2_FEASIBILITY.md): quyết định giữ LoD1.

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
bằng chứng tích hợp. Fixture solid R1 vẫn còn mở dù suite hiện tại pass.

## Còn mở

1. Sửa fixture/mask B8.1 R1 rồi chạy lại E2E PostGIS trước khi đóng XG-2.
2. Writer `src/solver.py` vẫn xuất `.6g`; review đề xuất `.9g` để giữ float32
   khi round-trip. Chưa sửa writer hoặc tái sinh/import run cũ trong đợt này.
3. B9.3: tổng hợp hai mùa và caption báo cáo cuối. B8.4/B9.2 giảm nguồn
   chưa được triển khai, không gộp vào kết luận nghiên cứu Gaussian.
4. `.venv` cần được tạo lại trước khi dùng trực tiếp executable trong đó.

Chưa tạo commit. Giữ nguyên scene, mask, solver và các run production.
