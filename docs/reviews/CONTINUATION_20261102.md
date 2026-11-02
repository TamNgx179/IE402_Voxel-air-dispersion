# Tiếp nối nghiệm thu — 02/11/2026

Đợt này tạo evidence candidate mới, chưa xác nhận release hoặc thay freeze B7.
Không đổi scene production, tham số physics hoặc artifact lịch sử.

## Thay đổi

- Tạo `.venv-work` từ Python 3.13.15, cài requirements; không dùng `.venv`
  trỏ Python người dùng cũ. Dependency thực tế lưu local trong
  `artifacts/verification-20261102/python-dependencies.txt`.
- Test persisted wind spike dùng Matplotlib Agg để không phụ thuộc Tk/desktop.
- Thêm `src.analysis.height_audit`: SHA-256 config/GeoJSON, nguồn chiều cao,
  khoảng tới đỉnh miền và tag OSM đối chiếu. Audit không chứng minh độ nhạy physics.
- Production analysis có so sánh cao độ trên cùng cột khí cho cả hai mùa;
  giữ 0 hợp lệ, loại cặp thiếu dữ liệu và không chia cho 0 khi tính tỷ số.
- Bản thảo [báo cáo](../FINAL_REPORT.md), [dàn slide](../FINAL_SLIDES.md),
  hướng dẫn sửa môi trường trong README. Chưa có deck/in báo cáo được nghiệm thu.

## Kết quả kiểm tra

| Kiểm tra | Kết quả |
|---|---|
| Python toàn bộ | 321 passed; 9 cảnh báo deprecation Shapely |
| Web và script Node | 130 passed, không skip |
| Backend unit | 97 passed, 1 skipped; không coi skip là PASS |
| Backend build/lint | Đạt |
| Input bundle và scene preflight | Đạt checksum |
| Grid study full mới | 10/10 case verification pass, 93,36 s trên máy hiện tại |
| Production mới | 5/5 case verification pass, hội tụ steady-state |
| Integrity production | 35 artifact trong 5 manifest khớp SHA-256 và size |
| API/PostGIS trực tiếp đợt này | Chưa kiểm; Docker daemon không chạy |
| Freeze/revision | Còn drift; working tree có thay đổi đang review |

Lệnh chạy Python (thư mục cha đã tạo):

```powershell
.venv-work/Scripts/python.exe -m pytest -p no:cacheprovider --basetemp=artifacts/verification-20261102/tmp-complete --junitxml=artifacts/verification-20261102/python.xml --tb=short
.venv-work/Scripts/python.exe -m src.analysis.height_audit --out artifacts/height-audit
.venv-work/Scripts/python.exe -m src.grid_study run --stage full --out artifacts/release-candidate-20261102/grid-study
.venv-work/Scripts/python.exe -m src.production_study --out artifacts/release-candidate-20261102/production
.venv-work/Scripts/python.exe -m src.production_analysis --root artifacts/release-candidate-20261102/production --include-root artifacts/release-candidate-20261102/no-extra-runs
```

Không chạy lại production command vào cùng thư mục rồi gộp nhiều run cùng case;
dùng thư mục mới cho mỗi đợt. Các file `artifacts/` là local và bị Git bỏ qua.

## Còn thiếu trước bàn giao

1. Review nguồn chiều cao tháp và thử miền cao hơn: 9 m khoảng hở không đủ để
   chứng nhận miền; giữ B9.4 mở. Không coi tag OSM là ground truth.
2. Review bộ candidate mới, pin revision sạch, chạy bắt buộc API/PostGIS/browser
   và chốt freeze theo quy trình; không tự thay hash chỉ để bỏ cảnh báo.
3. Đo responsive/bàn phím/hiệu năng/demo; lưu hình/video dự phòng.
4. Chạy trên máy vật lý thứ hai, hoàn thiện báo cáo in/deck, audit rubric và Q&A.
5. Quyết định làm/hoãn các ca giảm phát thải có điều kiện trước khi khóa phạm vi.

Không commit/tag/push hoặc xuất bản trong đợt này.
