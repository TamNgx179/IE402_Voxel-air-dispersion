import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const RUN_MODELS = ['fv', 'gaussian'] as const;
export type RunModel = (typeof RUN_MODELS)[number];

/** Body of POST /api/runs (BR-16). Unknown properties are rejected (400). */
export class CreateRunDto {
  @ApiProperty({
    example: 'dry_nov_apr',
    description: 'Scenario id from GET /api/scenarios',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'scenario_id may only contain letters, digits, "_" and "-"',
  })
  scenario_id!: string;

  @ApiPropertyOptional({
    enum: RUN_MODELS,
    default: 'fv',
    description:
      'fv is the product result; gaussian is the labelled baseline (BR-38)',
  })
  @IsOptional()
  @IsIn(RUN_MODELS)
  model?: RunModel;
}
