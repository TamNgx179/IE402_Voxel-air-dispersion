import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TransectQueryDto } from '../dto/transect-query.dto.js';
import { TransectService } from '../services/transect.service.js';

/** HTTP adapter: validate DTO/UUID và giao việc cho service, không chứa SQL hay phép tính. */
@ApiTags('spatial-analysis')
@Controller('runs/:id/transect')
export class TransectController {
  constructor(private readonly transects: TransectService) {}
  // POST vì tuyến/khoảng z là một body có cấu trúc; vẫn là query chỉ đọc nên trả 200.
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Read-only vertical transect, exact containing-voxel values; no interpolation',
  })
  query(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TransectQueryDto,
  ) {
    return this.transects.query(id, body);
  }
  // Xuất cùng kết quả khoa học qua service, chỉ khác content type và cách đóng gói.
  @Post('csv')
  @HttpCode(200)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vertical-transect.csv"')
  @ApiOperation({
    summary:
      'Read-only vertical transect CSV with cell, altitude and run provenance',
  })
  csv(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TransectQueryDto,
  ) {
    return this.transects.csv(id, body);
  }
}
