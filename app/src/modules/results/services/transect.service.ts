import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { TransectQueryDto } from '../dto/transect-query.dto.js';
import { SimulationResultsRepository } from '../repositories/simulation-results.repository.js';
import { TransectRepository } from '../repositories/transect.repository.js';
import type {
  Position,
  TransectLayer,
  TransectLine,
  TransectSample,
} from '../schemas/transect.schema.js';

export const TRANSECT_MAX_VERTICES = 100;
export const TRANSECT_MAX_SAMPLES = 20_000;
// Bù sai số round-trip CRS ở đúng biên ô (0,1 micromet), không nới miền mô phỏng.
const BOUNDARY_EPS_M = 1e-7;

/**
 * Truy vấn mặt cắt từ kết quả đã lưu; không chạy solver hoặc sửa tensor.
 * Luồng: kiểm run → chiếu tuyến → lấy mẫu theo mét → tra voxel → gắn trạng thái/metadata.
 * Repository giữ SQL; service quyết định quy tắc cao độ, chỉ số và dữ liệu hợp lệ.
 */
@Injectable()
export class TransectService {
  constructor(
    private readonly results: SimulationResultsRepository,
    private readonly repository: TransectRepository,
  ) {}

  async query(id: string, input: TransectQueryDto) {
    // Run là nguồn của CRS/lưới; không lấy spacing hay hệ tọa độ do client tự khai báo.
    const line = validateLine(input.line);
    const ctx = await this.results.runContext(id);
    if (!ctx) throw new NotFoundException('Không tìm thấy kết quả mô phỏng.');
    if (ctx.status !== 'succeeded')
      throw new ConflictException(
        'Mô phỏng chưa hoàn tất; chưa thể xem mặt cắt.',
      );
    const g = ctx.grid,
      min = input.z_min_m,
      max = input.z_max_m;
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min < 0 ||
      min >= max ||
      max > g.nz * g.dz_m
    )
      throw new BadRequestException(
        'Khoảng cao độ phải nằm trong mô hình, từ thấp đến cao.',
      );
    const step = input.step_m ?? Math.min(g.dx_m, g.dy_m);
    if (!Number.isFinite(step) || step <= 0 || step > Math.min(g.dx_m, g.dy_m))
      throw new BadRequestException(
        `Bước lấy mẫu phải lớn hơn 0 và không quá ${Math.min(g.dx_m, g.dy_m)} m.`,
      );
    const projected = await this.repository.projectLine(
      JSON.stringify(line),
      ctx.study_area_id,
      ctx.projected_srid,
    );
    if (!projected?.covered || !projected.coordinates)
      throw new BadRequestException(
        'Tuyến phải nằm hoàn toàn trong khu vực mô phỏng.',
      );
    // Ô chứa điểm dùng khoảng nửa kín [min,max); biên trong thuộc ô phía Đông/Bắc.
    // Chỉ snap sai số round-trip rất nhỏ, không clip một tuyến ngoài miền vào lưới.
    const index = (
      v: number,
      origin: number,
      spacing: number,
      count: number,
    ) => {
      const offset = v - origin,
        nearest = Math.round(offset / spacing) * spacing;
      const snapped =
        Math.abs(offset - nearest) <= BOUNDARY_EPS_M ? nearest : offset;
      const value = Math.floor(snapped / spacing);
      if (value < 0 || value >= count)
        throw new BadRequestException(
          'Tuyến nằm ngoài lưới hoặc trên biên ngoài cùng. Hãy vẽ vào bên trong.',
        );
      return value;
    };
    for (const [x, y] of projected.coordinates) {
      index(x, g.origin_x_m, g.dx_m, g.nx);
      index(y, g.origin_y_m, g.dy_m, g.ny);
    }
    // Cộng chiều dài từng đoạn sau khi chiếu sang CRS mét, kể cả tuyến gấp khúc/tự cắt.
    const distances = [0];
    for (let n = 1; n < projected.coordinates.length; n++) {
      const a = projected.coordinates[n - 1],
        b = projected.coordinates[n];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length <= BOUNDARY_EPS_M)
        throw new BadRequestException(
          'Hai điểm liên tiếp phải khác nhau; tuyến cần có chiều dài.',
        );
      distances.push(distances[n - 1] + length);
    }
    const length = distances.at(-1)!;
    // Giữ cả tầng giao một phần: giá trị vẫn ở tâm voxel, còn overlap chỉ là phần cao độ được chọn.
    const first = Math.floor(min / g.dz_m),
      last = Math.ceil(max / g.dz_m) - 1;
    const intervals = Math.ceil(length / step);
    // Giới hạn chi phí theo số ô trả về (vị trí × tầng), không chỉ số điểm trên tuyến.
    if ((intervals + 1) * (last - first + 1) > TRANSECT_MAX_SAMPLES)
      throw new BadRequestException(
        'Mặt cắt vượt giới hạn 20.000 mẫu. Hãy rút ngắn tuyến, thu hẹp khoảng cao độ hoặc tăng bước lấy mẫu.',
      );
    const layers: TransectLayer[] = Array.from(
      { length: last - first + 1 },
      (_, n) => ({
        k: first + n,
        z_center_m: (first + n + 0.5) * g.dz_m,
        overlap_min_m: Math.max(min, (first + n) * g.dz_m),
        overlap_max_m: Math.min(max, (first + n + 1) * g.dz_m),
      }),
    );
    // Chia đều và giữ hai đầu để đảo chiều tuyến vẫn đối chiếu được cùng các vị trí mẫu.
    const samples: Omit<
      TransectSample,
      'cells' | 'sample_coordinates' | 'cell_center_coordinates'
    >[] = [];
    let segment = 1;
    for (let n = 0; n <= intervals; n++) {
      const distance = n === intervals ? length : (n * length) / intervals;
      while (segment < distances.length - 1 && distance > distances[segment])
        segment++;
      const t =
        (distance - distances[segment - 1]) /
        (distances[segment] - distances[segment - 1]);
      const a = projected.coordinates[segment - 1],
        b = projected.coordinates[segment];
      const x = a[0] + (b[0] - a[0]) * t,
        y = a[1] + (b[1] - a[1]) * t;
      samples.push({
        distance_m: distance,
        x_m: x,
        y_m: y,
        i: index(x, g.origin_x_m, g.dx_m, g.nx),
        j: index(y, g.origin_y_m, g.dy_m, g.ny),
      });
    }
    // Đọc theo lô: một lần lấy các cột z thay vì một query cho mỗi ô trên biểu đồ.
    const columns = await this.repository.columns(
      id,
      ctx.study_area_id,
      ctx.projected_srid,
      g,
      samples,
      first,
      last,
    );
    const output: TransectSample[] = samples.map((sample, n) => {
      const column = columns[n];
      if (!column || column.ordinal !== n + 1 || !column.grid_present)
        throw new ConflictException(
          'Dữ liệu mặt cắt chưa đầy đủ. Hãy thử lại.',
        );
      return {
        ...sample,
        sample_coordinates: column.sample_coordinates,
        cell_center_coordinates: column.cell_center_coordinates,
        cells: layers.map((layer, offset) => {
          // Solid theo scene mask, không suy từ C=0. Null ở ô không khí là thiếu dữ liệu.
          // Có nồng độ trong solid là cảnh/kết quả không khớp, phải từ chối thay vì giấu đi.
          const solid =
            column.solid_from_k !== null &&
            column.solid_to_k !== null &&
            layer.k >= column.solid_from_k &&
            layer.k <= column.solid_to_k;
          const value = column.concentrations?.[offset];
          if (solid && value !== null && value !== undefined)
            throw new ConflictException(
              'Nồng độ và mô hình tòa nhà không khớp. Chọn kết quả có cùng cảnh mô phỏng.',
            );
          return {
            k: layer.k,
            concentration_ug_m3:
              !solid &&
              value !== null &&
              value !== undefined &&
              Number.isFinite(value)
                ? value
                : null,
            status: solid
              ? 'solid'
              : value === null || value === undefined || !Number.isFinite(value)
                ? 'no_data'
                : 'air',
          };
        }),
      };
    });
    return {
      run_id: id,
      model_version: ctx.model_version,
      input_hash: ctx.input_hash,
      scene_version: ctx.scene_version,
      projected_srid: ctx.projected_srid,
      units: 'ug m-3',
      vertical_reference: 'metres above flat model ground',
      line,
      z_min_m: min,
      z_max_m: max,
      requested_step_m: step,
      actual_step_m: length / intervals,
      length_m: length,
      sampling: 'containing voxel; no interpolation',
      layers,
      samples: output,
    };
  }

  async csv(id: string, input: TransectQueryDto) {
    // Dùng lại cùng phép lấy mẫu với JSON; CSV không được giải mã từ màu của canvas.
    const result = await this.query(id, input);
    const rows: unknown[][] = [
      [
        'run_id',
        'model_version',
        'input_hash',
        'scene_version',
        'projected_srid',
        'units',
        'vertical_reference',
        'line_geojson',
        'z_min_m',
        'z_max_m',
        'requested_step_m',
        'actual_step_m',
        'distance_m',
        'sample_lon',
        'sample_lat',
        'x_m',
        'y_m',
        'i',
        'j',
        'cell_center_lon',
        'cell_center_lat',
        'k',
        'z_center_m',
        'overlap_min_m',
        'overlap_max_m',
        'status',
        'concentration_ug_m3',
      ],
    ];
    for (const sample of result.samples)
      for (let n = 0; n < result.layers.length; n++) {
        const layer = result.layers[n],
          cell = sample.cells[n];
        rows.push([
          id,
          result.model_version,
          result.input_hash,
          result.scene_version,
          result.projected_srid,
          result.units,
          result.vertical_reference,
          JSON.stringify(result.line),
          result.z_min_m,
          result.z_max_m,
          result.requested_step_m,
          result.actual_step_m,
          sample.distance_m,
          ...sample.sample_coordinates,
          sample.x_m,
          sample.y_m,
          sample.i,
          sample.j,
          ...sample.cell_center_coordinates,
          layer.k,
          layer.z_center_m,
          layer.overlap_min_m,
          layer.overlap_max_m,
          cell.status,
          cell.concentration_ug_m3,
        ]);
      }
    return rows.map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n';
  }
}

function validateLine(raw: TransectQueryDto['line']): TransectLine {
  // DTO kiểm envelope request; cấu trúc GeoJSON lồng nhau được kiểm ở đây trước khi gửi PostGIS.
  if (
    !raw ||
    raw.type !== 'LineString' ||
    Object.keys(raw).some((k) => !['type', 'coordinates'].includes(k)) ||
    !Array.isArray(raw.coordinates) ||
    raw.coordinates.length < 2 ||
    raw.coordinates.length > TRANSECT_MAX_VERTICES
  )
    throw new BadRequestException('Tuyến cần từ 2 đến 100 điểm.');
  for (const p of raw.coordinates)
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      p.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90
    )
      throw new BadRequestException(
        'Tọa độ tuyến phải là cặp kinh độ, vĩ độ hợp lệ.',
      );
  return { type: 'LineString', coordinates: raw.coordinates as Position[] };
}
function csvValue(value: unknown) {
  // Chặn công thức spreadsheet ở metadata dạng text; số âm thật vẫn xuất như số.
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
