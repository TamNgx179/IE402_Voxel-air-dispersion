import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComparisonQueryDto } from '../dto/comparison-query.dto.js';
import { RegionQueryDto } from '../dto/region-query.dto.js';
import { SpatialAnalysisService } from '../services/spatial-analysis.service.js';

@ApiTags('spatial-analysis')
@Controller('runs/:id')
export class SpatialAnalysisController {
  constructor(private readonly analysis: SpatialAnalysisService) {}

  @Get('comparison')
  @ApiOperation({
    summary: 'Exact comparison: comparison minus baseline, same grid and mask',
  })
  comparison(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ComparisonQueryDto,
  ) {
    return this.analysis.comparison(id, query);
  }

  @Post('region')
  @ApiOperation({
    summary: 'Read-only polygon/z query weighted by intersected air volume',
  })
  region(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() query: RegionQueryDto,
  ) {
    return this.analysis.region(id, query);
  }

  @Post('region/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="region-analysis.csv"')
  @ApiOperation({
    summary: 'Read-only region analysis CSV, no simulation created',
  })
  csv(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() query: RegionQueryDto,
  ) {
    return this.analysis.csv(id, query);
  }
}
