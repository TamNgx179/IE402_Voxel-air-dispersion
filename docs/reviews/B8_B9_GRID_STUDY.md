# B8.2/B8.3/B9.1 — Nghiên cứu lưới và bước thời gian

Ngày tổng hợp: 01/11/2026. Nguồn: `artifacts/grid-study/design.json`,
`summary.json`, `summary.csv` và manifest từng case. Đây là kiểm chứng số
trên Gaussian puff với gió đều, K hằng, mặt đất kín và không có nhà.
Không suy ra các run đô thị đã hội tụ lưới hoặc đã được kiểm định quan trắc.

## Thiết kế và kết quả

Miền 440 × 300 × 80 m, khối lượng ban đầu 1 kg, thời điểm so sánh 100 s.
Ba lưới h/dz = 10/4, 5/2, 2.5/1 m; cùng miền, nguồn và điều kiện biên.
Sweep không gian dùng cùng dt = 0.152439 s. Sweep CFL dùng dt theo từng
lưới. Sweep thời gian giữ lưới 5/5/2 m, chia dt cho 1/2/4/8 và tham chiếu /32.

| h/dz (m) | L2 tương đối, dt chung | L2 tương đối, dt CFL | Runtime dt chung (s) | Peak memory (MiB, xấp xỉ) |
|---|---:|---:|---:|---:|
| 10/4 | 0.462663 | 0.391438 | 0.19 | 64 |
| 5/2 | 0.305247 | 0.280803 | 2.12 | 135 |
| 2.5/1 | 0.178177 | 0.178177 | 17.72 | 711 |

Full study có 10 case, tất cả qua verification; sai số cân bằng khối lượng
cao nhất khoảng 4.3e-14. Thời gian tổng được lưu là 48.99 s, dưới ngân sách
1200 s. Các số runtime là số đo của lần chạy đã lưu, phụ thuộc máy.

Sai số không gian giảm khi tinh lưới nhưng còn lớn. Sai số thời gian L2
so với tham chiếu cùng lưới giảm 0.050543 → 0.023556 → 0.010796 → 0.004586;
bậc từ sai phân liên tiếp là 1.081 và 1.039, phù hợp Euler bậc một.
Sai số tổng so với nghiệm giải tích tăng nhẹ khi giảm dt vì sai số không
gian/thời gian có thể bù nhau; không chọn dt bằng cách tối thiểu hóa riêng
sai số tổng này.

## Giới hạn GCI và ổn định

Đỉnh nồng độ có observed order 0.183, ngoài dải chấp nhận quanh bậc một:
không diễn giải GCI của đỉnh như một ước lượng đáng tin cậy. Một số moment
có bậc phù hợp nhưng dải GCI vẫn không phủ nghiệm giải tích (variance x và
centroid z). Tham số `valid` trong JSON chỉ phản ánh tiêu chí của thuật toán,
không bảo đảm dải sai số chứa nghiệm đúng. Không công bố một GCI chung cho
toàn trường hoặc cho cảnh đô thị.

Probe CFL: Cr=0.5 không có lỗi positivity; Cr=1 gây nồng độ âm và bị chặn
ở cả lưới coarse/medium. Cr=0.75 có hệ số đường chéo âm dù puff này chưa
phát sinh lỗi; không coi đó là bằng chứng ổn định tổng quát. Giữ cấu hình
production Cr=0.5; không đổi lưới hoặc solver từ nghiên cứu này.

## Tái lập và hình cho báo cáo

Chạy `python -m src.grid_study run --stage pilot --out artifacts/grid-study/pilot`
rồi `python -m src.grid_study run --stage full --out artifacts/grid-study`.
Mỗi case chạy trong tiến trình riêng để đo memory. Hash nguồn/config và
phiên bản Python/NumPy/SciPy nằm trong `summary.json`.

- `fig_error_vs_h.png`: sai số theo lưới, dt chung; so với cell average giải tích.
- `fig_error_vs_h_cfl.png`: sai số khi dùng quy tắc dt production ở từng lưới.
- `fig_error_vs_dt.png`: sai số thời gian với tham chiếu cùng lưới, kèm sai số tổng.
- `fig_profile_x.png`: khối lượng theo x tại 100 s, thể hiện khuếch tán số upwind.

Các hình và tensor nằm trong `artifacts/` và không được Git theo dõi;
chạy lại lệnh trên để tạo. B9.3 vẫn cần tổng hợp thêm kết quả hai mùa và caption
cho báo cáo cuối. B8.4/B9.2 (giảm nguồn) chưa được thực hiện bởi gói này.
