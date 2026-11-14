/**
 * Run evidence view model and scene data quality (port of web/viewer-evidence.js).
 * Evidence is read from the exact API summary, never from the render uint8 codes.
 *
 * Labels are i18n keys (namespace `evidence`) so the same model renders in either
 * language; values are pre-formatted numbers in the requested locale.
 */
import type { TranslationKey } from '../i18n/dictionaries';
import { LOCALE_TAGS, type Locale } from '../i18n/types';
import type { FeatureCollection, Provenance, RunSummary } from '../api/types';

/** Formatted evidence number, or `null` when missing (missing is distinct from zero). */
export function number(value: unknown, unit = '', locale: Locale = 'vi'): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const text =
    value !== 0 && Math.abs(value) < 0.001
      ? value.toExponential(3)
      : value.toLocaleString(LOCALE_TAGS[locale], { maximumSignificantDigits: 5 });
  return unit ? `${text} ${unit}` : text;
}

export type EvidenceState = 'empty' | 'error' | 'pass' | 'unverified';

/** Label key + value (`null` value means "not available"). */
export type EvidenceRow = [TranslationKey, string | null];

export interface EvidenceCheck {
  name: string;
  /** i18n key for known checks; `null` falls back to the raw `name`. */
  nameKey: TranslationKey | null;
  pass: boolean;
  value: string | null;
  tolerance: string | null;
}

export interface EvidenceModel {
  state: EvidenceState;
  message: { key: TranslationKey; params?: Record<string, number> };
  /** Raw model code (e.g. "fv"), used for the heading. */
  model?: string | null;
  identity?: EvidenceRow[];
  metrics?: EvidenceRow[];
  checks?: EvidenceCheck[];
  warnings?: string[];
  summaryUrl?: string;
  artifactsUrl?: string;
}

const CHECK_KEYS: Record<string, TranslationKey> = {
  cfl: 'evidence.check.cfl',
  face_divergence: 'evidence.check.face_divergence',
  positivity: 'evidence.check.positivity',
  wall_flux: 'evidence.check.wall_flux',
  mass_balance: 'evidence.check.mass_balance',
  sor_convergence: 'evidence.check.sor_convergence',
  steady_state: 'evidence.check.steady_state',
};

type Metrics = {
  wall_clock_s?: unknown;
  simulated_s?: unknown;
  steps?: unknown;
  dt_s?: unknown;
  stopping_criterion?: unknown;
  convergence_history?: unknown;
  emitted_kg?: unknown;
  remaining_kg?: unknown;
  escaped_kg?: unknown;
  correction_kg?: unknown;
};

export function viewModel(
  summary: Pick<RunSummary, 'run_id'> & Partial<RunSummary> | null | undefined,
  runId: string | null | undefined,
  locale: Locale = 'vi',
): EvidenceModel {
  if (!summary) return { state: 'empty', message: { key: 'evidence.empty' } };
  if (summary.run_id !== runId) return { state: 'error', message: { key: 'evidence.mismatch' } };
  const metrics = (summary.metrics || {}) as Metrics;
  const checks = summary.verification?.checks || [];
  const passed = checks.filter((check) => check.status === 'pass').length;
  const verified = summary.verification?.status === 'pass' && checks.length > 0 && passed === checks.length;
  const warnings = Array.isArray(summary.warnings) ? summary.warnings.filter((item) => typeof item === 'string') : [];
  const history = Array.isArray(metrics.convergence_history)
    ? (metrics.convergence_history as Array<{ relative_l1_change?: unknown }>)
    : [];
  const last = history[history.length - 1];
  const mass = [metrics.emitted_kg, metrics.remaining_kg, metrics.escaped_kg];
  const massError = mass.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? (metrics.emitted_kg as number) - (metrics.remaining_kg as number) - (metrics.escaped_kg as number)
    : null;
  const n = (value: unknown, unit = '') => number(value, unit, locale);
  return {
    state: verified ? 'pass' : 'unverified',
    message: verified
      ? { key: 'evidence.passed', params: { passed, total: checks.length } }
      : { key: 'evidence.notVerified' },
    model: summary.model ?? null,
    identity: [
      ['evidence.identity.run', runId],
      ['evidence.identity.model', summary.model || null],
      ['evidence.identity.version', summary.model_version || null],
      ['evidence.identity.inputHash', summary.input_hash || null],
      ['evidence.identity.units', summary.units || null],
    ],
    metrics: [
      ['evidence.metric.wallClock', n(metrics.wall_clock_s, 's')],
      ['evidence.metric.simulated', n(metrics.simulated_s, 's')],
      ['evidence.metric.steps', n(metrics.steps)],
      ['evidence.metric.dt', n(metrics.dt_s, 's')],
      // Raw criterion code; the renderer translates `steady_state` (evidence.stoppingSteady).
      ['evidence.metric.stopping', typeof metrics.stopping_criterion === 'string' ? metrics.stopping_criterion : null],
      [
        'evidence.metric.residual',
        n(last?.relative_l1_change ?? checks.find((check) => check.name === 'steady_state')?.value),
      ],
      ['evidence.metric.emitted', n(metrics.emitted_kg, 'kg')],
      ['evidence.metric.remaining', n(metrics.remaining_kg, 'kg')],
      ['evidence.metric.escaped', n(metrics.escaped_kg, 'kg')],
      ['evidence.metric.massError', n(massError, 'kg')],
      ['evidence.metric.correction', n(metrics.correction_kg, 'kg')],
    ],
    checks: checks.map((check) => ({
      name: check.name,
      nameKey: CHECK_KEYS[check.name] ?? null,
      pass: check.status === 'pass',
      value: n(check.value),
      tolerance: n(check.tolerance),
    })),
    warnings,
    summaryUrl: `/api/runs/${encodeURIComponent(runId ?? '')}/summary`,
    artifactsUrl: `/api/runs/${encodeURIComponent(runId ?? '')}/artifacts`,
  };
}

export type QualityKey = 'gob' | 'tagged' | 'levels' | 'fallback' | 'unknown';

export interface DataQuality {
  state: 'missing' | 'ready' | 'empty';
  total: number | null;
  counts?: Record<QualityKey, number>;
  groups: Array<{ key: QualityKey; labelKey: TranslationKey; count: number }>;
  footprint_source?: string | null;
  height_source?: string | null;
  geometry?: 'LoD1';
  terrain?: 'flat';
  materials?: 'illustrative';
}

/** Count actual scene attributes; never infer measurement quality from a height alone. */
export function dataQuality(
  buildings: Pick<FeatureCollection, 'features'> | null | undefined | { features?: unknown },
  provenance: Provenance = {},
): DataQuality {
  const features = (buildings as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(features)) return { state: 'missing', total: null, groups: [] };
  const counts: Record<QualityKey, number> = { gob: 0, tagged: 0, levels: 0, fallback: 0, unknown: 0 };
  for (const feature of features as Array<{ properties?: Record<string, unknown> } | null>) {
    const p = feature?.properties || {},
      source = String(p.height_source || '');
    const valid = typeof p.height_m === 'number' && Number.isFinite(p.height_m) && p.height_m > 0;
    const key: QualityKey = !valid
      ? 'unknown'
      : /^gob:/.test(source)
        ? 'gob'
        : /^(direct:)/.test(source) || source === 'osm:height'
          ? 'tagged'
          : /^levels:/.test(source) || source === 'osm:building:levels'
            ? 'levels'
            : /^(fallback|median|fixed)(:|$)/.test(source) || source === 'derived:median'
              ? 'fallback'
              : 'unknown';
    counts[key]++;
  }
  return {
    state: features.length ? 'ready' : 'empty',
    total: features.length,
    counts: { ...counts },
    groups: (Object.entries(counts) as Array<[QualityKey, number]>)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, labelKey: `evidence.quality.group.${key}` as TranslationKey, count })),
    footprint_source: typeof provenance.buildings?.footprint === 'string' ? provenance.buildings.footprint : null,
    height_source: typeof provenance.buildings?.height === 'string' ? provenance.buildings.height : null,
    geometry: 'LoD1',
    terrain: 'flat',
    materials: 'illustrative',
  };
}

/** Warnings other than the standing "not field validated" caveat. */
export function hasDataWarning(warnings: readonly string[] | undefined): boolean {
  return Boolean(
    warnings?.some(
      (warning) => !/not.?validated|not field validation|not validated against field observations/i.test(warning),
    ),
  );
}
