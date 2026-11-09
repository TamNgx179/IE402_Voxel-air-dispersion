import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const RUN_MODELS = ['fv', 'gaussian'] as const;
export type RunModel = (typeof RUN_MODELS)[number];

/** Body of POST /api/runs (BR-16). Unknown properties are rejected (400). */
export class CreateRunDto {
  @ApiPropertyOptional({ description: 'Client UUID v4 reused if the create response is lost' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  request_id?: string;

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

  @ApiPropertyOptional({ enum: [1, 0.8, 0.6], default: 1,
    description: 'Absolute source rate multiplier: baseline, -20%, -40%; FV only' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn([1, 0.8, 0.6])
  emission_multiplier?: number;
}
