export interface StudyAreaSchema {
  id: string;
  name: string;
  srid: number;
  grid: Record<string, number>;
  bounds: [number, number, number, number];
  bounds_projected: [number, number, number, number];
  geometry: Record<string, unknown>;
  scene_version: string | null;
  provenance: Record<string, unknown>;
}

export interface SceneFeatureRow {
  source_feature_id: string;
  geometry: Record<string, unknown>;
  [key: string]: unknown;
}
