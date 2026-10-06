import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../../database/database.service.js';

export interface ScenarioView {
  id: string;
  study_area_id: string;
  name: string;
  wind_from_deg: number;
  wind_speed_m_s: number;
  parameters: Record<string, unknown>;
}

@ApiTags('scenarios')
@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({
    summary: 'List meteorology scenarios (seeded from config/project.yaml)',
  })
  @ApiOkResponse({ description: 'Array of scenarios' })
  async list(): Promise<ScenarioView[]> {
    const { rows } = await this.db.query<ScenarioView>(
      `SELECT id, study_area_id, name, wind_from_deg, wind_speed_m_s, parameters
       FROM scenarios ORDER BY id`,
    );
    return rows;
  }
}
