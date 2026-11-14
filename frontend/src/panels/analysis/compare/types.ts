/** GET /runs/:id/comparison response (exact per-cell values at one layer). */
import type { ComparisonCellProperties } from '../../../lib/export';

export type ComparisonView = 'off' | 'baseline' | 'comparison' | 'delta';
export const COMPARISON_VIEWS: readonly ComparisonView[] = ['off', 'baseline', 'comparison', 'delta'];

export interface ComparisonFeature {
  type?: 'Feature';
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  properties: ComparisonCellProperties & { i: number; j: number };
}

export interface MeanStat {
  mean_ug_m3: number | null;
}

export interface ComparisonPayload {
  baseline_run_id: string;
  comparison_run_id: string;
  baseline_version?: string | null;
  comparison_version?: string | null;
  baseline_input_hash?: string | null;
  comparison_input_hash?: string | null;
  baseline_emission_multiplier?: number | null;
  comparison_emission_multiplier?: number | null;
  requested_z_m?: number;
  z_center_m: number;
  units?: string;
  feature_collection: { type?: 'FeatureCollection'; features: ComparisonFeature[] };
  stats: {
    air_cells: number;
    baseline: MeanStat;
    comparison: MeanStat;
    delta: MeanStat & { min_ug_m3: number | null; max_ug_m3: number | null };
  };
}
