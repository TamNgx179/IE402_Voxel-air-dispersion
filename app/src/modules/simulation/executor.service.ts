import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import type pg from 'pg';
import { stringify } from 'yaml';
import { sha256Hex } from '../../common/hash.js';
import {
  buildRunSnapshot,
  loadProjectConfig,
  manifestSchemaPath,
  projectConfigPath,
} from '../../common/project-config.js';
import type { AppConfig } from '../../config/env.validation.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  compileManifestSchema,
  type ManifestArtifact,
  metricsRow,
  readManifest,
  type RunManifest,
  verifyRunOutput,
} from './manifest-verifier.js';
import {
  buildSolverInvocation,
  classifyExit,
  describeExit,
  type ErrorKind,
  type ExitInfo,
  overallProgress,
  parseProgressLine,
  TailBuffer,
} from './solver-protocol.js';

interface ClaimedRun {
  id: string;
  scenario_id: string;
  model: string;
  attempt: number;
  config_snapshot: Record<string, unknown> | null;
}

const STDERR_TAIL_CHARS = 4096;
const KILL_GRACE_MS = 5_000;
const SHUTDOWN_WAIT_MS = 15_000;

/**
 * Internal executor (BR-18, BR-19, BR-21): no broker, concurrency 1. Polls the
 * DB, claims the oldest queued run with FOR UPDATE SKIP LOCKED, writes the
 * config snapshot, spawns the solver with an argument array (no shell), turns
 * stdout progress lines into `progress`, and on exit applies the D2 exit-code
 * table and the manifest/checksum gate before marking the run succeeded.
 */
@Injectable()
export class SimulationExecutor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger('SimulationExecutor');
  private validate?: ValidateFunction;
  private timer?: NodeJS.Timeout;
  private loop?: Promise<void>;
  private stopping = false;
  private recovered = false;
  private child?: ChildProcess;
  private killedForShutdown = false;
  private lastPollError?: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private cfg<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config.get(key, { infer: true }) as AppConfig[K];
  }

  onApplicationBootstrap(): void {
    if (!this.cfg('EXECUTOR_ENABLED')) {
      this.logger.log('executor disabled (EXECUTOR_ENABLED=false)');
      return;
    }
    if (!this.db.configured) {
      this.logger.warn('executor idle: DATABASE_URL is not set');
      return;
    }
    try {
      this.validate = compileManifestSchema(
        manifestSchemaPath(this.cfg('REPO_ROOT')),
      );
    } catch (err) {
      this.logger.error(
        `executor disabled: cannot load config/manifest.schema.json (${errorMessage(err)})`,
      );
      return;
    }
    this.logger.log(
      `executor started (mode ${this.cfg('SOLVER_MODE')}, timeout ${this.cfg('SOLVER_TIMEOUT_S')} s, ` +
        `poll ${this.cfg('EXECUTOR_POLL_MS')} ms, command ${JSON.stringify(this.cfg('SOLVER_CMD'))})`,
    );
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.child && this.child.exitCode === null) {
      this.killedForShutdown = true;
      this.child.kill();
    }
    if (this.loop) {
      await Promise.race([
        this.loop,
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_WAIT_MS).unref()),
      ]);
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.loop = this.tick().finally(() =>
        this.schedule(this.cfg('EXECUTOR_POLL_MS')),
      );
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      if (!this.recovered) {
        await this.recoverInterrupted();
        this.recovered = true;
      }
      while (!this.stopping) {
        const run = await this.claim();
        if (!run) break;
        await this.execute(run);
      }
      this.lastPollError = undefined;
    } catch (err) {
      const msg = errorMessage(err);
      if (msg !== this.lastPollError)
        this.logger.warn(`executor poll failed: ${msg}`);
      this.lastPollError = msg;
    }
  }

  /** BR-21: a run left `running` by a previous process can never finish. */
  private async recoverInterrupted(): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE simulation_runs
       SET status = 'stale', finished_at = now(),
           error_message = 'interrupted: the monolith restarted while this run was running; retry it'
       WHERE status = 'running'
       RETURNING id`,
    );
    for (const r of rows)
      this.logger.warn(`run ${r.id} was running at startup → stale`);
  }

  /** Oldest queued run → running, only when nothing else runs (concurrency 1). */
  private async claim(): Promise<ClaimedRun | null> {
    const { rows } = await this.db.query<ClaimedRun>(
      `WITH next AS (
         SELECT id FROM simulation_runs
         WHERE status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM simulation_runs WHERE status = 'running')
         ORDER BY created_at, id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE simulation_runs r
       SET status = 'running', started_at = now(), finished_at = NULL, progress = 0,
           error_kind = NULL, error_message = NULL
       FROM next WHERE r.id = next.id
       RETURNING r.id, r.scenario_id, r.model, r.attempt, r.config_snapshot`,
    );
    return rows[0] ?? null;
  }

  private async execute(run: ClaimedRun): Promise<void> {
    const runDir = join(this.cfg('ARTIFACT_DIR'), run.id);
    const configPath = join(runDir, 'config.yaml');
    this.logger.log(
      `run ${run.id} (attempt ${run.attempt}, ${run.scenario_id}/${run.model}) → running`,
    );

    let configSha: string;
    try {
      let snapshot = run.config_snapshot;
      if (!snapshot) {
        const project = await loadProjectConfig(
          projectConfigPath(this.cfg('REPO_ROOT')),
        );
        snapshot = buildRunSnapshot(project.data, {
          run_id: run.id,
          scenario_id: run.scenario_id,
          model: run.model,
        });
        await this.db.query(
          'UPDATE simulation_runs SET config_snapshot = $2 WHERE id = $1',
          [run.id, snapshot],
        );
      }
      // A fresh directory per attempt: files of a failed attempt never verify.
      await rm(runDir, { recursive: true, force: true });
      await mkdir(runDir, { recursive: true });
      // jsonb does not keep key order; put the run block first for readers.
      const { run: block, ...rest } = snapshot as Record<string, any>;
      const runBlock = {
        run_id: block?.run_id,
        scenario_id: block?.scenario_id,
        model: block?.model,
      };
      const yamlText = stringify({ run: runBlock, ...rest }, { lineWidth: 0 });
      await writeFile(configPath, yamlText, 'utf8');
      configSha = sha256Hex(Buffer.from(yamlText, 'utf8'));
    } catch (err) {
      await this.fail(
        run.id,
        'system',
        `cannot prepare ${runDir}: ${errorMessage(err)}`,
      );
      return;
    }

    const exit = await this.spawnSolver(run, configPath, runDir);
    if (this.killedForShutdown) {
      await this.db.query(
        `UPDATE simulation_runs SET status = 'stale', finished_at = now(),
           error_message = 'interrupted: the monolith shut down during this run; retry it'
         WHERE id = $1 AND status = 'running'`,
        [run.id],
      );
      return;
    }

    const kind = classifyExit(exit.info);
    if (kind === null) {
      await this.finishSuccess(run, runDir, configSha);
      return;
    }
    const detail = (
      exit.stderr.trim() || (await logTail(join(runDir, 'solver.log')))
    ).replace(/\r\n/g, '\n');
    const message = `${describeExit(exit.info, this.cfg('SOLVER_TIMEOUT_S'))}${detail ? `\n${detail}` : ''}`;
    let checks: RunManifest | undefined;
    if (kind === 'model' && this.validate) {
      // Exit 3 still writes a manifest; keep its checks to show which gate failed.
      const read = await readManifest({
        runDir,
        runId: run.id,
        model: run.model,
        scenarioId: run.scenario_id,
        validate: this.validate,
      }).catch(() => undefined);
      if (read?.ok) checks = read.manifest;
    }
    await this.fail(run.id, kind, message, checks);
  }

  private spawnSolver(
    run: ClaimedRun,
    configPath: string,
    runDir: string,
  ): Promise<{ info: ExitInfo; stderr: string }> {
    const { command, args } = buildSolverInvocation({
      solverCmd: this.cfg('SOLVER_CMD'),
      runId: run.id,
      configPath,
      outDir: runDir,
      mode: this.cfg('SOLVER_MODE'),
      mockFail: this.cfg('SOLVER_MOCK_FAIL'),
    });
    const timeoutS = this.cfg('SOLVER_TIMEOUT_S');
    const stderr = new TailBuffer(STDERR_TAIL_CHARS);

    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn(command, args, {
          cwd: this.cfg('REPO_ROOT'),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        });
      } catch (err) {
        resolve({ info: { code: null, spawnError: asError(err) }, stderr: '' });
        return;
      }
      this.child = child;

      let progress = 0;
      let written = 0;
      let updates: Promise<unknown> = Promise.resolve();
      const lines = createInterface({
        input: child.stdout!,
        crlfDelay: Infinity,
      });
      lines.on('line', (line) => {
        const event = parseProgressLine(line);
        if (!event) return;
        progress = overallProgress(progress, event);
        if (progress - written >= 0.01 || (progress === 1 && written < 1)) {
          written = progress;
          const value = progress;
          updates = updates.then(() =>
            this.db
              .query(
                `UPDATE simulation_runs SET progress = $2 WHERE id = $1 AND status = 'running'`,
                [run.id, value],
              )
              .catch((err) =>
                this.logger.warn(
                  `progress update failed: ${errorMessage(err)}`,
                ),
              ),
          );
        }
      });
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (chunk: string) => stderr.push(chunk));

      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        this.logger.warn(
          `run ${run.id}: timeout after ${timeoutS} s, killing solver`,
        );
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      }, timeoutS * 1000);

      let settled = false;
      const finish = (info: ExitInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        this.child = undefined;
        void updates.then(() =>
          resolve({ info: { ...info, timedOut }, stderr: stderr.toString() }),
        );
      };
      child.on('error', (err) => {
        // Only a failure to start ends the run here; otherwise 'close' follows.
        if (child.pid === undefined) finish({ code: null, spawnError: err });
      });
      child.on('close', (code, signal) => finish({ code, signal }));
    });
  }

  private async finishSuccess(
    run: ClaimedRun,
    runDir: string,
    configSha: string,
  ) {
    const result = await verifyRunOutput({
      runDir,
      runId: run.id,
      model: run.model,
      scenarioId: run.scenario_id,
      validate: this.validate!,
      configSha256: configSha,
    });
    if (!result.ok) {
      await this.fail(
        run.id,
        result.kind,
        `solver exited 0 but the run was rejected: ${result.message}`,
        result.manifest,
      );
      return;
    }
    const { manifest, artifacts } = result;

    let metrics: unknown = {};
    const metricsArtifact = artifacts.find((a) => a.kind === 'metrics');
    if (metricsArtifact) {
      try {
        metrics = JSON.parse(
          await readFile(join(runDir, metricsArtifact.path), 'utf8'),
        );
      } catch (err) {
        this.logger.warn(
          `run ${run.id}: metrics.json unreadable (${errorMessage(err)}); using manifest only`,
        );
      }
    }
    const m = metricsRow(metrics, manifest);

    try {
      await this.db.transaction(async (client) => {
        await clearResults(client, run.id);
        await client.query(
          `INSERT INTO run_metrics (run_id, dt_s, courant, steps, simulated_s, wall_clock_s,
             emitted_kg, remaining_kg, escaped_kg, correction_kg, stopping_criterion)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            run.id,
            m.dt_s,
            m.courant,
            m.steps,
            m.simulated_s,
            m.wall_clock_s,
            m.emitted_kg,
            m.remaining_kg,
            m.escaped_kg,
            m.correction_kg,
            m.stopping_criterion,
          ],
        );
        await insertChecks(client, run.id, manifest);
        await insertArtifacts(client, run.id, artifacts);
        const done = await client.query(
          `UPDATE simulation_runs
           SET status = 'succeeded', progress = 1, model_version = $2, input_hash = $3,
               warnings = $4, finished_at = now(), error_kind = NULL, error_message = NULL
           WHERE id = $1 AND status = 'running'`,
          [
            run.id,
            manifest.model_version,
            manifest.input_hash,
            manifest.warnings,
          ],
        );
        if (done.rowCount !== 1) throw new Error('run is no longer running');
      });
      const warn = manifest.warnings.length
        ? ` (warnings: ${manifest.warnings.join('; ')})`
        : '';
      this.logger.log(`run ${run.id} → succeeded${warn}`);
    } catch (err) {
      await this.fail(
        run.id,
        'system',
        `could not persist results: ${errorMessage(err)}`,
      );
    }
  }

  private async fail(
    runId: string,
    kind: ErrorKind,
    message: string,
    manifest?: RunManifest,
  ): Promise<void> {
    this.logger.warn(
      `run ${runId} → failed/${kind}: ${message.split('\n')[0]}`,
    );
    await this.db.transaction(async (client) => {
      await clearResults(client, runId);
      if (manifest) await insertChecks(client, runId, manifest);
      await client.query(
        `UPDATE simulation_runs
         SET status = 'failed', error_kind = $2, error_message = $3, finished_at = now()
         WHERE id = $1 AND status = 'running'`,
        [runId, kind, message.slice(0, 8192)],
      );
    });
  }
}

async function clearResults(client: pg.PoolClient, runId: string) {
  for (const table of ['run_metrics', 'verification_checks', 'artifacts']) {
    await client.query(`DELETE FROM ${table} WHERE run_id = $1`, [runId]);
  }
}

async function insertChecks(
  client: pg.PoolClient,
  runId: string,
  manifest: RunManifest,
) {
  for (const [name, c] of Object.entries(manifest.verification.checks)) {
    await client.query(
      `INSERT INTO verification_checks (run_id, check_name, status, value, tolerance)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, name, c.status, c.value, c.tolerance],
    );
  }
}

async function insertArtifacts(
  client: pg.PoolClient,
  runId: string,
  artifacts: ManifestArtifact[],
) {
  for (const a of artifacts) {
    await client.query(
      `INSERT INTO artifacts (run_id, kind, path, sha256, size_bytes) VALUES ($1, $2, $3, $4, $5)`,
      // Stored relative to ARTIFACT_DIR so the tree can move.
      [runId, a.kind, `${runId}/${a.path}`, a.sha256, a.size_bytes],
    );
  }
}

async function logTail(path: string): Promise<string> {
  try {
    const text = await readFile(path, 'utf8');
    return text.slice(-STDERR_TAIL_CHARS).trim();
  } catch {
    return '';
  }
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
