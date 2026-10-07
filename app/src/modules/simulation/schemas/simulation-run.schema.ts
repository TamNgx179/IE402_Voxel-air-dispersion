import type { RunModel } from '../dto/create-run.dto.js';

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'stale',
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RunAccepted {
  run_id: string;
  status: RunStatus;
  attempt: number;
}

export interface VerificationCheckView {
  name: string;
  status: string;
  value: number | null;
  tolerance: number | null;
}

export interface RunView {
  run_id: string;
  status: RunStatus;
  progress: number;
  attempt: number;
  model: RunModel;
  scenario: {
    id: string;
    name: string;
    wind_from_deg: number;
    wind_speed_m_s: number;
  };
  error: { kind: string | null; message: string | null } | null;
  model_version: string | null;
  input_hash: string | null;
  warnings: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  metrics: Record<string, unknown> | null;
  verification: {
    status: 'pass' | 'fail';
    checks: VerificationCheckView[];
  } | null;
}

export interface ClaimedRun {
  id: string;
  scenario_id: string;
  model: string;
  attempt: number;
  config_snapshot: Record<string, unknown> | null;
}
