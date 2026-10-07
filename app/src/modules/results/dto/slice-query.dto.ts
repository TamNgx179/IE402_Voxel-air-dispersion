import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Matches, Min } from 'class-validator';

export class SliceQueryDto {
  @ApiPropertyOptional({ example: 1.5, default: 1.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_m?: number;

  @ApiPropertyOptional({
    example: '106.70,10.77,106.71,10.78',
    description: 'Optional WGS84 bbox: west,south,east,north',
  })
  @IsOptional()
  @Matches(
    /^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/,
  )
  bbox?: string;
}
