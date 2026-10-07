import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildRunSnapshot,
  loadProjectConfig,
  projectConfigPath,
} from '../../common/project-config.js';
import type { AppConfig } from '../../config/env.validation.js';
import { DatabaseService } from '../../database/database.service.js';
import type { CreateRunDto, RunModel } from './dto/create-run.dto.js';
import type { ListRunsQueryDto } from './dto/list-runs-query.dto.js';

export interface RunAccepted {
  run_id: string;
  status: string;
  attempt: number;
}

export interface RunView {
  run_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'stale';
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
  /** From the manifest; a mock run always says so here (BR-30). */
  warnings: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  metrics: Record<string, unknown> | null;
  verification: {
    status: 'pass' | 'fail';
    checks: {
      name: string;
      status: string;
      value: number | null;
      tolerance: number | null;
    }[];
  } | null;
}

const RETRYABLE = ['failed', 'stale'];

/** Run lifecycle from the API side: create, read, retry (BR-16, BR-17, BR-19). */
@Injectable()
export class RunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(dto: CreateRunDto): Promise<RunAccepted> {
    const model = dto.model ?? 'fv';
    const scenario = await this.db.query(
      'SELECT id FROM scenarios WHERE id = $1',
      [dto.scenario_id],
    );
    if (scenario.rowCount === 0) {
      throw new NotFoundException(
        `scenario "${dto.scenario_id}" does not exist`,
      );
    }

    // Parameter snapshot taken at request time (BR-16): a retry re-runs the
    // exact same configuration even if config/project.yaml changed since.
    const runId = randomUUID();
    const project = await loadProjectConfig(
      projectConfigPath(this.config.get('REPO_ROOT', { infer: true })),
    );
    const snapshot = buildRunSnapshot(project.data, {
      run_id: runId,
      scenario_id: dto.scenario_id,
      model,
    });

    const { rows } = await this.db.query<{
      id: string;
      status: string;
      attempt: number;
    }>(
      `INSERT INTO simulation_runs (id, scenario_id, model, status, config_snapshot)
       VALUES ($1, $2, $3, 'queued', $4)
       RETURNING id, status, attempt`,
      [runId, dto.scenario_id, model, snapshot],
    );
    return {
      run_id: rows[0].id,
      status: rows[0].status,
      attempt: rows[0].attempt,
    };
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
              r.model_version, r.warnings, r.created_at, r.finished_at
       FROM simulation_runs r
       JOIN scenarios s ON s.id = r.scenario_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${values.length}`,
      values,
    );
    return rows.map((row) => ({
      ...row,
      progress: Number(row.progress),
      attempt: Number(row.attempt),
      wind_from_deg: Number(row.wind_from_deg),
      wind_speed_m_s: Number(row.wind_speed_m_s),
      created_at: iso(row.created_at),
      finished_at: iso(row.finished_at),
    }));
  }

  async get(id: string): Promise<RunView> {
    const { rows } = await this.db.query(
      `SELECT r.id, r.status, r.progress, r.attempt, r.model, r.error_kind, r.error_message,
              r.model_version, r.input_hash, r.warnings, r.created_at, r.started_at, r.finished_at,
              s.id AS scenario_id, s.name AS scenario_name,
              s.wind_from_deg, s.wind_speed_m_s,
              to_jsonb(m) - 'run_id' AS metrics
       FROM simulation_runs r
       JOIN scenarios s ON s.id = r.scenario_id
       LEFT JOIN run_metrics m ON m.run_id = r.id
       WHERE r.id = $1`,
      [id],
    );
    if (rows.length === 0)
      throw new NotFoundException(`run ${id} does not exist`);
    const r = rows[0];

    const checks = await this.db.query(
      `SELECT check_name AS name, status, value, tolerance
       FROM verification_checks WHERE run_id = $1 ORDER BY check_name`,
      [id],
    );

    return {
      run_id: r.id,
      status: r.status,
      progress: Number(r.progress),
      attempt: Number(r.attempt),
      model: r.model,
      scenario: {
        id: r.scenario_id,
        name: r.scenario_name,
        wind_from_deg: Number(r.wind_from_deg),
        wind_speed_m_s: Number(r.wind_speed_m_s),
      },
      error:
        r.error_kind || r.error_message
          ? { kind: r.error_kind, message: r.error_message }
          : null,
      model_version: r.model_version,
      input_hash: r.input_hash,
      warnings: r.warnings ?? [],
      created_at: iso(r.created_at)!,
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
      metrics: r.metrics ?? null,
      verification:
        checks.rowCount && checks.rowCount > 0
          ? {
              status: checks.rows.every((c) => c.status === 'pass')
                ? 'pass'
                : 'fail',
              checks: checks.rows.map((c) => ({
                name: c.name,
                status: c.status,
                value: c.value === null ? null : Number(c.value),
                tolerance: c.tolerance === null ? null : Number(c.tolerance),
              })),
            }
          : null,
    };
  }

  /** failed/stale → queued with attempt + 1; anything else is 409. */
  async retry(id: string): Promise<RunAccepted> {
    return this.db.transaction(async (client) => {
      const current = await client.query<{ status: string }>(
        'SELECT status FROM simulation_runs WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (current.rowCount === 0)
        throw new NotFoundException(`run ${id} does not exist`);
      const status = current.rows[0].status;
      if (!RETRYABLE.includes(status)) {
        throw new ConflictException(
          `run ${id} is ${status}; only failed or stale runs can be retried`,
        );
      }
      // Leftovers of the previous attempt must not mix with the new one (BR-19).
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
        status: string;
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
        run_id: rows[0].id,
        status: rows[0].status,
        attempt: rows[0].attempt,
      };
    });
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
