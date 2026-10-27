# Nghiên cứu cơ sở và công nghệ

Tài liệu tổng hợp phương pháp, dữ liệu và công cụ phục vụ đề tài mô phỏng lan truyền ô nhiễm không khí đô thị bằng GIS 3D. Các nguồn dưới đây là bài báo và tài liệu chính thức; lựa chọn áp dụng vào dự án được nêu riêng với giới hạn của nó. Tài liệu không thay thế đặc tả nghiệm thu hoặc nhật ký triển khai. Rà soát ngày 27/10/2026.

## 1. Mô hình không gian và mục tiêu nghiên cứu

Đề bài yêu cầu mô hình khối không gian và phân tích phát tán theo độ cao. Vì vậy, đối tượng tính toán phải là trường nồng độ trong thể tích không khí, không chỉ lớp màu phủ lên nền bản đồ hay chiều cao khối nhà. Lưới voxel đều thuận tiện cho lưu mảng ba chiều, rời rạc hóa dòng qua mặt ô và truy vấn các tầng đứng.

CityGML mô tả mô hình đô thị có ngữ nghĩa và hình học. Hình học nhà cung cấp vật cản cho miền tính; bản thân mô hình nhà không chứa nghiệm phát tán. Dự án cần liên kết footprint/chiều cao, mặt nạ solid và mảng nồng độ trong cùng hệ tọa độ. [OGC CityGML](https://www.ogc.org/standards/citygml/).

Áp dụng: miền chuẩn 500 × 500 × 100 m, ô 5 × 5 × 2 m; mảng theo `[z,y,x]`. Đây là cấu hình thực nghiệm của nhóm, không phải độ phân giải được một tiêu chuẩn bảo đảm chính xác. z đo từ mặt đất phẳng, chưa biểu diễn địa hình khảo sát. Cần phân biệt solid, không khí thiếu số liệu và nồng độ bằng 0.

## 2. Trường gió chẩn đoán và vận chuyển chất

URock 2023a là nghiên cứu về mô hình gió đô thị dựa trên GIS. Bài báo hữu ích để xem cách hình học đô thị tham gia mô hình gió và cách đánh giá mô hình. Không được lấy độ chính xác của URock làm độ chính xác cho chương trình khác. [Bernard và cộng sự, URock 2023a](https://gmd.copernicus.org/articles/16/5703/2023/).

Áp dụng: solver của dự án hiệu chỉnh trường gió theo ràng buộc bảo toàn khối lượng và vật cản. Nó không giải phương trình động lượng, không phải bản cài đặt đầy đủ của URock/Röckle và không đủ cơ sở tuyên bố tái hiện đầy đủ xoáy phố, wake hoặc nhiễu loạn giao thông.

Phương trình tải–khuếch tán cho chất thụ động có dạng `∂C/∂t + ∇·(uC) = ∇·(K∇C) + S`. Với thể tích hữu hạn, thông lượng rời một ô đi vào ô kề qua cùng mặt chung. Dự án dùng upwind bậc một cho tải và các vận tốc mặt đã hiệu chỉnh; không nội suy lại trường tâm ô để thay thế thông lượng bảo toàn.

Upwind bậc một có khuếch tán số. Khi kết luận đám ô nhiễm rộng hơn hoặc nồng độ giảm, phải xem xét đồng thời khuếch tán vật lý, lưới và bước thời gian. Gaussian chỉ làm baseline đơn giản; giả thiết của nó khác trường có vật cản nên không phải ground truth cho cảnh đô thị.

## 3. Kiểm tra số trị và độ tin cậy

NASA phân biệt kiểm tra chương trình giải đúng mô hình với đánh giá mô hình có đại diện thực tế hay không. Đối chiếu nghiệm giải tích và bảo toàn thuộc verification; đối chiếu đo đạc phù hợp mới hỗ trợ validation. [NASA, Verification and Validation](https://www.grc.nasa.gov/www/wind/valid/tutorial/overview.html).

Nghiên cứu hội tụ lưới xét nghiệm trên các lưới tinh dần. Residual nhỏ chỉ cho biết quá trình lặp thỏa điều kiện dừng, không chứng minh sai số rời rạc nhỏ. [NASA, Spatial Convergence](https://www.grc.nasa.gov/www/wind/valid/tutorial/spatconv.html).

Áp dụng: kiểm tra divergence, thông lượng xuyên tường, CFL, nồng độ không âm, cân bằng khối lượng và toàn vẹn artifact trước khi công nhận run thành công. Bài toán đóng, khuếch tán thuần và tải đều cần kết quả tham chiếu độc lập. Mọi hiệu chỉnh round-off phải được ghi khối lượng thay đổi; không clip âm để che bất ổn.

Thí nghiệm lưới/thời bước phải giữ cùng miền vật lý, nguồn, điều kiện biên và đại lượng so sánh. Cần báo sai số và chi phí, kiểm tra có nằm trong miền hội tụ tiệm cận trước khi dùng Richardson/GCI. Chức năng so sánh hai run cùng lưới trên web không thay cho nghiên cứu này.

## 4. Dữ liệu GIS, khí tượng và phát thải

### Footprint và chiều cao

OpenStreetMap có các thuộc tính chiều cao và số tầng nhưng mức hoàn chỉnh thay đổi theo khu vực. Chiều cao từ số tầng là suy ra, không phải đo đạc. Giấy phép và ghi công phải được giữ khi phân phối sản phẩm dữ liệu. [OSM height](https://wiki.openstreetmap.org/wiki/Key:height), [OSM building:levels](https://wiki.openstreetmap.org/wiki/Key:building:levels), [OSM copyright](https://www.openstreetmap.org/copyright).

Dự án có bước bổ sung chiều cao từ Google Open Buildings khi phù hợp. Phải kiểm tra sản phẩm, vùng phủ, năm dữ liệu và chất lượng ghép footprint, không mặc nhiên coi chiều cao là số đo từng tòa nhà. Mỗi feature cần lưu nguồn và chính sách fallback. [Google Open Buildings](https://sites.research.google/open-buildings/).

Đường dùng làm proxy phân bố phát thải; mặt nước và cây xanh hiện phục vụ dựng cảnh. Không suy ra chúng đã tham gia mô hình lắng đọng hoặc trao đổi nhiệt nếu solver chưa có các quá trình đó.

### Khí tượng

Historical Weather API của Open-Meteo cung cấp dữ liệu tái phân tích/mô hình, gồm gió và lựa chọn bộ dữ liệu. Độ phân giải này không tương đương quan trắc tại từng hẻm phố. [Open-Meteo Historical Weather](https://open-meteo.com/en/docs/historical-weather-api).

Áp dụng: tổng hợp các kịch bản mùa từ nguồn khí tượng, lưu khoảng thời gian, độ cao tham chiếu và quy ước hướng gió. Hướng khí tượng là hướng gió thổi từ, cần chuyển đúng sang vector tọa độ. Không dùng trung bình số học trực tiếp cho góc vòng tròn. Khi nâng profile theo z phải công bố giả thiết; dữ liệu nền không tự chứa trường gió sau nhà.

### Phát thải

EDGAR v8.1 công bố phát thải chất ô nhiễm, có PM2.5 và các lưới theo ngành. Đây là kiểm kê phát thải, không phải ảnh nồng độ ngoài trời. [JRC, EDGAR v8.1](https://edgar.jrc.ec.europa.eu/dataset_ap81).

Áp dụng: dự án dùng nguồn giao thông năm 2022 và phân bổ xuống đường trong miền. Chia nhỏ lưới bằng proxy không tạo thêm độ chính xác quan trắc. Phải giữ tổng lượng nguồn, đổi đơn vị theo metadata và ghi giả thiết thời gian. Nền bằng 0 mô tả đóng góp nguồn đang xét; không phải tổng PM2.5 thực tế. `emission_assumptions.md` là đầu ra ghi giả thiết của pipeline, không phải nguồn nghiên cứu độc lập.

## 5. Python, NumPy và SciPy

NumPy hỗ trợ mảng nhiều chiều và thao tác vector hóa; phù hợp trường nồng độ, mặt nạ và thông lượng trên lưới đều. Thứ tự chiều và broadcasting phải được kiểm tra vì lỗi tráo x/y/z vẫn có thể tạo ảnh trông hợp lý. [NumPy arrays](https://numpy.org/doc/stable/user/basics.ndarray.html), [NumPy broadcasting](https://numpy.org/doc/stable/user/basics.broadcasting.html).

SciPy cung cấp hệ thưa và conjugate gradient. `cg` yêu cầu toán tử Hermitian xác định dương; phải xét hệ sau khi đặt điều kiện biên/ràng buộc, không chọn chỉ vì chạy nhanh. Cần kiểm convergence code và residual thật; `maxiter` không phải chứng nhận hội tụ. [SciPy cg](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.cg.html).

Áp dụng: CG là hướng production cho hiệu chỉnh gió; SOR làm đối chiếu khi phù hợp. Tolerance và preconditioner cần đi cùng phép đo divergence của trường vận tốc mặt cuối cùng. Giới hạn phiên bản thư viện nằm trong requirements; tài liệu mới không chứng minh môi trường đã cài đúng phiên bản đó.

## 6. xarray, NetCDF và metadata

xarray quản lý mảng có tên chiều/tọa độ và đọc ghi NetCDF qua các backend. NetCDF phù hợp lưu trường đầy đủ, không cần ép mỗi voxel thành một dòng quan hệ. [xarray I/O](https://docs.xarray.dev/en/stable/user-guide/io.html), [Unidata NetCDF](https://docs.unidata.ucar.edu/netcdf-c/current/index.html).

CF Conventions quy định cách mô tả tọa độ, đơn vị, trục đứng và grid mapping giúp phần mềm khác hiểu dữ liệu. Trích dẫn CF không đồng nghĩa file đã đạt compliance. [CF Conventions 1.12](https://cfconventions.org/Data/cf-conventions/cf-conventions-1.12/cf-conventions.html).

Áp dụng: lưu C theo `[z,y,x]`, tọa độ tâm, CRS, đơn vị, thời gian, nguồn và model version; định nghĩa solid/no-data rõ. Nồng độ float32 có sai số lượng tử hóa riêng. Truy vấn phải giữ giá trị đã lưu, thay vì hứa khôi phục độ chính xác trước khi ghi float32. Kiểm mở bằng công cụ độc lập và validator khi công bố tuân thủ CF.

## 7. PostgreSQL và PostGIS

PostGIS cung cấp biến đổi hệ tọa độ và giao hình học. `ST_Transform` biến đổi tọa độ; gán SRID chỉ gắn nhãn. Các thao tác XY không tự tạo phân tích thể tích 3D. [ST_Transform](https://postgis.net/docs/ST_Transform.html), [ST_Intersection](https://postgis.net/docs/ST_Intersection.html).

PostgreSQL có mảng và chỉ mục; PostGIS mô tả cách dùng chỉ mục không gian để giảm tập ứng viên trước phép hình học chính xác. Không phải mọi truy vấn có GiST đều nhanh: cần xem plan và số hàng thực tế. [PostgreSQL arrays](https://www.postgresql.org/docs/current/arrays.html), [PostGIS spatial indexes](https://postgis.net/workshops/postgis-intro/indexing.html).

Áp dụng: geometry miền/nhà/đường cùng CRS, metadata run và các cột nồng độ phục vụ truy vấn trong DB; tensor đầy đủ ở artifact. Mảng PostgreSQL đánh chỉ số từ 1 cần ánh xạ rõ với chỉ số solver từ 0. float4 được cast sang float8 trước JSON để giữ giá trị float32 đã nhập.

Với vùng và khoảng cao, mỗi ô đóng góp `diện tích giao XY × chiều dày giao z`. Trung bình là tổng C nhân thể tích chia tổng thể tích không khí có số liệu. Không lấy trung bình các trung bình tầng khi trọng số khác nhau. Mặt cắt lấy mẫu theo khoảng cách trong CRS mét, tra ô và trả trạng thái; không nội suy ngầm qua nhà. Đây là lựa chọn thuật toán dự án, không phải kết quả tự có từ PostGIS.

## 8. NestJS monolith và Python subprocess

NestJS tổ chức request bằng controller và tách xử lý vào provider/service; validation pipe kết hợp DTO để chặn dữ liệu sai trước nghiệp vụ. Schema runtime bổ sung hợp đồng dữ liệu không gian/đầu ra khi cần. [NestJS controllers](https://docs.nestjs.com/controllers), [NestJS validation](https://docs.nestjs.com/techniques/validation), [NestJS providers](https://docs.nestjs.com/providers).

Node.js có API subprocess; chọn executable và arguments tách biệt tránh diễn giải input người dùng như lệnh shell. Phải xử lý exit, timeout, stdout/stderr và vòng đời tiến trình. [Node.js child_process](https://nodejs.org/api/child_process.html).

Áp dụng: NestJS phục vụ web/API và điều phối Python nội bộ, dùng `pg` truy cập PostgreSQL; không thêm MongoDB, Redis hay microservice. Request chạy mô phỏng trả run_id và trạng thái bất đồng bộ; DB giữ snapshot, attempt, lỗi và artifact. Giới hạn một solver đồng thời giúp kiểm soát tài nguyên, nhưng vẫn cần phục hồi run khi ứng dụng restart. Python không cần mở HTTP port.

DTO/controller không thay kiểm tra nghiệp vụ: run phải sẵn sàng, model/grid/mask phải tương thích trước comparison, chi phí mẫu phải được chặn trước query lớn. Version/hash/checksum phục vụ tái lập, không cần bày toàn bộ thông tin kỹ thuật trên sidebar.

## 9. MapLibre, deck.gl và biểu diễn đô thị

MapLibre có ví dụ dựng nhà bằng extrusion; deck.gl PolygonLayer hỗ trợ polygon có độ cao và picking. Chúng là công cụ vẽ, không chứng minh chiều cao hoặc mái đúng thực tế. [MapLibre 3D buildings](https://maplibre.org/maplibre-gl-js/docs/examples/display-buildings-in-3d/), [deck.gl PolygonLayer](https://deck.gl/docs/api-reference/layers/polygon-layer).

Áp dụng: LoD1 lấy footprint/height từ cùng dữ liệu GIS với voxelizer. Màu thân nhà trung tính để lớp nồng độ nổi bật; cửa sổ procedural chỉ là minh họa vật liệu, không phải texture ảnh từng nhà. Giữ legend nồng độ/đơn vị riêng với màu nhà. Không có yêu cầu GIS chung buộc nhà phải mang một màu xanh cụ thể.

Dải/hạt gió diễn tả hướng và chuyển động từ trường gió mô hình. Animation liên tục không có nghĩa bài toán được giải transient theo thời gian thực; tốc độ particle và chiều dài vệt là thông số vẽ cần tránh gây hiểu nhầm. Thang màu nồng độ phải có đơn vị, xử lý C=0; chênh lệch có dấu cần thang phân kỳ.

### Ba loại độ chi tiết

| Khái niệm | Tác động | Hướng áp dụng |
|---|---|---|
| LoD hiển thị | Số chi tiết, draw call, culling theo camera | Tối ưu renderer, đo FPS/frame time/bộ nhớ trước–sau; giữ nguyên query và mask |
| LoD hình học đô thị | Hình dạng khối/mái có nguồn | LoD1 hiện tại; LoD2 chỉ khi đủ nguồn mái, giấy phép và kiểm chất lượng |
| Độ phân giải solver | Rời rạc hóa trường và vật cản | Nghiên cứu hội tụ/sai số và chi phí, không đổi theo camera |

3DBAG mô tả các lớp LoD từ extrusion đến mái phức tạp, hữu ích để phân biệt cải thiện hình học với thay vật liệu. Đây là bộ dữ liệu Hà Lan, không phải nguồn mái sẵn có cho TP.HCM. 3D Tiles phục vụ phân cấp/streaming nội dung lớn; không bắt buộc đưa vào miền nhỏ chỉ để có tên công nghệ. [3DBAG layers](https://docs.3dbag.nl/en/schema/layers/), [OGC 3D Tiles](https://www.ogc.org/standards/3dtiles/).

## 10. UI, kiểm thử và tái lập

Tooltip cung cấp giải thích ngắn khi hover/focus; Escape đóng mà không cướp thao tác chính. Chú thích không thay nhãn nút, đơn vị, lỗi hoặc kết quả. Đây là hướng thiết kế tương tác, không phải tuyên bố đã đạt chứng nhận truy cập. [WAI-ARIA tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/).

Áp dụng: dùng Bootstrap Icons thống nhất, tiêu đề ngắn, một hành động chính rõ ràng; trạng thái chưa chọn không bày thẻ dữ liệu rỗng. Số liệu quan trọng có đơn vị, bố cục đọc theo nhóm thay vì nhiều đường kẻ. Lỗi cần tiếng Việt và hướng sửa; giữ trạng thái loading/offline/empty rõ ràng, không biến lỗi thành số 0.

Vitest phục vụ kiểm thử TypeScript của app; Node test runner kiểm các mô-đun web; pytest kiểm tính toán Python. DB integration cần PostGIS thật và fixture có kết quả tính tay, ngoài happy path phải có solid/no-data, giao một phần, biên miền và lỗi hình học. [Vitest guide](https://vitest.dev/guide/), [Node test runner](https://nodejs.org/api/test.html), [pytest](https://docs.pytest.org/en/stable/).

Docker Compose mô tả dịch vụ và môi trường phụ thuộc; migrate/seed/version thư viện và dữ liệu đầu vào vẫn phải được quản lý để tái lập. Container chạy được không chứng minh mô hình đúng. [Docker Compose](https://docs.docker.com/compose/).

Kết luận nghiên cứu cần truy ngược về run, tham số, input hash và phép kiểm tra. Những việc chưa đo như hiệu quả render LoD, hội tụ lưới hoặc độ đúng so với đo đạc phải được trình bày là công việc cần thực hiện, không biến nguồn tham khảo thành kết quả của dự án.
