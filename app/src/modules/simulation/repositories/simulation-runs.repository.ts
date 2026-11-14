import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import type { RunModel } from '../dto/create-run.dto.js';
import type { ListRunsQueryDto } from '../dto/list-runs-query.dto.js';
import type {
  ClaimedRun,
  RunAccepted,
  RunStatus,
  VerificationCheckView,
} from '../schemas/simulation-run.schema.js';

export interface RunDetailRow {
  id: string;
  status: RunStatus;
  progress: number;
  attempt: number;
  model: RunModel;
  emission_multiplier: number;
  error_kind: string | null;
  error_message: string | null;
  model_version: string | null;
  input_hash: string | null;
  warnings: string[] | null;
  created_at: unknown;
  started_at: unknown;
  finished_at: unknown;
  scenario_id: string;
  scenario_name: string;
  wind_from_deg: number;
  wind_speed_m_s: number;
  metrics: Record<string, unknown> | null;
}

/**
 * Advisory-lock key that serialises run claims across every executor sharing
 * the database (arbitrary constant; distinct from the migration lock 402_0001).
 */
export const CLAIM_LOCK_KEY = 402_0002;

export type RetryResult =
  | { kind: 'not_found' }
  | { kind: 'not_retryable'; status: RunStatus }
  | { kind: 'accepted'; run: RunAccepted };

/** All SQL used by the run lifecycle API. Business/HTTP rules stay in the service. */
@Injectable()
export class SimulationRunsRepository {
  constructor(private readonly db: DatabaseService) {}

  async scenarioExists(id: string): Promise<boolean> {
    const result = await this.db.query('SELECT 1 FROM scenarios WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  async create(
    id: string,
    scenarioId: string,
    model: RunModel,
    snapshot: Record<string, unknown>,
    multiplier: number,
  ): Promise<RunAccepted | null> {
    const { rows } = await this.db.query<{
      id: string;
      status: RunStatus;
      attempt: number;
    }>(
      `INSERT INTO simulation_runs (id, scenario_id, model, status, config_snapshot)
       VALUES ($1, $2, $3, 'queued', $4)
       ON CONFLICT (id) DO NOTHING
       RETURNING id, status, attempt`,
      [id, scenarioId, model, snapshot],
    );
    let [run] = rows;
    if (!run) {
      // A separate statement sees the winner of a concurrent INSERT.
      const existing = await this.db.query<typeof run>(
        `SELECT id, status, attempt FROM simulation_runs
         WHERE id = $1 AND scenario_id = $2 AND model = $3
           AND COALESCE((config_snapshot->'run'->>'emission_multiplier')::double precision, 1) = $4`,
        [id, scenarioId, model, multiplier],
      );
      [run] = existing.rows;
    }
    return run ? { run_id: run.id, status: run.status, attempt: run.attempt } : null;
  }

  async list(query: ListRunsQueryDto) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace('?', `$${values.length}`));
    };
    if (query.status) add('r.status = ?', query.status);
    if (query.model) add('r.model = ?', query.model);
    if (query.scenario_id) add('r.scenario_id = ?', query.scenario_id);
    values.push(query.limit ?? 20);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await this.db.query(
      `SELECT r.id AS run_id, r.status, r.progress, r.attempt, r.model,
              r.scenario_id, s.name AS scenario_name, s.wind_from_deg, s.wind_speed_m_s,
              r.model_version, r.warnings, r.created_at, r.finished_at,
              COALESCE((r.config_snapshot->'run'->>'emission_multiplier')::double precision,1) AS emission_multiplier
       FROM simulation_runs r
       JOIN scenarios s ON s.id = r.scenario_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return rows;
  }

  async findDetail(id: string): Promise<RunDetailRow | null> {
    const { rows } = await this.db.query<RunDetailRow>(
      `SELECT r.id, r.status, r.progress, r.attempt, r.model, r.error_kind, r.error_message,
              r.model_version, r.input_hash, r.warnings, r.created_at, r.started_at, r.finished_at,
              COALESCE((r.config_snapshot->'run'->>'emission_multiplier')::double precision,1) AS emission_multiplier,
              s.id AS scenario_id, s.name AS scenario_name,
              s.wind_from_deg, s.wind_speed_m_s,
              to_jsonb(m) - 'run_id' AS metrics
       FROM simulation_runs r
       JOIN scenarios s ON s.id = r.scenario_id
       LEFT JOIN run_metrics m ON m.run_id = r.id
       WHERE r.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async verificationChecks(id: string): Promise<VerificationCheckView[]> {
    const { rows } = await this.db.query<VerificationCheckView>(
      `SELECT check_name AS name, status, value, tolerance
       FROM verification_checks WHERE run_id = $1 ORDER BY check_name`,
      [id],
    );
    return rows;
  }

  async retry(id: string): Promise<RetryResult> {
    return this.db.transaction(async (client) => {
      const current = await client.query<{ status: RunStatus }>(
        'SELECT status FROM simulation_runs WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (current.rowCount === 0) return { kind: 'not_found' };
      const status = current.rows[0].status;
      if (status !== 'failed' && status !== 'stale') {
        return { kind: 'not_retryable', status };
      }
      for (const table of [
        'run_metrics',
        'verification_checks',
        'artifacts',
        'concentration_columns',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE run_id = $1`, [id]);
      }
      const { rows } = await client.query<{
        id: string;
        status: RunStatus;
        attempt: number;
      }>(
        `UPDATE simulation_runs
         SET status = 'queued', attempt = attempt + 1, progress = 0,
             error_kind = NULL, error_message = NULL,
             model_version = NULL, input_hash = NULL, warnings = '{}',
             started_at = NULL, finished_at = NULL
         WHERE id = $1
         RETURNING id, status, attempt`,
        [id],
      );
      return {
        kind: 'accepted',
        run: { run_id: rows[0].id, status: rows[0].status, attempt: rows[0].attempt },
      };
    });
  }

  async recoverInterrupted(): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE simulation_runs
       SET status = 'stale', finished_at = now(),
           error_message = 'interrupted: the monolith restarted while this run was running; retry it'
       WHERE status = 'running'
       RETURNING id`,
    );
    return rows.map((row) => row.id);
  }

  /**
   * Claims the oldest queued run if fewer than `maxRunning` runs are running.
   *
   * Every claimer (any dispatcher, any process sharing the database) first
   * takes one transaction-scoped advisory lock, so claims are serialised and
   * the slot count cannot be exceeded. `FOR UPDATE SKIP LOCKED` on its own
   * did not enforce the cap: two transactions could lock *different* queued
   * rows while both still saw zero committed `running` rows. The count runs
   * in a separate statement after the lock is granted, so under READ
   * COMMITTED it sees the previous holder's committed claim. The lock is
   * released at COMMIT; the solver runs outside this transaction.
   */
  async claimNext(maxRunning = 1): Promise<ClaimedRun | null> {
    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [CLAIM_LOCK_KEY]);
      const running = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM simulation_runs WHERE status = 'running'`,
      );
      if ((running.rows[0]?.n ?? 0) >= maxRunning) return null;
      const { rows } = await client.query<ClaimedRun>(
        `WITH next AS (
           SELECT id FROM simulation_runs
           WHERE status = 'queued'
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
    });
  }

  updateSnapshot(id: string, snapshot: Record<string, unknown>) {
    return this.db.query(
      'UPDATE simulation_runs SET config_snapshot = $2 WHERE id = $1',
      [id, snapshot],
    );
  }

  updateProgress(id: string, progress: number) {
    return this.db.query(
      `UPDATE simulation_runs SET progress = $2 WHERE id = $1 AND status = 'running'`,
      [id, progress],
    );
  }

  markStaleAfterShutdown(id: string) {
    return this.db.query(
      `UPDATE simulation_runs SET status = 'stale', finished_at = now(),
         error_message = 'interrupted: the monolith shut down during this run; retry it'
       WHERE id = $1 AND status = 'running'`,
      [id],
    );
  }
}
