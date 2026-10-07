import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Validated, fully resolved application configuration.
 *
 * Every path is absolute. Relative values supplied through the environment
 * are resolved against the `app/` directory, so the app behaves the same no
 * matter which working directory it is started from.
 */
export interface AppConfig {
  PORT: number;
  REPO_ROOT: string;
  /** Single project YAML used to snapshot each queued run. */
  PROJECT_CONFIG_PATH: string;
  ARTIFACT_DIR: string;
  PYTHON_BIN: string;
  /** PostgreSQL/PostGIS connection; without it DB-backed routes answer 503. */
  DATABASE_URL?: string;
  /** `mock` adds `--mock` to the solver command (spec D2); `real` runs the solver. */
  SOLVER_MODE: SolverMode;
  /** Mock mode only: adds `--mock-fail <kind>` (spec D2) to demo failures. */
  SOLVER_MOCK_FAIL?: MockFailKind;
  /** Wall-clock limit of one solver process, seconds. */
  SOLVER_TIMEOUT_S: number;
  /**
   * Command prefix, default `[PYTHON_BIN, '-m', 'src.solver']`. Tests point it
   * at a fake solver. Comes from the environment only, never from a request
   * (BR-18).
   */
  SOLVER_CMD: string[];
  /** Internal executor (concurrency 1) on/off; off for API-only tests. */
  EXECUTOR_ENABLED: boolean;
  /** Executor DB polling interval, milliseconds. */
  EXECUTOR_POLL_MS: number;
}

export type SolverMode = 'mock' | 'real';
export type MockFailKind = 'input' | 'model' | 'system';

export interface ValidateOptions {
  /** Directory relative env paths are resolved against. Defaults to `app/`. */
  appRoot?: string;
  /** Override for tests; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
}

export class ConfigValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems
        .map((p) => `  - ${p}`)
        .join('\n')}\nSee app/.env.example for the supported variables.`,
    );
    this.name = 'ConfigValidationError';
  }
}

/** Walks up from `start` to the nearest directory containing package.json. */
export function findAppRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export const APP_ROOT = findAppRoot(dirname(fileURLToPath(import.meta.url)));

function readString(
  env: Record<string, unknown>,
  key: string,
): string | undefined {
  const raw = env[key];
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  return value === '' ? undefined : value;
}

function toAbsolute(base: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(base, value);
}

/**
 * Validates and normalises environment variables. Used as the
 * `validate` hook of `ConfigModule.forRoot`, so a bad value stops the app at
 * startup with a readable message instead of failing later at request time.
 */
export function validate(
  env: Record<string, unknown>,
  options: ValidateOptions = {},
): AppConfig {
  const appRoot = options.appRoot ?? APP_ROOT;
  const platform = options.platform ?? process.platform;
  const problems: string[] = [];

  // PORT
  let port = 3000;
  const rawPort = readString(env, 'PORT');
  if (rawPort !== undefined) {
    const n = Number(rawPort);
    if (!/^\d+$/.test(rawPort) || !Number.isInteger(n) || n < 1 || n > 65535) {
      problems.push(
        `PORT must be an integer between 1 and 65535 (got "${rawPort}")`,
      );
    } else {
      port = n;
    }
  }

  // REPO_ROOT
  const repoRoot = toAbsolute(appRoot, readString(env, 'REPO_ROOT') ?? '..');
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    problems.push(
      `REPO_ROOT must be an existing directory (got "${repoRoot}")`,
    );
  }

  const rawProjectConfigPath = readString(env, 'PROJECT_CONFIG_PATH');
  const projectConfigPath = toAbsolute(
    appRoot,
    rawProjectConfigPath ??
      resolve(repoRoot, 'config', 'project.yaml'),
  );
  if (
    rawProjectConfigPath !== undefined &&
    (!existsSync(projectConfigPath) || !statSync(projectConfigPath).isFile())
  ) {
    problems.push(
      `PROJECT_CONFIG_PATH must be an existing file (got "${projectConfigPath}")`,
    );
  }

  // ARTIFACT_DIR: need not exist yet; /api/health reports exists/writable.
  const rawArtifactDir = readString(env, 'ARTIFACT_DIR');
  const artifactDir =
    rawArtifactDir === undefined
      ? resolve(repoRoot, 'artifacts')
      : toAbsolute(appRoot, rawArtifactDir);

  // PYTHON_BIN: existence is checked by /api/health, not at startup, so the
  // web viewer still runs on machines without the Python venv.
  const rawPython = readString(env, 'PYTHON_BIN');
  const pythonBin =
    rawPython === undefined
      ? platform === 'win32'
        ? resolve(repoRoot, '.venv', 'Scripts', 'python.exe')
        : resolve(repoRoot, '.venv', 'bin', 'python')
      : /[\\/]/.test(rawPython)
        ? toAbsolute(appRoot, rawPython)
        : rawPython; // bare command name such as "python3", looked up on PATH

  // DATABASE_URL (optional)
  const databaseUrl = readString(env, 'DATABASE_URL');
  if (
    databaseUrl !== undefined &&
    !/^postgres(ql)?:\/\/.+/i.test(databaseUrl)
  ) {
    problems.push(
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    );
  }

  // SOLVER_MODE
  let solverMode: SolverMode = 'mock';
  const rawMode = readString(env, 'SOLVER_MODE');
  if (rawMode !== undefined) {
    if (rawMode === 'mock' || rawMode === 'real') solverMode = rawMode;
    else
      problems.push(`SOLVER_MODE must be "mock" or "real" (got "${rawMode}")`);
  }

  // SOLVER_MOCK_FAIL
  let mockFail: MockFailKind | undefined;
  const rawMockFail = readString(env, 'SOLVER_MOCK_FAIL');
  if (rawMockFail !== undefined) {
    if (!['input', 'model', 'system'].includes(rawMockFail)) {
      problems.push(
        `SOLVER_MOCK_FAIL must be "input", "model" or "system" (got "${rawMockFail}")`,
      );
    } else if (solverMode !== 'mock') {
      problems.push('SOLVER_MOCK_FAIL is only allowed with SOLVER_MODE=mock');
    } else {
      mockFail = rawMockFail as MockFailKind;
    }
  }

  // SOLVER_TIMEOUT_S
  let timeoutS = 900;
  const rawTimeout = readString(env, 'SOLVER_TIMEOUT_S');
  if (rawTimeout !== undefined) {
    const n = Number(rawTimeout);
    if (!Number.isFinite(n) || n <= 0) {
      problems.push(
        `SOLVER_TIMEOUT_S must be a positive number of seconds (got "${rawTimeout}")`,
      );
    } else {
      timeoutS = n;
    }
  }

  // SOLVER_CMD: JSON array of non-empty strings.
  let solverCmd = [pythonBin, '-m', 'src.solver'];
  const rawCmd = readString(env, 'SOLVER_CMD');
  if (rawCmd !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawCmd);
    } catch {
      parsed = undefined;
    }
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((p) => typeof p === 'string' && p.trim() !== '')
    ) {
      solverCmd = parsed as string[];
    } else {
      problems.push(
        'SOLVER_CMD must be a JSON array of non-empty strings, e.g. ["python","-m","src.solver"]',
      );
    }
  }

  // EXECUTOR_ENABLED
  let executorEnabled = true;
  const rawEnabled = readString(env, 'EXECUTOR_ENABLED');
  if (rawEnabled !== undefined) {
    const v = rawEnabled.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) executorEnabled = true;
    else if (['false', '0', 'no', 'off'].includes(v)) executorEnabled = false;
    else
      problems.push(
        `EXECUTOR_ENABLED must be true or false (got "${rawEnabled}")`,
      );
  }

  // EXECUTOR_POLL_MS
  let pollMs = 1000;
  const rawPoll = readString(env, 'EXECUTOR_POLL_MS');
  if (rawPoll !== undefined) {
    const n = Number(rawPoll);
    if (!/^\d+$/.test(rawPoll) || n < 10) {
      problems.push(
        `EXECUTOR_POLL_MS must be an integer >= 10 (got "${rawPoll}")`,
      );
    } else {
      pollMs = n;
    }
  }

  if (problems.length > 0) throw new ConfigValidationError(problems);

  return {
    PORT: port,
    REPO_ROOT: repoRoot,
    PROJECT_CONFIG_PATH: projectConfigPath,
    ARTIFACT_DIR: artifactDir,
    PYTHON_BIN: pythonBin,
    ...(databaseUrl !== undefined ? { DATABASE_URL: databaseUrl } : {}),
    SOLVER_MODE: solverMode,
    ...(mockFail !== undefined ? { SOLVER_MOCK_FAIL: mockFail } : {}),
    SOLVER_TIMEOUT_S: timeoutS,
    SOLVER_CMD: solverCmd,
    EXECUTOR_ENABLED: executorEnabled,
    EXECUTOR_POLL_MS: pollMs,
  };
}
