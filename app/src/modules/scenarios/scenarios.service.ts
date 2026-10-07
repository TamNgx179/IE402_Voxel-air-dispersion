import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';

@Injectable()
export class ScenariosService {
  constructor(private readonly db: DatabaseService) {}

  async list() {
    const { rows } = await this.db.query(
      `SELECT id, study_area_id, name, wind_from_deg, wind_speed_m_s, parameters
       FROM scenarios ORDER BY id`,
    );
    return rows.map((row) => ({
      ...row,
      wind_from_deg: Number(row.wind_from_deg),
      wind_speed_m_s: Number(row.wind_speed_m_s),
    }));
  }

  async thresholds() {
    const { rows } = await this.db.query(
      'SELECT key, value_ug_m3, label, config_hash FROM thresholds ORDER BY value_ug_m3 DESC',
    );
    return rows.map((row) => ({
      ...row,
      value_ug_m3: Number(row.value_ug_m3),
    }));
  }
}
