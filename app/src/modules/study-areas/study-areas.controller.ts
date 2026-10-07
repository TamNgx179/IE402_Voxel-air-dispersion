import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudyAreasService } from './study-areas.service.js';

@ApiTags('study-areas')
@Controller('study-areas')
export class StudyAreasController {
  constructor(private readonly studyAreas: StudyAreasService) {}

  @Get()
  @ApiOperation({
    summary: 'List study areas, grids, provenance and WGS84 bounds',
  })
  @ApiOkResponse({ description: 'Array of study areas' })
  list() {
    return this.studyAreas.list();
  }

  @Get(':id/scene')
  @ApiOperation({
    summary: 'Data-derived LoD1 buildings, roads, water and green GeoJSON',
  })
  scene(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.studyAreas.scene(id);
  }
}
