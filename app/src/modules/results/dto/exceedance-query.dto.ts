import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

export class ExceedanceQueryDto {
  @ApiPropertyOptional({ example: 1.5, default: 1.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_m?: number;

  @ApiPropertyOptional({ example: 'qcvn_24h', default: 'qcvn_24h' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  threshold_key?: string;

  @ApiPropertyOptional({
    example: 45,
    description:
      'Custom threshold in µg/m³; mutually exclusive with threshold_key',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  threshold?: number;
}
