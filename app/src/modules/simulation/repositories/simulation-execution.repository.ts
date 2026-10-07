import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import type pg from 'pg';
import { DatabaseService } from '../../../database/database.service.js';
import {
  type ManifestArtifact,
  metricsRow,
  type RunManifest,
} from '../infrastructure/manifest-verifier.js';
import { importConcentrationColumns } from '../infrastructure/result-importer.js';
import type { ErrorKind } from '../infrastructure/solver-protocol.js';

/** Atomic persistence boundary for executor completion/failure. */
@Injectable()
export class SimulationExecutionRepository {
  constructor(private readonly db: DatabaseService) {}

  get configured(): boolean {
    return this.db.configured;
  }

  async persistSuccess(input: {
    runId: string;
    runDir: string;
    metrics: unknown;
    manifest: RunManifest;
    artifacts: ManifestArtifact[];
  }): Promise<void> {
    const { runId, runDir, metrics, manifest, artifacts } = input;
    const metric = metricsRow(metrics, manifest);
    await this.db.transaction(async (client) => {
      await clearResults(client, runId);
      await client.query(
        `INSERT INTO run_metrics (run_id, dt_s, courant, steps, simulated_s, wall_clock_s,
           emitted_kg, remaining_kg, escaped_kg, correction_kg, stopping_criterion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          runId,
          metric.dt_s,
          metric.courant,
          metric.steps,
          metric.simulated_s,
          metric.wall_clock_s,
          metric.emitted_kg,
          metric.remaining_kg,
          metric.escaped_kg,
          metric.correction_kg,
          metric.stopping_criterion,
        ],
      );
      await insertChecks(client, runId, manifest);
      await insertArtifacts(client, runId, artifacts);
      const columns = artifacts.find((artifact) => artifact.kind === 'columns');
      if (!columns) throw new Error('verified manifest has no columns artifact');
      await importConcentrationColumns(client, runId, join(runDir, columns.path));
      const done = await client.query(
        `UPDATE simulation_runs
         SET status = 'succeeded', progress = 1, model_version = $2, input_hash = $3,
             warnings = $4, finished_at = now(), error_kind = NULL, error_message = NULL
         WHERE id = $1 AND status = 'running'`,
        [runId, manifest.model_version, manifest.input_hash, manifest.warnings],
      );
      if (done.rowCount !== 1) throw new Error('run is no longer running');
    });
  }

  async persistFailure(
    runId: string,
    kind: ErrorKind,
    message: string,
    manifest?: RunManifest,
  ): Promise<void> {
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
  for (const table of [
    'concentration_columns',
    'run_metrics',
    'verification_checks',
    'artifacts',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE run_id = $1`, [runId]);
  }
}

async function insertChecks(
  client: pg.PoolClient,
  runId: string,
  manifest: RunManifest,
) {
  for (const [name, check] of Object.entries(manifest.verification.checks)) {
    await client.query(
      `INSERT INTO verification_checks (run_id, check_name, status, value, tolerance)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, name, check.status, check.value, check.tolerance],
    );
  }
}

async function insertArtifacts(
  client: pg.PoolClient,
  runId: string,
  artifacts: ManifestArtifact[],
) {
  for (const artifact of artifacts) {
    await client.query(
      `INSERT INTO artifacts (run_id, kind, path, sha256, size_bytes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        runId,
        artifact.kind,
        `${runId}/${artifact.path}`,
        artifact.sha256,
        artifact.size_bytes,
      ],
    );
  }
}
