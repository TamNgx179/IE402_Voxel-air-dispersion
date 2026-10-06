import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { sha256Hex } from './hash.js';

/**
 * config/project.yaml is the single source of scenarios and thresholds
 * (BR-40). Everything here only reads it.
 */
export function projectConfigPath(repoRoot: string): string {
  return join(repoRoot, 'config', 'project.yaml');
}

export function manifestSchemaPath(repoRoot: string): string {
  return join(repoRoot, 'config', 'manifest.schema.json');
}

export interface ProjectConfig {
  /** Parsed YAML document (plain JSON-compatible data). */
  data: Record<string, unknown>;
  /** Lower-case hex SHA-256 of the YAML file bytes. */
  sha256: string;
}

export async function loadProjectConfig(path: string): Promise<ProjectConfig> {
  const raw = await readFile(path);
  const data: unknown = parse(raw.toString('utf8'));
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${path}: expected a YAML mapping at the top level`);
  }
  return { data: data as Record<string, unknown>, sha256: sha256Hex(raw) };
}

export interface ScenarioSeed {
  id: string;
  name: string;
  wind_from_deg: number;
  wind_speed_m_s: number;
  parameters: Record<string, unknown>;
}

export interface ThresholdSeed {
  key: string;
  value_ug_m3: number;
  label: string;
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`config/project.yaml: ${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`config/project.yaml: ${where} must be a number`);
  }
  return value;
}

/** `meteorology.scenarios` → rows of the `scenarios` table. */
export function scenariosFromConfig(
  config: Record<string, unknown>,
): ScenarioSeed[] {
  const meteo = asRecord(config.meteorology, 'meteorology');
  const scenarios = asRecord(meteo.scenarios, 'meteorology.scenarios');
  return Object.entries(scenarios).map(([id, raw]) => {
    const s = asRecord(raw, `meteorology.scenarios.${id}`);
    const where = `meteorology.scenarios.${id}`;
    return {
      id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name : id,
      wind_from_deg: asNumber(
        s.direction_from_deg,
        `${where}.direction_from_deg`,
      ),
      wind_speed_m_s: asNumber(s.speed_m_s, `${where}.speed_m_s`),
      parameters: {
        ...s,
        direction_convention: meteo.direction_convention ?? null,
        source: meteo.source ?? null,
        analysis_period: meteo.analysis_period ?? null,
      },
    };
  });
}

/** `analysis.thresholds_ug_m3` → rows of the `thresholds` table. */
export function thresholdsFromConfig(
  config: Record<string, unknown>,
): ThresholdSeed[] {
  const analysis = asRecord(config.analysis, 'analysis');
  const thresholds = asRecord(
    analysis.thresholds_ug_m3,
    'analysis.thresholds_ug_m3',
  );
  return Object.entries(thresholds).map(([key, raw]) => {
    const t = asRecord(raw, `analysis.thresholds_ug_m3.${key}`);
    const value = asNumber(t.value, `analysis.thresholds_ug_m3.${key}.value`);
    if (value <= 0) {
      throw new Error(
        `config/project.yaml: analysis.thresholds_ug_m3.${key}.value must be > 0`,
      );
    }
    return {
      key,
      value_ug_m3: value,
      label: typeof t.label === 'string' ? t.label : key,
    };
  });
}

/**
 * Config snapshot for one run: the whole project config plus a `run:` block.
 * Stored in simulation_runs.config_snapshot and written as
 * artifacts/<run_id>/config.yaml (spec D2).
 */
export function buildRunSnapshot(
  config: Record<string, unknown>,
  run: { run_id: string; scenario_id: string; model: string },
): Record<string, unknown> {
  return { ...config, run: { ...run } };
}
