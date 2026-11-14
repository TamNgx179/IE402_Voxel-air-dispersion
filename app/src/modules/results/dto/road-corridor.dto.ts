import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNumber, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class RoadCorridorDto {
  @ApiProperty({ type: [String], description: 'Road IDs from the scene source_feature_id field' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  road_ids!: string[];

  @ApiProperty({ type: [Number], example: [10, 25, 50] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsNumber({}, { each: true })
  @Min(0.1, { each: true })
  @Max(100, { each: true })
  distances_m!: number[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  z_min_m!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  z_max_m!: number;

  @ApiPropertyOptional({ default: 15 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  threshold_ug_m3?: number;
}
