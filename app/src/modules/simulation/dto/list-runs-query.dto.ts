import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { RUN_MODELS, type RunModel } from './create-run.dto.js';

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'stale',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export class ListRunsQueryDto {
  @ApiPropertyOptional({ enum: RUN_STATUSES })
  @IsOptional()
  @IsIn(RUN_STATUSES)
  status?: RunStatus;

  @ApiPropertyOptional({ enum: RUN_MODELS })
  @IsOptional()
  @IsIn(RUN_MODELS)
  model?: RunModel;

  @ApiPropertyOptional({ example: 'dry_nov_apr' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  scenario_id?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
