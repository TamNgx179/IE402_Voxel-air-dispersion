# Mặt đứng thật và mặt đứng minh họa

`registry.json` hiện rỗng: **chưa có ảnh mặt đứng thực tế** trong repository.
Tất cả cửa sổ/vật liệu hiện tại là minh họa theo footprint/height LoD1, không phải khảo sát
ngoại hình hay số tầng thật. Không dùng AI-generated facade làm bằng chứng thực tế.

## Gắn ảnh có quyền sử dụng

1. Lấy `source_feature_id` của building qua API scene hoặc bấm/hover nhà trên web.
2. Chuẩn bị ảnh chụp đúng mặt đứng, đã crop/rectify mặt phẳng; không lấy ảnh mái vệ tinh
   hoặc ảnh của tòa khác rồi gọi là facade thật.
3. Đặt ảnh trong `web/assets/facades/images/`, tên chỉ chữ/số/dấu gạch, PNG/JPG/WebP.
4. Trong `registry.json`, thêm entry theo schema dưới. `part` là polygon trong
   MultiPolygon (0 với Polygon), `edge` là cạnh của exterior ring theo **thứ tự API**.
   Ring đóng; cạnh cuối nối về điểm đầu. Lấy đúng hướng trái/phải của ảnh theo cạnh.

```json
{
  "schema_version": "1.0",
  "buildings": {
    "way/BUILDING_ID": {
      "walls": [{
        "part": 0,
        "edge": 1,
        "image": "./assets/facades/images/your-building-east.jpg",
        "source_url": "https://your-verified-source.example/photo",
        "credit": "Tên tác giả ảnh",
        "license": "Giấy phép/quyền sử dụng được xác nhận"
      }]
    }
  }
}
```

Đây chỉ là **format mẫu**, không phải building ID/ảnh đã xác minh. Không chép nguyên entry
mẫu vào registry production. `source_url` là thông tin nguồn, không tự tải ảnh remote.
Metadata bắt buộc nhưng không tự chứng minh quyền tác giả/đúng tòa: người thêm phải kiểm
tra nguồn, quyền dùng và correspondence giữa cạnh/ảnh. Nếu ảnh mất/lỗi tải hoặc thiếu
metadata, viewer giữ mặt đứng minh họa cho cạnh đó. Các cạnh không có ảnh vẫn minh họa.

Ảnh được phủ bằng [BitmapLayer bounds 3D](https://deck.gl/docs/api-reference/layers/bitmap-layer),
cửa sổ minh họa dùng polygon 3D. Scene GIS, heights, solid mask, DB và solver không bị sửa.
Ảnh chưa rectified có thể méo khi phủ lên LoD1; không biến facade ảnh thành LoD3 mesh.

## Gió

Animation không còn lifespan 18 s hoặc throttle 33 ms. Hạt dùng vận tốc solver và thời
gian frame; dừng ở solid/biên rồi tái sinh mờ dần. Vùng gió gần zero đi chậm đúng dữ liệu;
không dùng vận tốc nền giả để ép hạt chạy xuyên nhà. Pause/reduced-motion/tab ẩn vẫn giữ.
