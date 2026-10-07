export interface ScenarioSchema {
  id: string;
  study_area_id: string;
  name: string;
  wind_from_deg: number;
  wind_speed_m_s: number;
  parameters: Record<string, unknown>;
}

export interface ThresholdSchema {
  key: string;
  value_ug_m3: number;
  label: string;
  config_hash: string;
}
