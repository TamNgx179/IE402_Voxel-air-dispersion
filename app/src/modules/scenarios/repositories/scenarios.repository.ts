import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import type { ScenarioSchema, ThresholdSchema } from '../schemas/scenario.schema.js';

@Injectable()
export class ScenariosRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(): Promise<ScenarioSchema[]> {
    const { rows } = await this.db.query<ScenarioSchema>(
      `SELECT id, study_area_id, name, wind_from_deg, wind_speed_m_s, parameters
       FROM scenarios ORDER BY id`,
    );
    return rows;
  }

  async findThresholds(): Promise<ThresholdSchema[]> {
    const { rows } = await this.db.query<ThresholdSchema>(
      'SELECT key, value_ug_m3, label, config_hash FROM thresholds ORDER BY value_ug_m3 DESC',
    );
    return rows;
  }
}
