import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScenariosService } from '../services/scenarios.service.js';

@ApiTags('scenarios')
@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  @ApiOperation({ summary: 'List meteorology scenarios' })
  @ApiOkResponse({ description: 'Array of scenarios' })
  list() {
    return this.scenarios.list();
  }
}

@ApiTags('thresholds')
@Controller('thresholds')
export class ThresholdsController {
  constructor(private readonly scenarios: ScenariosService) {}

  @Get()
  @ApiOperation({
    summary: 'Single source of truth for configured PM2.5 thresholds',
  })
  thresholds() {
    return this.scenarios.thresholds();
  }
}
