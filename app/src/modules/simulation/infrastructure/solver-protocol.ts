/**
 * Pure helpers for the monolith ↔ Python solver contract (docs/spec.md D2).
 * No I/O here, so every rule is unit-tested directly.
 */

export type ErrorKind = 'input' | 'model' | 'system' | 'timeout';

export interface ProgressEvent {
  stage: string;
  fraction: number;
}

/**
 * One stdout line → progress event, or null for anything else (non-JSON
 * output, other events, out-of-range fractions are ignored, never fatal).
 */
export function parseProgressLine(line: string): ProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object') return null;
  const { event, stage, fraction } = obj as Record<string, unknown>;
  if (event !== 'progress') return null;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return null;
  if (fraction < 0 || fraction > 1) return null;
  return { stage: typeof stage === 'string' ? stage : '', fraction };
}

/**
 * The solver reports a fraction per stage (`setup`, `wind`, `transport`,
 * `export`). Each stage owns a slice of the overall 0–1 bar; transport is
 * the long one. Unknown stages leave the bar where it is.
 */
export const STAGE_RANGES: Record<string, readonly [number, number]> = {
  setup: [0, 0.05],
  wind: [0.05, 0.4],
  transport: [0.4, 0.9],
  export: [0.9, 1],
};

/** Overall progress after `event`, never moving backwards. */
export function overallProgress(
  previous: number,
  event: ProgressEvent,
): number {
  const range = STAGE_RANGES[event.stage];
  if (!range) return previous;
  const value = range[0] + (range[1] - range[0]) * event.fraction;
  return Math.min(1, Math.max(previous, Math.round(value * 1000) / 1000));
}

export interface ExitInfo {
  /** Exit code, or null when killed by a signal / never started. */
  code: number | null;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  /** Set when the process could not be started at all (ENOENT, EACCES…). */
  spawnError?: Error;
}

/** Exit status → failure kind; `null` means "exit 0, go verify the manifest". */
export function classifyExit(exit: ExitInfo): ErrorKind | null {
  if (exit.timedOut) return 'timeout';
  if (exit.spawnError) return 'system';
  switch (exit.code) {
    case 0:
      return null;
    case 2:
      return 'input';
    case 3:
      return 'model';
    default:
      return 'system'; // 4, any other code, or killed by a signal
  }
}

export function describeExit(exit: ExitInfo, timeoutS: number): string {
  if (exit.timedOut)
    return `solver killed after the ${timeoutS} s timeout (SOLVER_TIMEOUT_S)`;
  if (exit.spawnError)
    return `solver could not be started: ${exit.spawnError.message}`;
  if (exit.code === null)
    return `solver terminated by signal ${exit.signal ?? 'unknown'}`;
  return `solver exited with code ${exit.code}`;
}

export interface SolverInvocation {
  command: string;
  args: string[];
}

/**
 * Whitelisted argument array (BR-18). Every value comes from config or from
 * a DB row the monolith created (UUID, paths it built), never from a request.
 */
export function buildSolverInvocation(options: {
  solverCmd: string[];
  runId: string;
  configPath: string;
  outDir: string;
  mode: 'mock' | 'real';
  mockFail?: 'input' | 'model' | 'system';
}): SolverInvocation {
  const [command, ...prefix] = options.solverCmd;
  const args = [
    ...prefix,
    'run',
    '--run-id',
    options.runId,
    '--config',
    options.configPath,
    '--out',
    options.outDir,
  ];
  if (options.mode === 'mock') {
    args.push('--mock');
    if (options.mockFail) args.push('--mock-fail', options.mockFail);
  }
  return { command, args };
}

/** Keeps only the last `max` characters written to it (stderr tail). */
export class TailBuffer {
  private text = '';
  constructor(private readonly max = 4096) {}

  push(chunk: string): void {
    this.text += chunk;
    if (this.text.length > this.max * 2) this.text = this.text.slice(-this.max);
  }

  toString(): string {
    return this.text.length > this.max ? this.text.slice(-this.max) : this.text;
  }
}
