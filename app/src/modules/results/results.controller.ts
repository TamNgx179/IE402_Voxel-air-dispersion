import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ExceedanceQueryDto } from './dto/exceedance-query.dto.js';
import { ProfileQueryDto } from './dto/profile-query.dto.js';
import { SliceQueryDto } from './dto/slice-query.dto.js';
import { ResultsService } from './results.service.js';

@ApiTags('results')
@Controller('runs/:id')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get('slices')
  @ApiOperation({ summary: 'Concentration GeoJSON at the nearest z layer' })
  @ApiOkResponse({ description: 'GeoJSON cells, exact z layer and statistics' })
  @ApiConflictResponse({ description: 'Run has not succeeded' })
  slices(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: SliceQueryDto,
  ) {
    return this.results.slice(id, query);
  }

  @Get('exceedance')
  @ApiOperation({ summary: 'Cells above a configured or custom threshold' })
  exceedance(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ExceedanceQueryDto,
  ) {
    return this.results.exceedance(id, query);
  }

  @Get('profile')
  @ApiOperation({
    summary: 'Vertical concentration profile at grid column i,j',
  })
  profile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ProfileQueryDto,
  ) {
    return this.results.profile(id, query);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Layer statistics, thresholds, mass metrics and verification',
  })
  summary(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.results.summary(id);
  }

  @Get('volume')
  @ApiOperation({
    summary: 'Compact uint8 volume payload for the same-origin web viewer',
  })
  volume(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.results.volume(id);
  }

  @Get('artifacts')
  @ApiOperation({ summary: 'Verified artifact metadata and download URLs' })
  artifacts(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.results.artifacts(id);
  }

  @Get('artifacts/:kind/download')
  @ApiOperation({
    summary: 'Download one verified artifact without exposing local paths',
  })
  @ApiNotFoundResponse({ description: 'Run or artifact not found' })
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('kind') kind: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.results.download(id, kind);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    response.setHeader('Content-Length', String(file.size));
    return new StreamableFile(file.stream);
  }
}
