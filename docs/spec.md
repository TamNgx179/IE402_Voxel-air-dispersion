# Đặc tả yêu cầu — Mô phỏng lan truyền ô nhiễm không khí đô thị bằng mô hình GIS 3D

## 1. Mục tiêu

Xây dựng mô hình khối không gian (voxel) mô phỏng phát tán chất ô nhiễm theo độ cao, sử dụng mô hình 3D Array/voxel và phân tích không gian đúng đề bài của giảng viên. Sản phẩm cho phép xem nồng độ theo vị trí và chiều cao, phân tích vùng, mặt cắt đứng và đối chiếu kịch bản trên cảnh đô thị lấy từ dữ liệu GIS.

PostgreSQL/PostGIS và truy vấn là yêu cầu bổ sung của nhóm. Kết quả là mô phỏng PM2.5 thụ động với giả thiết được công bố; không thay thế quan trắc hay đánh giá chất lượng không khí thực tế. Không đặt trước kết luận nồng độ phải giảm theo độ cao.

Đây là yêu cầu nghiệm thu, không phải danh sách tính năng đã hoàn thành. Cơ sở phương pháp ở [RESEARCH.md](RESEARCH.md), thiết kế ở [ARCHITECTURE.md](ARCHITECTURE.md), tiến độ và phân công ở [ROADMAP.md](ROADMAP.md).

## 2. Ràng buộc

- Kiến trúc modular monolith NestJS: DTO, schema, controller, service và repository có trách nhiệm rõ; web cùng origin, Python là subprocess nội bộ, PostgreSQL/PostGIS lưu và truy vấn dữ liệu. Không thêm microservice hoặc hàng đợi phân tán.
- Miền chuẩn 500 × 500 × 100 m; bước lưới 5 × 5 × 2 m, 100 × 100 × 50 ô. Các mô-đun đọc kích thước từ cấu hình; mảng theo `[z,y,x]`.
- Tính toán khoảng cách/diện tích bằng CRS chiếu theo mét; khu vực chuẩn dùng EPSG:32648. Web nhận kinh độ/vĩ độ WGS84; không tính diện tích trực tiếp bằng độ.
- z là độ cao trên mặt đất phẳng z=0, không phải cao độ địa hình khảo sát. Phải phân biệt tâm ô, biên ô, solid, no-data và nồng độ bằng 0.
- NetCDF là dữ liệu khoa học đầy đủ, kèm tọa độ, đơn vị, CRS và provenance. DB lưu phần phục vụ truy vấn; dữ liệu màu không phải dữ liệu tính toán.
- Mọi nguồn dữ liệu phải có xuất xứ, phiên bản/thời điểm tải, giấy phép và phép biến đổi. Chiều cao suy ra/fallback phải phân biệt với số đo.
- Tham số, ngưỡng kiểm tra số trị và đơn vị lấy từ cấu hình được phiên bản hóa. Ngưỡng tham chiếu hiển thị không chứng minh tuân thủ tiêu chuẩn trung bình 24 giờ.
- Kiểm thử dùng DB PostGIS thật cho truy vấn không gian; kiểm tra phương pháp số độc lập với kiểm tra API/UI. Không suy kết quả nghiệm thu từ ảnh giao diện hoặc số lượng test.

## 3. Phạm vi

### Trong phạm vi

- Chuẩn bị footprint/chiều cao nhà, đường và dữ liệu khí tượng/phát thải; voxel hóa cảnh đô thị, phân biệt không khí và vật cản.
- Trường gió chẩn đoán bảo toàn khối lượng; tải–khuếch tán thể tích hữu hạn ba chiều. Gaussian dùng làm baseline có nhãn.
- Chạy mô phỏng bất đồng bộ; lưu trạng thái, tham số, metrics, artifact và truy vết nguồn.
- Web GIS 3D có xoay/nghiêng, nhà LoD1, lát nồng độ theo độ cao, chuyển động gió, chọn ô/profile, thống kê/ngưỡng, phân tích vùng, mặt cắt và so sánh kết quả tương thích.
- Xuất CSV/ảnh; kiểm tra bảo toàn, tính dương, hội tụ, độ nhạy dữ liệu/lưới/thời bước; dựng lại dự án trên môi trường sạch.
- Tối ưu LoD hiển thị. Nâng hình học mái lên LoD2 chỉ khi đủ dữ liệu, giấy phép và kiểm chất lượng.

### Ngoài phạm vi

- CFD giải động lượng đầy đủ, RANS/LES, phản ứng hóa học, mô hình sức khỏe, dự báo vận hành hoặc tuyên bố đã được kiểm định thực địa khi chưa có đối chiếu phù hợp.
- Thành phố số có texture ảnh thật cho từng nhà, mái/địa hình tự sinh không có căn cứ; LoD2 không phải yêu cầu bắt buộc của giảng viên.
- Microservice, Redis/broker phân tán, hệ thống tài khoản/thanh toán và seminar.

## 4. Quy tắc nghiệp vụ

| Mã | Quy tắc |
|---|---|
| `BR-1` | Gọi đúng là **mass-consistent diagnostic wind model**, không gọi là Röckle đầy đủ hoặc CFD |
| `BR-2` | Không giải phương trình động lượng; toà nhà tác động qua solid mask và face coefficients |
| `BR-3` | Chất mô phỏng là PM2.5 thụ động, không phản ứng |
| `BR-4` | Gaussian là baseline/đối chiếu, không phải solver voxel chính |
| `BR-5` | Advection dùng first-order upwind; không dùng central differencing cho advection |
| `BR-6` | Flux tính trên mặt ô để khối lượng rời ô này đi vào ô kề tương ứng |
| `BR-7` | `dt` được tính từ trường vận tốc thực, Courant mục tiêu không quá 0,5 |
| `BR-8` | Production dùng steady-state criterion và giới hạn an toàn; phải báo lý do dừng, không coi hết max steps là hội tụ. Analytic/transient study có thể dừng ở thời điểm vật lý cố định đã chốt trước |
| `BR-9` | Building wall và ground không cho flux xuyên qua; boundary ngoài có clean inflow/open outflow |
| `BR-10` | Nồng độ âm vượt tolerance làm run thất bại; không âm thầm clip để che lỗi |
| `BR-11` | Grid mặc định 100 × 100 × 50 nhưng mọi module phải đọc từ config |
| `BR-12` | Thứ tự trục `[z,y,x]` là contract xuyên suốt |
| `BR-13` | Thiếu chiều cao nhà phải được báo cáo; không dùng default im lặng |
| `BR-14` | Output khoa học đầy đủ là NetCDF kèm units, CRS, coordinates và provenance |
| `BR-15` | Nguồn dữ liệu, thời điểm tải, version và phép biến đổi phải được lưu |
| `BR-16` | `POST /runs` validate DTO, tạo snapshot tham số và trả `202 Accepted` cùng `run_id` |
| `BR-17` | Trạng thái hợp lệ: `queued → running → succeeded/failed`; có thể thêm `cancelled/stale` |
| `BR-18` | Python solver không mở port/API; chỉ `SimulationModule` được spawn process bằng command/arguments whitelist |
| `BR-19` | Monolith chỉ chạy một simulation process tại một thời điểm trong MVP; retry ghi attempt count và không nhân đôi kết quả |
| `BR-20` | Chỉ run vượt qua verification mới được đánh dấu `succeeded` |
| `BR-21` | HTTP disconnect không huỷ subprocess; DB là nguồn sự thật và monolith khôi phục/đánh dấu run gián đoạn khi restart |
| `BR-22` | DB lưu study area, buildings, roads, scenarios, runs, metrics, slices/summaries và artifacts |
| `BR-23` | Geometry có SRID đúng và GiST index; foreign key/index B-tree cho `run_id`, `z_m`, `status` |
| `BR-24` | Tensor đầy đủ nằm ở artifact storage; DB chỉ giữ phần cần filter/aggregate/spatial query |
| `BR-25` | Query từ client dùng endpoint/whitelist; không nhận SQL tự do |
| `BR-26` | Tối thiểu có query slice theo z, vùng vượt ngưỡng, profile đứng và summary theo tầng |
| `BR-27` | Truy vấn chính phải có `EXPLAIN (ANALYZE, BUFFERS)` hoặc bằng chứng index phù hợp |
| `BR-28` | Web chỉ gọi API same-origin của monolith, không query DB hoặc gọi Python CLI trực tiếp |
| `BR-29` | Height slider đổi đúng lớp `z_m` mà không reload toàn trang |
| `BR-30` | UI hiện units/scenario/threshold và cảnh báo cần thiết; version/hash/provenance truy được qua API/export, không buộc hiển thị chi tiết kỹ thuật trên sidebar |
| `BR-31` | Numerical diffusion và các physics bị thiếu phải xuất hiện trong report/UI |
| `BR-32` | Toà nhà trên web dùng đúng footprint và `height_m` của dữ liệu đã voxel hoá; không đặt khối nhà thủ công |
| `BR-33` | Đường, mặt nước và cây xanh lấy từ lớp GIS có provenance và cùng CRS; không bịa feature để làm đẹp |
| `BR-34` | Cảnh MVP là LoD1; cửa sổ/vật liệu minh họa phải được ghi nhãn, không tuyên bố là facade/roof khảo sát nếu nguồn không có. Dùng màu thân nhà trung tính và daylight minh họa có kiểm soát; chi tiết rõ dần khi zoom gần, không sửa dữ liệu GIS/solver |
| `BR-35` | Geometry web, PostGIS và voxel mask phải dùng cùng study-area transform và được kiểm bằng overlay/anchor points |
| `BR-36` | Wind solver phải xuất corrected face velocities `uf,vf,wf`; transport dùng trực tiếp các flux này thay vì nội suy lại từ tâm ô |
| `BR-37` | Positivity được kiểm trên giá trị cập nhật thô trước mọi round-off correction; mọi correction phải ghi lượng mass thay đổi |
| `BR-38` | FV voxel là kết quả mặc định trên web và trong báo cáo; Gaussian chỉ là baseline có nhãn |
| `BR-39` | Run chỉ được `succeeded` khi CFL, divergence, positivity, wall flux, mass balance và artifact integrity đều pass |
| `BR-40` | Threshold/units có một nguồn cấu hình được version hoá; DB seed, API, web và report không được tự chép số riêng |
| `BR-41` | Có sensitivity chiều cao và ít nhất một external benchmark/cross-check; mức tuyên bố phải khớp loại bằng chứng |
| `BR-42` | Release phải chạy được trên môi trường sạch theo chuỗi Compose → migrate → seed → run → query → web |
| `BR-43` | Mọi kết luận định lượng trong báo cáo truy được về `run_id`, model version, input hash, table/figure và limitation |
| `BR-44` | Phân tích vùng dùng diện tích giao XY nhân chiều dày giao khoảng z; trung bình có trọng số thể tích không khí. Ô rắn và thiếu số liệu bị loại; số 0 hợp lệ. Không có ô khí: trung bình/cực đại null, thể tích vượt ngưỡng 0. |
| `BR-45` | So sánh lấy kết quả đối chiếu trừ kết quả gốc. Chỉ so sánh khi cùng khu vực, CRS, lưới, hình học, mô hình và mặt nạ; không dùng chức năng này cho nghiên cứu khác độ phân giải. |
| `BR-46` | Mặt cắt nhận LineString WGS84 gồm 2–100 đỉnh, toàn tuyến trong miền. Khoảng lấy mẫu mặc định min(dx,dy), do người dùng nhập phải dương và không lớn hơn mức này. Lấy cả hai đầu tuyến với khoảng đều theo chiều dài chiếu; tối đa 20.000 mẫu vị trí–tầng. |
| `BR-47` | Mặt cắt đọc ô hiện có, không nội suy nồng độ và không chạy lại solver. Đảo tuyến đảo thứ tự mẫu. Phân biệt ô khí, ô rắn và thiếu số liệu; CSV giữ cùng số liệu, đơn vị và metadata với JSON. |
| `BR-48` | Chỉ số ô theo khoảng nửa kín; độ cao 2 m thuộc tầng bắt đầu ở 2 m, 100 m ngoài miền mặc định. Trả cả độ cao yêu cầu và tâm tầng. Đổi độ cao, vùng hoặc run phải vô hiệu hóa kết quả cũ. |
| `BR-49` | Nồng độ trong NetCDF lưu float32; DB bảo toàn giá trị đã lưu khi chuyển float4 sang float8 trước xuất JSON. Dữ liệu màu uint8 chỉ để vẽ, không dùng thống kê hoặc CSV. |
| `BR-50` | API dùng tiền tố /api. Input sai trả 400; run không tồn tại 404; kết quả chưa sẵn sàng hoặc dữ liệu không tương thích 409. Không trả SQL, stack trace hoặc đường dẫn nội bộ cho người dùng. |
| `BR-51` | CSV xử lý dấu phẩy, dấu nháy, xuống dòng và nguy cơ công thức bảng tính; ảnh xuất phải có legend, độ cao, đơn vị và định danh kết quả. |
| `BR-52` | LoD hiển thị được phép thay mức chi tiết và culling theo camera nhưng không thay dữ liệu GIS, mặt nạ solver hoặc kết quả truy vấn; đánh giá bằng đo trước/sau trên cùng cảnh và thiết bị. |
| `BR-53` | LoD2 mái chỉ triển khai khi có nguồn hình học kiểm chứng, giấy phép và kiểm chất lượng. Thiếu nguồn tiếp tục LoD1, không tự bịa mái. LoD hiển thị, LoD hình học và độ phân giải solver là ba khái niệm riêng. |
| `BR-54` | Nghiên cứu độ phân giải dùng nhiều lưới/thời bước với cùng bài toán vật lý; báo sai số, chi phí và khuếch tán số. Residual nhỏ không thay thế kiểm tra hội tụ lưới. |
| `BR-55` | UI dùng tiếng Việt dễ hiểu, đơn vị rõ ràng, nhãn ngắn; giải thích phụ trong nút thông tin dùng được bằng chuột và bàn phím. Nút đơn chiếm cả hàng; chưa chọn ô không hiển thị thẻ kết quả trống. |
| `BR-56` | Loading, mất mạng, rỗng và lỗi phải có hướng xử lý; phản hồi bất đồng bộ cũ không được ghi đè kết quả mới. Không che lỗi bằng số 0 hoặc dữ liệu minh họa không có nhãn. |

## 5. Trường hợp biên

| Mã | Trường hợp | Kết quả mong đợi |
|---|---|---|
| E-01 | Độ cao đúng biên tầng, âm hoặc bằng đỉnh miền | Chọn theo khoảng nửa kín; ngoài miền trả lỗi, không tự ép về tầng gần nhất. |
| E-02 | CRS, thứ tự tọa độ hoặc dimensions sai | Chặn trước khi tính; không âm thầm hoán đổi trục. |
| E-03 | Thiếu chiều cao nhà | Áp dụng chính sách fallback có nguồn và thống kê tỷ lệ; không coi là số đo. |
| E-04 | Ô solid, no-data hoặc C=0 | Phân biệt ba trạng thái; không bỏ số 0 và không tô solid như không khí sạch. |
| E-05 | Khoảng z chỉ giao một phần tầng | Dùng chiều dày thực sự giao khi tính thể tích và trung bình. |
| E-06 | Vùng không có thể tích không khí | Trả mean/max null, thể tích vượt ngưỡng 0; UI thông báo không có số liệu phù hợp. |
| E-07 | Polygon tự cắt, diện tích 0 hoặc ngoài miền | Trả 400; toàn bộ vùng phải nằm trong miền nghiên cứu. Không tự cắt vùng hoặc bịa nồng độ. |
| E-08 | Run không có/chưa sẵn sàng | 404/409 phù hợp; UI không dùng kết quả cũ thay thế. |
| E-09 | Hai yêu cầu mô phỏng và retry | Chạy tuần tự concurrency=1, theo dõi attempt; không nhân đôi artifact. |
| E-10 | Mất HTTP, Python lỗi hoặc ứng dụng restart | Không coi mất HTTP là hủy; ghi thất bại/gián đoạn đúng trạng thái, cho phép phục hồi theo chính sách. |
| E-11 | CFL/divergence/mass/positivity không đạt | Không đánh dấu succeeded; lưu lý do và số liệu chẩn đoán. |
| E-12 | Hết giới hạn bước nhưng chưa hội tụ | Báo lý do dừng, không công bố hội tụ. |
| E-13 | Artifact thiếu hoặc checksum sai | Chặn nhập/xuất kết quả không toàn vẹn; báo lỗi cụ thể. |
| E-14 | Comparison khác CRS/lưới/model/scene/mask | 409 trước phép trừ; không nội suy ngầm. |
| E-15 | Comparison bằng 0 hoặc âm | Giữ dấu và số 0, thang màu phân kỳ có legend. |
| E-16 | Tuyến ít hơn 2, quá 100 đỉnh hoặc hai đỉnh liên tiếp trùng | 400; tuyến tự cắt không tự động bị coi là Polygon sai. |
| E-17 | Tuyến ra ngoài miền hoặc step không hợp lệ | 400 trước truy vấn nồng độ; không cắt tuyến hoặc sửa step ngầm. |
| E-18 | Mặt cắt vượt 20.000 mẫu vị trí–tầng | 400 trước truy vấn nồng độ; hướng dẫn tăng bước hoặc giảm tuyến/khoảng cao. |
| E-19 | Đảo hướng tuyến | Khoảng cách tính từ đầu tuyến mới, dãy mẫu đảo tương ứng; nồng độ ô không đổi. |
| E-20 | Tuyến đi qua nhà hoặc cột thiếu dữ liệu | Trả trạng thái solid/no-data, không nội suy qua vật cản. |
| E-21 | CSV có dấu nháy, xuống dòng hoặc tiền tố công thức | Escape đúng và chống thực thi công thức; không làm biến dạng số đo. |
| E-22 | Đổi run/vùng/z trong khi chờ API | Bỏ phản hồi cũ và yêu cầu cập nhật kết quả theo lựa chọn hiện tại. |
| E-23 | Chưa chọn ô hoặc chưa vẽ tuyến/vùng | Không bày thẻ kết quả trống; giữ hành động cần làm tiếp theo. |
| E-24 | Mất mạng hoặc truy vấn lỗi | Thông báo tiếng Việt, giữ lựa chọn và cho thử lại; không hiển thị số 0 giả. |
| E-25 | Tooltip với bàn phím/cảm ứng | Focus/click mở được, Escape đóng; không cản thao tác vẽ hoặc nút chính. |
| E-26 | Zoom làm đổi LoD hiển thị | Chỉ thay mức chi tiết vẽ; query, CSV và mặt nạ solver không đổi. |
| E-27 | Không có mái đủ tin cậy | Giữ LoD1 và ghi giới hạn; không công bố LoD2 từ texture. |
| E-28 | Residual nhỏ nhưng kết quả đổi theo lưới | Báo riêng hội tụ lặp và hội tụ lưới; không gộp thành đạt. |
| E-29 | Nồng độ dưới ngưỡng tham chiếu | Chỉ mô tả kết quả mô hình, không kết luận không khí an toàn hay đạt chuẩn 24 giờ. |

## 6. Tiêu chí nghiệm thu

| Mã | Điều kiện đạt |
|---|---|
| `AC-1` | Voxeliser ghi `H(y,x)` và `B(z,y,x)` đúng dimensions/coordinates |
| `AC-2` | Building height thiếu được phát hiện và ghi rõ nguồn/fallback |
| `AC-3` | NetCDF mở đúng chiều trong QGIS/Panoply mà không cần code riêng |
| `AC-4` | Divergence sau correction dưới tolerance tại mọi air voxel |
| `AC-5` | Velocity trong solid voxel bằng 0 và không có flux xuyên tường |
| `AC-6` | Closed domain bảo toàn khối lượng trong sai số floating-point |
| `AC-7` | Source/open boundary thoả emitted = remaining + escaped trong tolerance |
| `AC-8` | Không có concentration âm vượt tolerance |
| `AC-9` | Pure diffusion và uniform advection khớp nghiệm giải tích trong ngưỡng đã ghi |
| `AC-10` | Run báo `dt`, Courant, steps, simulated time và wall-clock |
| `AC-11` | Request hợp lệ trả `202` + `run_id`; request sai bị reject trước khi tạo run |
| `AC-12` | Run đi qua state machine và được phục hồi/đánh dấu đúng sau khi monolith restart |
| `AC-13` | Python exit khác 0 tạo status/error rõ ràng, không tạo artifact “thành công” |
| `AC-14` | Migration + seed dựng DB mới từ đầu và có FK/SRID/index |
| `AC-15` | Slice, exceedance, profile và summary trả đúng `run_id`, `z_m`, units |
| `AC-16` | Spatial query có bằng chứng dùng index hoặc lý giải đo được |
| `AC-17` | Hai run đồng thời được tuần tự hoá theo giới hạn concurrency=1; retry không nhân đôi output |
| `AC-18` | Height slider đổi lớp nồng độ mà không reload trang |
| `AC-19` | Hai wind scenarios được đối chiếu hướng lan truyền với trường gió và điều kiện biên, không ép phải khác lớn |
| `AC-20` | Đối chiếu nhiều tầng và profile, ghi cả cao độ yêu cầu/tâm ô thực; báo cáo biến thiên kể cả khi gần 0 |
| `AC-21` | UI hiện units/legend và thông báo cần thiết; version/provenance truy được qua API/export, không bắt buộc bày chi tiết kỹ thuật trên sidebar |
| `AC-22` | Gaussian/FV được gắn nhãn rõ, không trộn kết quả |
| `AC-22a` | 100% building hiển thị có `source_feature_id`, `height_source` và footprint truy ngược được |
| `AC-22b` | Chọn mẫu ít nhất 10 toà nhà: footprint, tâm và chiều cao web khớp DB/scene package trong tolerance |
| `AC-22c` | Road/water/green layers khớp basemap và không có feature được đặt tay ngoài dữ liệu nguồn |
| `AC-22d` | UI/report ghi rõ cảnh là LoD1 và địa hình phẳng `z=0` |
| `AC-23` | Báo cáo dùng từ “verification”, không tuyên bố validation chưa thực hiện |
| `AC-24` | Numerical diffusion được đo/ước lượng cạnh physical diffusivity |
| `AC-25` | Hạn chế cavity/wake, canyon vortex, traffic turbulence và flat terrain được nêu |
| `AC-26` | Mọi run có model version, input hash và provenance |
| `AC-27` | Artifact gió chứa `uf,vf,wf`; divergence của chính face field đưa vào transport dưới tolerance tại mọi air cell |
| `AC-28` | Regression test cố tình tạo bước không ổn định phải fail trước clipping; test phát hiện được giá trị âm |
| `AC-29` | Với một production run: emitted mass = remaining + escaped + documented correction trong tolerance; correction xấp xỉ 0 |
| `AC-30` | Mở web sau release mặc định tải scenario `model=fv`; Gaussian chỉ xuất hiện khi người dùng bật comparison |
| `AC-31` | Run có verification fail không thể chuyển thành `succeeded` hoặc xuất hiện trong danh sách kết quả hợp lệ |
| `AC-32` | Test tự động so sánh threshold/units từ config, DB, API payload, web legend và report fixture, không có sai khác |
| `AC-33` | Báo cáo có sensitivity chiều cao và external benchmark/cross-check, nêu rõ đó là verification hay validation |
| `AC-34` | Trên môi trường sạch, runbook dựng monolith + DB, seed, spawn Python solver, trả 4 query và mở web mà không sửa tay |
| `AC-35` | Mỗi figure/table quan trọng có metadata liên kết `run_id`, commit/model version, input hash và manifest trong báo cáo/artifacts; không yêu cầu tạo docs EVIDENCE riêng |
| `AC-36` | Vùng giao một phần ô/tầng, nhiều ô, toàn solid, thiếu dữ liệu và nồng độ 0 trả kết quả đúng phép tính tay. |
| `AC-37` | Comparison kiểm tra tương thích trước tính; dấu chênh lệch và giá trị CSV khớp truy vấn gốc. |
| `AC-38` | Mặt cắt qua nhiều tầng trả đúng ô, chainage và endpoints; kiểm đảo tuyến, solid/no-data, giới hạn mẫu và CSV đối chiếu DB. |
| `AC-39` | Export giữ đơn vị/provenance; CSV mở đúng cột, chống công thức; ảnh có đủ legend và thông tin tái lập. |
| `AC-40` | LoD hiển thị có số đo trước/sau và kiểm không đổi query/CSV; thiếu dữ liệu mái không được công bố LoD2. |
| `AC-41` | Nghiên cứu lưới/thời bước báo cùng miền vật lý, sai số, chi phí, khuếch tán số và giới hạn kết luận. |
| `AC-42` | UI không hiển thị chưa chọn ô; nút đơn đầy hàng, chú thích ngắn, tooltip mở bằng focus/hover và đóng bằng Escape; trạng thái lỗi tiếng Việt có hướng khắc phục. |
| `AC-43` | Đổi run/lớp/vùng khi request đang chạy không làm kết quả cũ xuất hiện; mất mạng có thể thử lại mà không tạo run trùng. |
