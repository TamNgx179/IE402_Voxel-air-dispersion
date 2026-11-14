import type { GridSpec, ProfileResult, RunSummary, Scenario, Scene, StudyArea, WindField } from '../api/types';
import type { TranslationKey } from '../i18n/dictionaries';
import type { TranslationParams } from '../i18n/types';
import type { DecodedVolume } from '../lib/concentration';
import type { DataQuality } from '../lib/evidence';
import type { Cell, Corners } from '../lib/grid';

/** Study-area grid plus precomputed cell-centre heights. */
export interface Grid extends GridSpec {
  z_centres_m: number[];
}

/** A selectable completed run (legacy `M.scenarios` entry). */
export interface RunEntry {
  id: string;
  scenario_id: string;
  name: string;
  emission_multiplier: number;
  wind_from_deg: number;
  wind_speed_m_s: number;
  model: string;
  model_version: string | null;
  warnings: string[];
}

export interface ThresholdDef {
  value: number;
  label: string;
}

/** Everything loaded once at start-up. Immutable afterwards. */
export interface BootstrapData {
  area: StudyArea;
  grid: Grid;
  corners: Corners;
  /** Scenarios that can be run (POST /api/runs). */
  scenarios: Scenario[];
  thresholds: Record<string, ThresholdDef>;
  scene: Scene;
  provenance: StudyArea['provenance'];
  quality: DataQuality;
}

/** Loaded data of one run. Immutable; cached for the page lifetime. */
export interface RunData {
  id: string;
  volume: DecodedVolume;
  summary: RunSummary;
  windField: WindField | null;
}

export type MapMode = 'pan' | 'cell';
export type Basemap = 'vector' | 'raster';

export interface LayerToggles {
  buildings: boolean;
  facades: boolean;
  roads: boolean;
  wind: boolean;
  grid: boolean;
}

export interface Display {
  /** Illustrative source factor (1 = original data). */
  multiplier: number;
  /** Illustrative background concentration µg/m³ (0 = original data). */
  background: number;
}

export type StatusKind = 'info' | 'pass' | 'error';

/** The bottom status box. `message` is an i18n key so it re-renders on language change. */
export interface StatusState {
  message: { key: TranslationKey; params?: TranslationParams } | null;
  kind: StatusKind;
  /** Optional retry action shown as a button. */
  retry?: () => void;
  /** Error behind the message; its i18n text is passed as the `{message}` param. */
  error?: unknown;
}

export interface ExactQueries {
  /** `${runId}:${k}` → exceedance area m² per threshold key. */
  areas: Record<string, Record<string, number>>;
  /** `${runId}:${i}:${j}` → vertical profile. */
  profiles: Record<string, ProfileResult>;
  status: 'idle' | 'loading' | 'error';
  error: unknown;
}

export interface ViewerState {
  bootstrap: { status: 'loading' | 'ready' | 'error'; data: BootstrapData | null; error: unknown };
  /** Completed runs offered in the result select (newest added first). */
  runs: RunEntry[];
  selectedRunId: string | null;
  /** Run id whose data is being fetched for selection (aria-busy on the select). */
  pendingRunId: string | null;
  runData: Record<string, RunData>;
  /** Height layer index k (0..nz-1). */
  layer: number;
  display: Display;
  thresholdsEnabled: Record<string, boolean>;
  selectedCell: Cell | null;
  /** Building clicked on the map (map-options shows its height). */
  selectedBuildingId: string | null;
  mapMode: MapMode;
  /** Id of the open tool panel from src/panels/index.ts, or null. */
  activePanel: string | null;
  layers: LayerToggles;
  windPaused: boolean;
  basemap: Basemap;
  queries: ExactQueries;
  status: StatusState;
}
