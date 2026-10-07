# B1–B4 — bằng chứng triển khai của người B

Tài liệu này phân biệt **smoke/integration verification** với production-grid result. Mốc B1–B4
hoàn thiện contract và đường chạy thật; benchmark lưới `100 × 100 × 50`, steady state và kết
quả khoa học cuối thuộc B5.

## B1 — baseline, contract và phạm vi

- Entrypoint duy nhất: `python -m src.solver run --run-id UUID --config config.yaml --out DIR`.
- Exit code: `0` thành công, `2` input, `3` model/gate, `4` system; stdout chỉ chứa progress JSON.
- Tên đúng: **mass-consistent diagnostic wind + explicit finite-volume advection–diffusion**.
  Không gọi là CFD, Röckle đầy đủ hoặc validation thực địa.
- Runtime tối thiểu được đóng băng trong `requirements-solver.txt`; pipeline đầy đủ vẫn dùng
  `requirements.txt`.
- External cross-check chốt cho giai đoạn sau: **MUST wind-tunnel dataset**. Chỉ số dự kiến:
  FAC2, fractional bias (FB), NMSE; nếu chỉ chạy case lý tưởng hoá thì ghi là external
  cross-check, không nâng thành validation khu vực Nguyễn Huệ.

## B2 — input và Gaussian baseline

- Tensor chuẩn dùng thứ tự `[z,y,x]`, CRS chiếu mét và đơn vị có kiểm tra fail-closed.
- Source thật phải là `S[z,y,x]`, `kg m-3 s-1`, hữu hạn, không âm và không nằm trong solid.
- Scene package hiện có 62 building, 67 road, 1 water, 17 green và 10.000 grid cell; mỗi file
  có SHA-256 trong `scene_manifest.json`.
- Gaussian baseline nhận cùng contract source đã EDGAR-normalised cho hai scenario và được
  giữ là baseline có nhãn, không phải kết quả chính. Regression test hiện dùng source smoke
  nhỏ đúng đơn vị; chưa tuyên bố đã chạy production source khi file processed chưa có local.
- `input_hash` bao gồm config chuẩn hoá, checksum scene và checksum source; `run_id` không làm
  thay đổi hash.

Máy sạch chưa có raw EDGAR/processed NetCDF không được tự bịa source. Smoke test tạo source
nhỏ có đơn vị thật; production input phải được tái tạo bằng pipeline B2 trước B5.

## B3 — verification số trị

Test suite bao phủ advection 2D, diffusion `σ²=2Kt`, CFL, positivity trước correction, mass
budget, solid wall, numerical diffusion và convention `(u,v,w)=(x,y,z)`. Không clip giá trị
âm vượt tolerance. Correction round-off và mass bị loại khỏi solid đều có ledger.

## B4 — real solver subprocess

Luồng không có `--mock`:

```text
config + scene + S
  → power-law background wind
  → SOR mass-consistent projection
  → corrected uf/vf/wf
  → FV transport dùng trực tiếp face flux
  → wind.nc + concentration.nc + columns.csv.gz + metrics.json
  → verification gate + checksum manifest + solver.log
```

`wind.nc` chứa cả `u,v,w` tâm ô và `uf,vf,wf` so le. Gate gồm CFL, divergence của chính
face field, positivity correction, wall flux, mass balance và SOR convergence. Smoke test 3D
có obstacle chạy đúng đường real CLI; mock chỉ còn phục vụ test nhanh cho API.

## Lệnh nghiệm thu

```powershell
.\.venv\Scripts\python.exe -m pytest -q
cd app
npm test -- --runInBand
npm run test:e2e
```

Lần nghiệm thu 07/10/2026:

- Python: **207 pass, 9 skip** trên 216 test; processed release input đã có nên các test
  provenance/output liên quan được chạy thật thay vì skip.
- NestJS unit: **87 pass, 1 skip**.
- NestJS E2E: **42 pass**, gồm real Python solver E2E qua PostGIS.
- `npm run build`: pass.

Real smoke CLI và real exit-3 failure manifest đều chạy trong suite, không bị skip. Không copy
các số trên thành benchmark production; B5 phải đo lại lưới `100 × 100 × 50`.
