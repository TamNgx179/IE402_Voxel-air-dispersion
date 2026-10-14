# Evidence snapshot tuần 7

`week7-candidate.json` là snapshot nhỏ của kết quả nghiệm thu trên candidate
ngày 14/10/2026. Nó giữ counts, run IDs, input/source/report hashes, số liệu
layer/sensitivity, verification và captions; không giữ tensors hay log lớn.

Các report gốc nằm dưới `artifacts/week7/` và có SHA-256 trong snapshot.
Một checkout mới dùng runbook để tái tạo chúng. Không có raw report trên
checkout mới không đồng nghĩa đã chạy lại kiểm thử; snapshot chỉ ghi lượt
nghiệm thu được nêu trong metadata.

```powershell
node scripts/verify-week7-snapshot.mjs
```

Lệnh trên kiểm snapshot với model freeze/code đang có, không chạy lại
solver hoặc browser. Sau khi tái lập đủ suite/production/cleanroom:

```powershell
node scripts/evidence-index.mjs
node scripts/snapshot-week7.mjs
```

Snapshot yêu cầu tất cả reports pass, không cho science/E2E skip thành
pass. Candidate được kiểm trước commit nên model version có `-dirty`;
source/config hashes xác định nội dung, không lấy commit trước đó làm
bằng chứng rằng toàn bộ changes đã tồn tại trong commit đó.

Tuần 8 vẫn cần final report, máy demo thứ hai, release tag và rehearsal.
10/10 candidate gates ở đây không tự tạo một release cuối kỳ.
