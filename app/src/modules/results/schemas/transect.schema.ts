/** Tọa độ WGS84 theo thứ tự [kinh độ, vĩ độ]; x_m/y_m trên sample là tọa độ chiếu riêng. */
export type Position = [number, number];
export interface TransectLine {
  type: 'LineString';
  coordinates: Position[];
}
/** Kết quả persistence theo một vị trí mẫu; chưa diễn giải solid/air/no_data. */
export interface TransectColumnRow {
  ordinal: number;
  grid_present: boolean;
  sample_coordinates: Position;
  cell_center_coordinates: Position;
  concentrations: (number | null)[] | null;
  solid_from_k: number | null;
  solid_to_k: number | null;
}
/** Tâm voxel là nơi có giá trị; khoảng overlap là phần tầng giao khoảng z người dùng chọn. */
export interface TransectLayer {
  k: number;
  z_center_m: number;
  overlap_min_m: number;
  overlap_max_m: number;
}
/** Một vị trí dọc tuyến có nhiều tầng. Nồng độ 0 là dữ liệu hợp lệ, khác null/no_data/solid. */
export interface TransectSample {
  distance_m: number;
  x_m: number;
  y_m: number;
  i: number;
  j: number;
  sample_coordinates: Position;
  cell_center_coordinates: Position;
  cells: {
    k: number;
    concentration_ug_m3: number | null;
    status: 'air' | 'solid' | 'no_data';
  }[];
}
