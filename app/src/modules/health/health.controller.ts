import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService, type HealthReport } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Monolith, artifact directory, Python runtime and DB status',
  })
  @ApiOkResponse({
    description: 'Always 200; `status` is "degraded" when a dependency fails',
  })
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
