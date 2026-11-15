import { Injectable } from '@nestjs/common';
import { ScenariosModel } from '../models/scenarios.model.js';

@Injectable()
export class ScenariosService {
  constructor(private readonly scenarios: ScenariosModel) {}

  async list() {
    const rows = await this.scenarios.findAll();
    return rows.map((row) => ({
      ...row,
      wind_from_deg: Number(row.wind_from_deg),
      wind_speed_m_s: Number(row.wind_speed_m_s),
    }));
  }

  async thresholds() {
    const rows = await this.scenarios.findThresholds();
    return rows.map((row) => ({
      ...row,
      value_ug_m3: Number(row.value_ug_m3),
    }));
  }
}
