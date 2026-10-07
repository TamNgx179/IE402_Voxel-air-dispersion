import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthReportSchema } from '../schemas/health-report.schema.js';
import { HealthService } from '../services/health.service.js';

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
  check(): Promise<HealthReportSchema> {
    return this.health.check();
  }
}
