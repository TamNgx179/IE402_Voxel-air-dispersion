import { readFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { sha256File } from '../../../common/hash.js';

/**
 * Gate between "the solver exited 0" and "the run succeeded" (spec D2,
 * BR-20, BR-39): manifest.json must match config/manifest.schema.json, belong
 * to this run, every listed artifact must sit inside the run directory with
 * the declared size and SHA-256, and verification.status must be "pass".
 */

// ajv-formats is CommonJS; under NodeNext its default export arrives wrapped.
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as (
  ajv: Ajv2020,
) => Ajv2020;

export const MANIFEST_FILE = 'manifest.json';

/** Artifact kinds a successful run must list (spec D2, run directory). */
export const REQUIRED_ARTIFACT_KINDS = [
  'config',
  'wind',
  'concentration',
  'columns',
  'metrics',
  'log',
] as const;

export interface ManifestArtifact {
  kind: string;
  path: string;
  sha256: string;
  size_bytes: number;
}

export interface ManifestCheck {
  status: 'pass' | 'fail';
  value: number;
  tolerance: number;
  detail?: string;
}

export interface RunManifest {
  schema_version: string;
  run_id: string;
  model: 'fv' | 'gaussian';
  model_version: string;
  input_hash: string;
  scenario: { id: string; wind_from_deg: number; wind_speed_m_s: number };
  grid: Record<string, unknown>;
  stopping: {
    criterion: 'fixed_time' | 'steady_state';
    simulated_s: number;
    steps: number;
    residual?: number | null;
  };
  artifacts: ManifestArtifact[];
  verification: {
    status: 'pass' | 'fail';
    checks: Record<string, ManifestCheck>;
  };
  warnings: string[];
  [key: string]: unknown;
}

export type VerifyResult =
  | {
      ok: true;
      manifest: RunManifest;
      /** Listed artifacts plus the manifest itself (kind "manifest"). */
      artifacts: ManifestArtifact[];
    }
  | {
      ok: false;
      kind: 'model' | 'system';
      message: string;
      manifest?: RunManifest;
    };

export function compileManifestSchema(schemaPath: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

export interface VerifyOptions {
  runDir: string;
  runId: string;
  model: string;
  scenarioId: string;
  validate: ValidateFunction;
  /** SHA-256 of the config.yaml the monolith wrote; must match the listed one. */
  configSha256?: string;
  /**
   * Skip the verification.status gate (used after exit 3 to read the checks
   * of a model failure for diagnosis). Integrity checks still apply.
   */
  allowVerificationFail?: boolean;
}

function systemError(message: string, manifest?: RunManifest): VerifyResult {
  return { ok: false, kind: 'system', message, manifest };
}

/** Reads and validates manifest.json only (schema + identity), no checksums. */
export async function readManifest(
  options: Pick<
    VerifyOptions,
    'runDir' | 'runId' | 'model' | 'scenarioId' | 'validate'
  >,
): Promise<
  | { ok: true; manifest: RunManifest; raw: Buffer }
  | { ok: false; message: string }
> {
  const path = join(options.runDir, MANIFEST_FILE);
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch {
    return {
      ok: false,
      message: `${MANIFEST_FILE} is missing from the run directory`,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    return {
      ok: false,
      message: `${MANIFEST_FILE} is not valid JSON (${err instanceof Error ? err.message : err})`,
    };
  }
  if (!options.validate(data)) {
    const errors = (options.validate.errors ?? [])
      .slice(0, 5)
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
      .join('; ');
    return {
      ok: false,
      message: `${MANIFEST_FILE} violates config/manifest.schema.json: ${errors}`,
    };
  }
  const manifest = data as RunManifest;
  if (manifest.run_id.toLowerCase() !== options.runId.toLowerCase()) {
    return {
      ok: false,
      message: `${MANIFEST_FILE} run_id ${manifest.run_id} does not match run ${options.runId}`,
    };
  }
  if (manifest.model !== options.model) {
    return {
      ok: false,
      message: `${MANIFEST_FILE} model "${manifest.model}" does not match the requested model "${options.model}"`,
    };
  }
  if (manifest.scenario.id !== options.scenarioId) {
    return {
      ok: false,
      message: `${MANIFEST_FILE} scenario "${manifest.scenario.id}" does not match run scenario "${options.scenarioId}"`,
    };
  }
  return { ok: true, manifest, raw };
}

export async function verifyRunOutput(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const read = await readManifest(options);
  if (!read.ok) return systemError(read.message);
  const { manifest } = read;

  if (
    manifest.stopping.criterion === 'steady_state' &&
    (!manifest.verification.checks.steady_state ||
      manifest.verification.checks.steady_state.status !== 'pass')
  ) {
    return {
      ok: false,
      kind: 'model',
      manifest,
      message:
        'steady-state run requires a passing steady_state verification check',
    };
  }

  const runDir = resolve(options.runDir);
  const seen = new Set<string>();
  const artifacts: ManifestArtifact[] = [];
  for (const a of manifest.artifacts) {
    if (seen.has(a.kind))
      return systemError(`artifact kind "${a.kind}" is listed twice`, manifest);
    seen.add(a.kind);

    // The schema already forbids separators; "." and ".." still match it.
    const target = resolve(runDir, a.path);
    if (a.path === '.' || a.path === '..' || dirname(target) !== runDir) {
      return systemError(
        `artifact path "${a.path}" escapes the run directory`,
        manifest,
      );
    }
    if (a.path === MANIFEST_FILE) {
      return systemError(
        `artifact "${a.kind}" cannot point at ${MANIFEST_FILE}`,
        manifest,
      );
    }
    let info;
    try {
      info = await lstat(target);
    } catch {
      return systemError(`artifact ${a.kind} (${a.path}) is missing`, manifest);
    }
    if (!info.isFile()) {
      return systemError(
        `artifact ${a.kind} (${a.path}) is not a regular file`,
        manifest,
      );
    }
    if (info.size !== a.size_bytes) {
      return systemError(
        `artifact ${a.kind} (${a.path}) size ${info.size} B does not match manifest ${a.size_bytes} B`,
        manifest,
      );
    }
    const sha = await sha256File(target);
    if (sha !== a.sha256) {
      return systemError(
        `artifact ${a.kind} (${a.path}) checksum mismatch: manifest ${a.sha256.slice(0, 12)}…, file ${sha.slice(0, 12)}…`,
        manifest,
      );
    }
    artifacts.push({ ...a });
  }

  const missing = REQUIRED_ARTIFACT_KINDS.filter((k) => !seen.has(k));
  if (missing.length > 0) {
    return systemError(
      `manifest does not list required artifact(s): ${missing.join(', ')}`,
      manifest,
    );
  }

  if (options.configSha256) {
    const config = artifacts.find((a) => a.kind === 'config');
    if (config && config.sha256 !== options.configSha256) {
      return systemError(
        'config.yaml in the run directory differs from the snapshot the monolith wrote',
        manifest,
      );
    }
  }

  const failing = Object.entries(manifest.verification.checks)
    .filter(([, c]) => c.status !== 'pass')
    .map(([name, c]) => `${name} (value ${c.value}, tolerance ${c.tolerance})`);
  if (!options.allowVerificationFail) {
    if (manifest.verification.status !== 'pass') {
      return {
        ok: false,
        kind: 'model',
        manifest,
        message: `verification failed: ${failing.length ? failing.join(', ') : 'status "fail"'}`,
      };
    }
    if (failing.length > 0) {
      return {
        ok: false,
        kind: 'model',
        manifest,
        message: `verification.status is "pass" but check(s) failed: ${failing.join(', ')}`,
      };
    }
  }

  artifacts.push({
    kind: 'manifest',
    path: MANIFEST_FILE,
    sha256: await sha256File(join(runDir, MANIFEST_FILE)),
    size_bytes: read.raw.length,
  });
  return { ok: true, manifest, artifacts };
}

export interface RunMetricsRow {
  dt_s: number | null;
  courant: number | null;
  steps: number | null;
  simulated_s: number | null;
  wall_clock_s: number | null;
  emitted_kg: number | null;
  remaining_kg: number | null;
  escaped_kg: number | null;
  correction_kg: number | null;
  stopping_criterion: string | null;
}

const METRIC_ALIASES: Record<keyof RunMetricsRow, string[]> = {
  dt_s: ['dt_s', 'dt'],
  courant: ['courant', 'courant_number', 'Courant', 'cfl'],
  steps: ['steps', 'n_steps'],
  simulated_s: ['simulated_s', 'simulated_time_s'],
  wall_clock_s: ['wall_clock_s', 'runtime_s', 'wall_s'],
  emitted_kg: ['emitted_kg'],
  remaining_kg: ['remaining_kg'],
  escaped_kg: ['escaped_kg', 'outflow_kg'],
  correction_kg: [
    'correction_kg',
    'positivity_correction_kg',
    'corrections_kg',
  ],
  stopping_criterion: ['stopping_criterion', 'criterion'],
};

/**
 * metrics.json → run_metrics row. Tolerant: keys may sit at the top level or
 * in a nested `mass`/`mass_ledger`/`ledger` object, and missing keys become
 * NULL; steps/simulated_s/criterion fall back to manifest.stopping.
 */
export function metricsRow(
  metrics: unknown,
  manifest: RunManifest,
): RunMetricsRow {
  const flat: Record<string, unknown> = {};
  if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
    const m = metrics as Record<string, unknown>;
    for (const nested of ['mass', 'mass_ledger', 'ledger']) {
      const v = m[nested];
      if (v && typeof v === 'object' && !Array.isArray(v))
        Object.assign(flat, v);
    }
    Object.assign(flat, m);
  }
  const pick = (key: keyof RunMetricsRow): unknown => {
    for (const alias of METRIC_ALIASES[key]) {
      if (flat[alias] !== undefined && flat[alias] !== null) return flat[alias];
    }
    return undefined;
  };
  const num = (key: keyof RunMetricsRow): number | null => {
    const v = pick(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const criterion = pick('stopping_criterion');
  const steps = num('steps');
  return {
    dt_s: num('dt_s'),
    courant: num('courant'),
    steps: steps !== null ? Math.round(steps) : manifest.stopping.steps,
    simulated_s: num('simulated_s') ?? manifest.stopping.simulated_s,
    wall_clock_s: num('wall_clock_s'),
    emitted_kg: num('emitted_kg'),
    remaining_kg: num('remaining_kg'),
    escaped_kg: num('escaped_kg'),
    correction_kg: num('correction_kg'),
    stopping_criterion:
      criterion === 'fixed_time' || criterion === 'steady_state'
        ? criterion
        : manifest.stopping.criterion,
  };
}
