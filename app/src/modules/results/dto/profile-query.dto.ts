import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ProfileQueryDto {
  @ApiProperty({ example: 12, description: 'Grid column index along x' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  i!: number;

  @ApiProperty({ example: 20, description: 'Grid column index along y' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  j!: number;
}
