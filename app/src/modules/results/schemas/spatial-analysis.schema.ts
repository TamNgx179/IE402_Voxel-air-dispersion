export interface PolygonSchema {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface ComparisonCellRow {
  i: number;
  j: number;
  baseline: number;
  comparison: number;
  delta: number;
  geometry: Record<string, unknown>;
}

export interface RegionLayerRow {
  k: number;
  air_voxels: number;
  air_volume_m3: number;
  mean_ug_m3: number | null;
  max_ug_m3: number | null;
  exceedance_volume_m3: number;
}
