import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class ComparisonQueryDto {
  @ApiProperty({
    description: 'Comparison run; delta = comparison minus baseline',
  })
  @IsUUID()
  compare_run_id!: string;

  @ApiPropertyOptional({ default: 1.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  z_m?: number;
}
