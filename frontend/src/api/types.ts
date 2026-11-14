/**
 * REST response shapes used by the viewer (see app/src/modules/* services).
 * Field names and units are the server contract; never rename or translate them.
 */
import type { FeatureCollection } from './geojson';

export type { Feature, FeatureCollection, Geometry } from './geojson';

export interface GridSpec {
  origin_x_m: number;
  origin_y_m: number;
  dx_m: number;
  dy_m: number;
  dz_m: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface StudyArea {
  id: string;
  name: string;
  srid: number;
  grid: GridSpec;
  /** [west, south, east, north] WGS84. */
  bounds: [number, number, number, number];
  bounds_projected: [number, number, number, number];
  geometry: Record<string, unknown>;
  scene_version: string | null;
  provenance: Provenance;
}

export interface Provenance {
  buildings?: { footprint?: unknown; height?: unknown; [key: string]: unknown };
  [key: string]: unknown;
}

export interface Scenario {
  id: string;
  study_area_id: string;
  name: string;
  wind_from_deg: number;
  wind_speed_m_s: number;
  parameters: Record<string, unknown>;
}

export interface Threshold {
  key: string;
  value_ug_m3: number;
  label: string;
  config_hash?: string;
}

/** Item of `GET /api/runs?status=succeeded`. */
export interface RunListItem {
  run_id: string;
  scenario_id: string;
  scenario_name: string;
  emission_multiplier?: number | null;
  wind_from_deg: number;
  wind_speed_m_s: number;
  model: string;
  model_version: string | null;
  warnings?: string[] | null;
  status?: string;
}

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'stale';

/** `GET /api/runs/:id`. */
export interface RunView {
  run_id: string;
  emission_multiplier: number;
  status: RunStatus;
  progress: number;
  attempt: number;
  model: string;
  scenario: { id: string; name: string; wind_from_deg: number; wind_speed_m_s: number };
  error: { kind: string | null; message: string | null } | null;
  model_version: string | null;
  input_hash: string | null;
  warnings: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** `POST /api/runs`. */
export interface RunAccepted {
  run_id: string;
  status: RunStatus;
  attempt: number;
}

export interface BuildingProperties {
  source_feature_id: string;
  height_m: number;
  height_source?: string;
  [key: string]: unknown;
}

export interface RoadProperties {
  source_feature_id: string;
  emission_share: number;
  [key: string]: unknown;
}

export interface Scene {
  study_area_id: string;
  buildings: FeatureCollection<BuildingProperties>;
  roads: FeatureCollection<RoadProperties>;
  water: FeatureCollection;
  green: FeatureCollection;
}

export interface VolumeScale {
  c_max: number;
  decades: number;
  levels: number;
  first_code: number;
}

/** `GET /api/runs/:id/volume`: uint8 codes, [z, y, x] C order. */
export interface VolumePayload {
  run_id: string;
  shape: [number, number, number];
  axis_order: 'z,y,x';
  units: string;
  codes_base64: string;
  scale: VolumeScale;
}

export interface VerificationCheck {
  name: string;
  status: string;
  value: number | null;
  tolerance: number | null;
}

export interface LayerSummary {
  k: number;
  z_m: number;
  air_cells: number;
  mean_ug_m3: number | null;
  max_ug_m3: number | null;
}

export interface RunSummary {
  run_id: string;
  model: string;
  model_version: string | null;
  input_hash: string | null;
  emission_multiplier: number;
  warnings: string[];
  units: string;
  grid: GridSpec;
  layers: LayerSummary[];
  thresholds: Array<{ key: string; label: string; value_ug_m3: number; exceedance_volume_m3: number }>;
  metrics: Record<string, unknown> | null;
  verification: { status: 'pass' | 'fail'; checks: VerificationCheck[] } | null;
}

export interface ArtifactList {
  run_id: string;
  artifacts: Array<{ kind: string; sha256: string; size_bytes: number; download_url: string }>;
}

/** `wind_vectors` artifact. Each row: [i, j, k, ?, u, v, w] in m s-1. */
export interface WindField {
  run_id: string;
  units: string;
  stride: number;
  layers: Array<{ k: number; z_m: number; vectors: number[][] }>;
}

export interface ExceedanceResult {
  run_id: string;
  z_m: number;
  requested_z_m: number;
  z_center_m: number;
  k: number;
  units: string;
  threshold: { key: string; label: string; value_ug_m3: number };
  cell_count: number;
  area_m2: number;
  volume_m3: number;
}

export interface ProfileResult {
  run_id: string;
  i: number;
  j: number;
  centre: Record<string, unknown>;
  units: string;
  levels: Array<{ k: number; z_m: number; concentration_ug_m3: number | null }>;
}
