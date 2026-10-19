import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional, Min } from 'class-validator';

export class RegionQueryDto {
  @ApiProperty({
    description: '2D WGS84 GeoJSON Polygon; max 500 vertices / 20 rings',
  })
  @IsObject()
  polygon!: { type: string; coordinates: unknown };

  @ApiProperty({ example: 0 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_min_m!: number;

  @ApiProperty({ example: 15 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_max_m!: number;

  @ApiPropertyOptional({
    default: 15,
    description: 'Reference only, not 24h field validation',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  threshold_ug_m3?: number;
}
