import type { DatabaseStatus } from '../../../database/database.service.js';

export interface ArtifactDirectoryHealth {
  path: string;
  exists: boolean;
  writable: boolean;
}

export type PythonRuntimeHealth =
  | { bin: string; ok: true; version: string }
  | { bin: string; ok: false; error: string };

export interface HealthReportSchema {
  status: 'ok' | 'degraded';
  app: { version: string };
  artifactDir: ArtifactDirectoryHealth;
  python: PythonRuntimeHealth;
  database: DatabaseStatus;
}
