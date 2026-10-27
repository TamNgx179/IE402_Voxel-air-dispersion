import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, Min, ValidateIf } from 'class-validator';

/** Request mặt cắt: tọa độ web là lon/lat, cao độ và bước lấy mẫu tính bằng mét. */
export class TransectQueryDto {
  @ApiProperty({
    description: 'WGS84 LineString, 2–100 longitude/latitude positions',
  })
  @IsObject()
  line!: { type: string; coordinates: unknown };

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_min_m!: number;

  @ApiProperty({ example: 30 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_max_m!: number;

  @ApiPropertyOptional({
    description:
      'Metres; default min(dx,dy), at most that spacing. Max 20,000 position × layer samples.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  // Chỉ cho phép bỏ qua step_m khi không gửi; gửi null phải bị từ chối, không đổi thành mặc định.
  @Type(() => Number)
  @IsNumber()
  step_m?: number;
}
