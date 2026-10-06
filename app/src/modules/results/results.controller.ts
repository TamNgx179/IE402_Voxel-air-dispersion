import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { notImplemented } from '../../common/not-implemented.js';

/** Read-only result queries for a run (BR-24..BR-26). */
@ApiTags('results')
@Controller('runs/:id')
export class ResultsController {
  @Get('slices')
  @ApiOperation({ summary: 'Concentration layer at height z_m (501 for now)' })
  @ApiQuery({ name: 'z_m', required: false, type: Number })
  slices(@Param('id') id: string): never {
    return notImplemented(`GET /runs/${id}/slices`);
  }

  @Get('exceedance')
  @ApiOperation({ summary: 'Cells/areas above threshold (501 for now)' })
  @ApiQuery({ name: 'threshold', required: false, type: Number })
  exceedance(@Param('id') id: string): never {
    return notImplemented(`GET /runs/${id}/exceedance`);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Vertical profile at (x, y) (501 for now)' })
  @ApiQuery({ name: 'x', required: false, type: Number })
  @ApiQuery({ name: 'y', required: false, type: Number })
  profile(@Param('id') id: string): never {
    return notImplemented(`GET /runs/${id}/profile`);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Mean/max, exceedance volume, mass balance (501 for now)',
  })
  summary(@Param('id') id: string): never {
    return notImplemented(`GET /runs/${id}/summary`);
  }

  @Get('artifacts')
  @ApiOperation({ summary: 'Manifest and artifact references (501 for now)' })
  artifacts(@Param('id') id: string): never {
    return notImplemented(`GET /runs/${id}/artifacts`);
  }
}
