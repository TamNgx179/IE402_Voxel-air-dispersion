import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRunSnapshot, loadProjectConfig } from '../../../common/project-config.js';
import type { AppConfig } from '../../../config/env.validation.js';
import type { CreateRunDto } from '../dto/create-run.dto.js';
import type { ListRunsQueryDto } from '../dto/list-runs-query.dto.js';
import { SimulationRunsRepository } from '../repositories/simulation-runs.repository.js';
import type { RunAccepted, RunView } from '../schemas/simulation-run.schema.js';

/** Application rules for create/list/read/retry. SQL belongs to the repository. */
@Injectable()
export class SimulationRunsService {
  constructor(
    private readonly runs: SimulationRunsRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(dto: CreateRunDto): Promise<RunAccepted> {
    if (!(await this.runs.scenarioExists(dto.scenario_id))) {
      throw new NotFoundException(`scenario "${dto.scenario_id}" does not exist`);
    }
    const model = dto.model ?? 'fv';
    const runId = randomUUID();
    const project = await loadProjectConfig(
      this.config.get('PROJECT_CONFIG_PATH', { infer: true }),
    );
    const snapshot = buildRunSnapshot(project.data, {
      run_id: runId,
      scenario_id: dto.scenario_id,
      model,
    });
    return this.runs.create(runId, dto.scenario_id, model, snapshot);
  }

  async list(query: ListRunsQueryDto) {
    const rows = await this.runs.list(query);
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
    const row = await this.runs.findDetail(id);
    if (!row) throw new NotFoundException(`run ${id} does not exist`);
    const checks = await this.runs.verificationChecks(id);
    return {
      run_id: row.id,
      status: row.status,
      progress: Number(row.progress),
      attempt: Number(row.attempt),
      model: row.model,
      scenario: {
        id: row.scenario_id,
        name: row.scenario_name,
        wind_from_deg: Number(row.wind_from_deg),
        wind_speed_m_s: Number(row.wind_speed_m_s),
      },
      error:
        row.error_kind || row.error_message
          ? { kind: row.error_kind, message: row.error_message }
          : null,
      model_version: row.model_version,
      input_hash: row.input_hash,
      warnings: row.warnings ?? [],
      created_at: iso(row.created_at)!,
      started_at: iso(row.started_at),
      finished_at: iso(row.finished_at),
      metrics: row.metrics ?? null,
      verification: checks.length
        ? {
            status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
            checks: checks.map((check) => ({
              ...check,
              value: check.value === null ? null : Number(check.value),
              tolerance: check.tolerance === null ? null : Number(check.tolerance),
            })),
          }
        : null,
    };
  }

  async retry(id: string): Promise<RunAccepted> {
    const result = await this.runs.retry(id);
    if (result.kind === 'not_found') {
      throw new NotFoundException(`run ${id} does not exist`);
    }
    if (result.kind === 'not_retryable') {
      throw new ConflictException(
        `run ${id} is ${result.status}; only failed or stale runs can be retried`,
      );
    }
    return result.run;
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
