export interface GridSchema {
  origin_x_m: number;
  origin_y_m: number;
  dx_m: number;
  dy_m: number;
  dz_m: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface ResultRunContext {
  id: string;
  status: string;
  model: string;
  scenario_id: string;
  model_version: string | null;
  input_hash: string | null;
  warnings: string[];
  grid: GridSchema;
}

export interface ConcentrationCellRow {
  i: number;
  j: number;
  concentration: number;
  geometry: Record<string, unknown>;
}

export interface ConcentrationColumnRow {
  i: number;
  j: number;
  c_ug_m3: Array<number | null>;
}

export interface VerticalProfileRow {
  c_ug_m3: Array<number | null>;
  centre: Record<string, unknown>;
}

export interface LayerSummaryRow {
  k: number;
  air_cells: number;
  mean_ug_m3: number | null;
  max_ug_m3: number | null;
}

export interface ThresholdSchema {
  key: string;
  label: string;
  value_ug_m3: number;
}

export interface ArtifactSchema {
  kind: string;
  sha256: string;
  size_bytes: number;
  download_url: string;
}

export interface ArtifactFileSchema {
  path: string;
  size_bytes: number;
}
