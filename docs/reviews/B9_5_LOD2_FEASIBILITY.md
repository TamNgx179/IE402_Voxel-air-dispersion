# B9.5: Đánh giá khả thi LoD2 (hình dạng mái)

- Người thực hiện: B (chủ dữ liệu GIS). Ngày: 01/11/2026.
- Miền: "Nguyen Hue", Quận 1, TP.HCM. Tâm 10,7746 N / 106,7035 E, hình vuông 500 × 500 m, UTM 48N (EPSG:32648).
  Cảnh có 62 nhà (`db/seeds/scene/scene_manifest.json`). Lưới solver dx = dy = 5 m, dz = 2 m.
- Phạm vi: chỉ đánh giá và ra quyết định. Không sửa hình học, scene, mask, solver hay tài liệu hiện có.

## 0. Kết luận

**KHÔNG LÀM: giữ LoD1** (footprint OSM, mái phẳng, extrude theo `height_m`).

- **Dữ liệu:** OSM hiện tại có **0/62 nhà** mang bất kỳ tag mái nào. 10 `building:part` trong bbox cũng có 0 tag mái.
- **Nguồn khác:** không có nguồn mở nào cho hình dạng mái tại khu vực này mà vừa có giấy phép rõ ràng vừa có độ phân giải đủ.
- **Quy định:** BR-53 và E-27 bắt giữ LoD1 khi thiếu nguồn mái kiểm chứng, và cấm tự bịa mái.
- **Đề bài:** giảng viên không bắt buộc LoD2 (spec §3, ROADMAP dòng 16).

## 1. Đối chiếu tham chiếu của ROADMAP

Dòng B9.5 trong ROADMAP ghi "Spec G; TC-ROOF". Hai nhãn này **không còn** trong `docs/spec.md` hiện tại (đã tìm "TC-ROOF", "G", "LoD2", "mái"). Spec đã được đánh số lại. Các tiêu chí tương ứng hiện hành là:

| Mã hiện hành | Nội dung |
|---|---|
| spec §3 Trong phạm vi (dòng 31) | "Nâng hình học mái lên LoD2 chỉ khi đủ dữ liệu, giấy phép và kiểm chất lượng." |
| spec §3 Ngoài phạm vi (dòng 36) | Mái/địa hình tự sinh không có căn cứ; LoD2 không phải yêu cầu bắt buộc. |
| `BR-53` | LoD2 chỉ khi có nguồn hình học kiểm chứng, giấy phép và kiểm chất lượng; thiếu thì giữ LoD1, không bịa mái; LoD hiển thị ≠ LoD hình học ≠ độ phân giải solver. |
| `E-27` | Không có mái đủ tin cậy thì giữ LoD1, ghi giới hạn, không công bố LoD2 từ texture. |
| `AC-40` | Thiếu dữ liệu mái thì không được công bố LoD2. |
| DATABASE.md dòng 36–39 | Nếu LoD2 đổi physics thì phải có version scene mới; không dùng guard comparison A8 để lách. |

Đề nghị người giữ ROADMAP thay "Spec G; TC-ROOF" bằng "spec BR-53/E-27/AC-40". Tôi không tự sửa file đó.

## 2. Kiểm kê dữ liệu mái tại chỗ

Tái lập bằng `scripts/count_roof_tags.py` (xem §7). Số liệu thô nằm trong `artifacts/b9.5-lod2/roof_tags.json`.

### 2.1 File cục bộ `data/raw/buildings.geojson` (62 feature: 60 way, 2 relation)

File đã chuẩn hoá chỉ giữ các cột `osm_type, osm_id, building, height, building:levels, prepared_height_source, osm_height_raw, osm_levels_raw`. Bước chuẩn bị đã bỏ mọi tag khác, nên file cục bộ **không thể** cho biết có tag mái hay không. Vì vậy tôi đọc lại tag OSM hiện hành của đúng 62 id qua Overpass (01/11/2026, `timestamp_osm_base` 2026-11-01T04:07Z, trả đủ 62/62 id).

### 2.2 Đếm tag (62 nhà của cảnh)

| Tag | Số nhà có tag | Tỉ lệ | Ghi chú |
|---|---:|---:|---|
| `roof:shape` | 0 | 0 % | |
| `roof:height` | 0 | 0 % | |
| `roof:levels` | 0 | 0 % | |
| `roof:direction` / `roof:orientation` | 0 / 0 | 0 % | |
| `roof:angle` | 0 | 0 % | |
| `roof:colour` / `roof:material` | 0 / 0 | 0 % | Chỉ là vật liệu, không phải hình học |
| `building:roof:shape` | 0 | 0 % | |
| **Có ít nhất một tag `roof:*`** | **0** | **0 %** | |
| `height` (OSM) | 14 | 22,6 % | Chỉ dùng đối chiếu; cảnh dùng GOB 2.5D |
| `building:levels` | 13 | 21,0 % | |
| `min_height` / `building:min_level` | 0 / 0 | 0 % | Không có thông tin tầng treo/ban công |
| `building:part` gắn trên nhà chính | 0 | 0 % | |

- **`building:part` trong bbox miền:** 10 phần (gồm Sunwah Tower `way/138674379`, height 92, 21 tầng). Cả 10 phần đều **không có tag mái**. Chúng chỉ cho chiều cao/số tầng từng khối, tức là LoD1 nhiều khối, không phải LoD2.
- **Giá trị `building`:** yes 50, commercial 3, apartments 2, **roof 2**, office 2, mosque 1, temple 1, civic 1.
- **Hai nhà `building=roof`** (`way/341508365` cao 2,0 m và `way/341508366` cao 1,5 m) là mái che hở, không có tường. LoD1 dựng chúng thành khối đặc thấp, đây là sai số hình học đã biết và nhỏ. Hai nhà này không phải dữ liệu LoD2.

### 2.3 Kích thước footprint so với độ phân giải nguồn

Diện tích tính từ WKT UTM trong `db/seeds/scene/buildings.csv`, đã cắt theo miền.

| Ngưỡng | Số nhà |
|---|---:|
| < 100 m² | 8 |
| < 900 m² (nhỏ hơn 1 pixel 30 m) | **44/62 (71 %)** |
| < 3.600 m² (nhỏ hơn 2 × 2 pixel 30 m) | **60/62 (97 %)** |
| Trung vị | 472 m² |
| Lớn nhất | 6.542 m² |

## 3. So sánh nguồn hình dạng mái

| Nguồn | Phủ miền? | Thuộc tính mái | Độ phân giải / độ chính xác | Giấy phép (học thuật + phân phối trong repo) | Công sức | Đánh giá |
|---|---|---|---|---|---|---|
| **OSM tag `roof:*`** | Có footprint 62/62 | **0/62** | Không áp dụng | ODbL 1.0, đã dùng | Thấp nếu có tag, nhưng không có | ✗ Không có dữ liệu |
| **OSM `building:part`** | 10 phần trong bbox | Không có tag mái; chỉ height/levels | Cấp khối | ODbL 1.0 | Trung bình (ghép part với nhà) | ✗ Chỉ cải thiện LoD1 nhiều khối, không phải LoD2 |
| **Google Open Buildings 2.5D Temporal** (đang dùng cho chiều cao) | Có (VNM, 2016–2023) | Không có hình dạng mái; raster chiều cao trên mặt đất | Pixel 0,5 m nhưng **hiệu dụng ~4 m** (từ Sentinel-2); MAE 1,5 m, chỉ đánh giá ở Bắc Mỹ/Âu/Nhật; **chặn trần 100 m**; Google lưu ý vị trí mái có thể lệch | CC BY 4.0 hoặc ODbL, được chọn | Đã tích hợp | ✗ Độ phân giải hiệu dụng 4 m và sai số 1,5 m tương đương chênh lệch mái dốc 1–3 m, nên không tách được dạng mái. Chỉ dùng làm chiều cao LoD1 (như hiện tại) |
| **Overture Maps Buildings** | Có (ghép OSM + Microsoft + Google + Esri) | Schema có `roof_shape`, `roof_height`, nhưng giá trị chủ yếu kế thừa từ OSM; Microsoft/Google chỉ góp footprint/height | Theo nguồn gốc | ODbL (theme Buildings) | Thấp–trung bình (GeoParquet) | ✗ Ở đây gần như chắc chắn trống, vì OSM có 0 tag. Có thể kiểm thêm bằng một truy vấn, nhưng không đổi quyết định |
| **Microsoft Global ML Building Footprints** | Có footprint VN | Không có mái; height chỉ phủ một phần toàn cầu, chưa xác nhận cho VN | Không công bố cho VN | ODbL | Trung bình | ✗ Không có mái |
| **Copernicus DEM GLO-30** (DSM X-band TanDEM-X) | Có | DSM gồm nhà và cây, không tách được mái | 30 m; sai số tuyệt đối theo đặc tả < 4 m LE90 (một số nguồn ghi < 6 m) | Miễn phí, phải ghi công "© DLR e.V. … produced using Copernicus WorldDEM-30"; phân phối lại được kèm thông báo | Thấp để tải; cao để khai thác | ✗ 71 % số nhà nhỏ hơn 1 pixel, nên không nói được gì về mái |
| **ALOS AW3D30** (JAXA, quang học stereo) | Có | DSM | 30 m (lấy từ lưới 5 m), sai số đứng vài mét | Miễn phí kể cả thương mại, cần tài khoản và ghi công JAXA; quy định phân phối lại chưa xác minh đầy đủ | Thấp để tải | ✗ Cùng lý do với GLO-30 |
| **AW3D bản thương mại 0,5–2,5 m / ảnh stereo VHR** (Maxar, Airbus Pléiades) | Có thể mua | DSM đủ mịn để tách mái | 0,5–2 m | Thương mại; **không** được phân phối lại trong repo | Rất cao (mua, xử lý) | ✗ Vượt ngân sách, vi phạm yêu cầu tái lập bằng dữ liệu mở |
| **LiDAR / DSM mở của Việt Nam / TP.HCM** | **Không tìm thấy** bộ mở cho Q1. Geoportal Sở TN-MT TP.HCM được liệt kê là mở nhưng chưa xác nhận có LiDAR/DSM | Không | Không | Không rõ | Không xác định | ✗ Không có nguồn |
| **World Bank "Vietnam Municipal Rooftop Solar Mapping"** (TP.HCM, Đà Nẵng) | Có TP.HCM | Polygon mái từ ảnh stereo VHR và tiềm năng điện mặt trời; không thấy độ dốc/hướng mái | "Very high resolution" | CC BY 4.0, nhưng **không có file tải**, phải xin qua data@worldbank.org | Cao, không chắc chắn | △ Ứng viên duy nhất có căn cứ; chỉ đáng xin nếu có thời gian. Kể cả khi có cũng chưa chắc có hình dạng/độ dốc mái |
| **Esri World Imagery** (20 tile z18 đang có trong `data/raw/imagery/`) | Có | Ảnh trực giao 2D, một góc nhìn | ~0,6 m/pixel | Chỉ được hiển thị, không được trích xuất dữ liệu | Không áp dụng | ✗ Ảnh đơn không suy ra được hình học 3D; E-27 cấm LoD2 từ texture |
| **Tự chụp photogrammetry (drone/điện thoại)** | Phải tự bay | Mô hình mái thật | Cm–dm | Dữ liệu tự tạo, nhưng bay drone ở Q1 (gần UBND TP, phố đi bộ Nguyễn Huệ) cần giấy phép bay | Rất cao | ✗ Không khả thi về pháp lý và thời gian |
| **Gán mái theo kiểu nhà hoặc thủ công** | Không áp dụng | Tự bịa | Không áp dụng | Không áp dụng | Thấp | ✗ **Cấm** theo BR-53 và spec §3 |

## 4. Kiểm từng tiêu chí của cổng

| # | Tiêu chí | Kết quả | Căn cứ |
|---|---|---|---|
| 1 | **Đủ dữ liệu:** có nguồn hình học mái đã kiểm chứng cho phần lớn 62 nhà | ✗ KHÔNG ĐẠT | OSM 0/62; Overture kế thừa OSM; GOB 2.5D không có dạng mái; DSM 30 m quá thô (71 % nhà < 1 pixel); không có LiDAR mở |
| 2 | **Giấy phép:** dùng học thuật được và commit/phân phối lại trong repo | △ Chỉ đạt với các nguồn không có mái | Các nguồn mở (OSM/Overture/Microsoft ODbL, GOB CC BY, GLO-30) đều đạt nhưng không có mái. Nguồn có mái (VHR thương mại) không đạt. World Bank CC BY nhưng không tải được |
| 3 | **Kiểm chất lượng:** có phương pháp đối chiếu độc lập (ảnh xiên, khảo sát, LiDAR) | ✗ KHÔNG ĐẠT | Không có dữ liệu tham chiếu độc lập. Esri imagery chỉ là 2D và chỉ được hiển thị |
| 4 | Không tự sinh mái | ✓ Giữ được | Quyết định giữ LoD1 tuân thủ |
| 5 | Không công bố LoD2 từ texture (E-27) | ✓ Giữ được | Cửa sổ/vật liệu thủ tục vẫn ghi là minh hoạ (ROADMAP §cảnh 3D) |
| 6 | Tách LoD hiển thị / LoD hình học / độ phân giải solver (BR-53) | ✓ | A9.4 là LoD hiển thị (giảm đỉnh mặt đứng), không phải LoD2. Hình học vẫn là LoD1 |
| 7 | Có lợi ích vật lý đáng kể | ✗ Thấp | Với dz = 2 m và dx = 5 m, mái dốc cao 1–3 m chỉ chiếm 0–1 lớp voxel. Khu trung tâm Q1 chủ yếu là nhà cao tầng mái bằng. Sai số chiều cao LoD1 (MAE GOB 1,5 m chưa kiểm định ở VN, trần 100 m) lớn hơn hiệu ứng mái |
| 8 | Bắt buộc theo đề bài | ✗ Không | spec §3 dòng 36; ROADMAP dòng 16 |

Cổng đòi đạt đồng thời 1, 2 và 3. **Tiêu chí 1 và 3 không đạt, nên cổng KHÔNG QUA.**

## 5. Quyết định và lý do

**Không làm LoD2. Giữ LoD1** cho cả hình học hiển thị lẫn mask solver.

1. **Không có dữ liệu:** 0 % nhà có tag mái OSM. Không nguồn mở nào phủ Q1 có hình dạng mái.
2. **Nguồn thô quá:** DSM toàn cầu 30 m có pixel lớn hơn 44/62 footprint. GOB 2.5D hiệu dụng 4 m với MAE 1,5 m không phân biệt được dạng mái.
3. **Không kiểm được chất lượng:** không có LiDAR hay khảo sát độc lập. Mọi mái dựng ra sẽ là "mái giả", trái BR-53, E-27 và AC-40.
4. **Lợi ích vật lý nhỏ hơn sai số hiện có:** khác biệt mái dưới 2 m nằm dưới độ phân giải dz. Ưu tiên của B nên là sai số chiều cao LoD1 (B9.1: trần 100 m của GOB, chênh lệch so với OSM `height`/`building:levels`).
5. **Không bắt buộc**, và ngân sách thời gian tuần 9–10 dành cho nghiệm thu và báo cáo.

**Hệ quả:** không đổi physics. Scene, mask, `voxel_grid.nc`, các run và guard comparison A8 giữ nguyên. Không cần version scene mới.

**Điều kiện mở lại (chỉ ở đợt 3 tùy chọn, ROADMAP dòng 593):**

- **Điều kiện 1:** có được dữ liệu World Bank rooftop TP.HCM, hoặc LiDAR/DSM ≤ 1 m với giấy phép cho phép phân phối, phủ ≥ 80 % nhà, và có cách đối chiếu độc lập.
- **Điều kiện 2:** cộng đồng OSM bổ sung `roof:shape`/`roof:height` cho ≥ 80 % nhà. Kiểm lại bằng script §7.

Nếu mở lại và mái đi vào solver:

- Bắt buộc tạo **scene_version mới**, mask/`voxel_grid.nc` mới và **run mới** cho cả hai kịch bản.
- So sánh LoD1 với LoD2 phải là phép đối chiếu **offline trên miền vật lý chung** (DATABASE.md dòng 36–39). **Không** dùng hay nới guard comparison A8 để so hai run khác mask.
- Nếu mái chỉ dùng để hiển thị thì phải ghi rõ "mái hiển thị không tham gia solver", để tránh lệch giữa cảnh nhìn thấy và hình học mô phỏng (ROADMAP §cảnh 3D).

## 6. Câu đưa vào báo cáo (mục Hạn chế)

> Toà nhà được biểu diễn ở mức LoD1: footprint OpenStreetMap, mái phẳng, chiều cao từ Google Open Buildings 2.5D Temporal. Chúng tôi đã đánh giá khả năng nâng lên LoD2 (hình dạng mái) và quyết định không thực hiện. Kiểm tra ngày 01/11/2026 cho thấy 0/62 toà nhà trong miền có thẻ mái OSM (`roof:shape`, `roof:height`, `roof:levels`…). Không có nguồn LiDAR/DSM mở cho khu vực. Các DSM toàn cầu 30 m (Copernicus GLO-30, ALOS AW3D30) có pixel lớn hơn 71 % footprint, còn Open Buildings 2.5D có độ phân giải hiệu dụng khoảng 4 m với sai số khoảng 1,5 m, nên không đủ để xác định dạng mái. Vì không có dữ liệu kiểm chứng, mái không được tự sinh. Với lưới dz = 2 m, hình dạng mái dốc (1–3 m) có ảnh hưởng nhỏ hơn sai số chiều cao LoD1 hiện có.

## 7. Tái lập

```bash
# Đếm cột cục bộ
py -3.13 -I scripts/count_roof_tags.py

# Đếm tag OSM hiện hành của đúng 62 id (Python tự gọi Overpass)
py -3.13 -I scripts/count_roof_tags.py --live --json-out artifacts/b9.5-lod2/roof_tags.json

# Nếu Python báo lỗi chứng chỉ TLS (proxy/antivirus, như trên máy này): tải bằng curl
py -3.13 -I scripts/count_roof_tags.py --print-query > artifacts/b9.5-lod2/overpass_query.txt
curl -A IE402-B9.5 --data-urlencode data@artifacts/b9.5-lod2/overpass_query.txt \
     https://overpass-api.de/api/interpreter > artifacts/b9.5-lod2/osm_tags_live.json
py -3.13 -I scripts/count_roof_tags.py --overpass-json artifacts/b9.5-lod2/osm_tags_live.json \
     --json-out artifacts/b9.5-lod2/roof_tags.json
```

- `.venv` hiện trỏ tới một Python không tồn tại trên máy này (`C:\Users\Admin\...Python312`), nên tôi chạy bằng `py -3.13`. Script chỉ dùng thư viện chuẩn.
- `artifacts/*` bị `.gitignore`. Muốn lưu bằng chứng vào repo thì người review phải quyết định chuyển file này sang `docs/` hoặc thêm ngoại lệ ignore.
- `osm_tags_live.json` là dữ liệu OSM (ODbL, © OpenStreetMap contributors).

## 8. Nguồn tra cứu (01/11/2026)

- Google Open Buildings 2.5D Temporal: https://sites.research.google/gr/open-buildings/temporal/
- Overture Maps buildings: https://docs.overturemaps.org/guides/buildings và https://docs.overturemaps.org/schema/concepts/by-theme/buildings
- Microsoft Global ML Building Footprints: https://wiki.openstreetmap.org/wiki/Microsoft_Building_Footprints
- Copernicus DEM: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- JAXA AW3D30: https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/aw3d30_e.htm
- World Bank Vietnam rooftop solar mapping: https://datacatalog.worldbank.org/search/dataset/0067015/vietnam-municipal-rooftop-solar-mapping-potential
- OSM Simple 3D Buildings (`roof:*`): https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings
- 3DBAG (định nghĩa LoD, chỉ có ở Hà Lan): https://docs.3dbag.nl/en/schema/layers/
