import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service.js';
import type {
  ArtifactFileSchema,
  ArtifactSchema,
  ConcentrationCellRow,
  ConcentrationColumnRow,
  LayerSummaryRow,
  ResultRunContext,
  ThresholdSchema,
  VerticalProfileRow,
} from '../schemas/simulation-result.schema.js';

/** PostGIS/SQL access for simulation results. Response shaping stays in the service. */
@Injectable()
export class SimulationResultsRepository {
  constructor(private readonly db: DatabaseService) {}

  async concentrationSlice(
    runId: string,
    layer: number,
    bbox: [number, number, number, number] | undefined,
    scenarioId: string,
  ): Promise<ConcentrationCellRow[]> {
    const { rows } = await this.db.query<ConcentrationCellRow>(
      `SELECT c.i, c.j, c.c_ug_m3[$2] AS concentration,
              ST_AsGeoJSON(ST_Transform(g.geom, 4326), 7)::json AS geometry
       FROM concentration_columns c
       JOIN scenarios s ON s.id = $7
       JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
       WHERE c.run_id = $1
         AND c.c_ug_m3[$2] IS NOT NULL
         AND ($3::double precision IS NULL OR ST_Intersects(
           g.geom,
           ST_Transform(ST_MakeEnvelope($3, $4, $5, $6, 4326), 32648)
         ))
       ORDER BY c.j, c.i`,
      [runId, layer, ...(bbox ?? [null, null, null, null]), scenarioId],
    );
    return rows;
  }

  async exceedanceCells(
    runId: string,
    layer: number,
    threshold: number,
    scenarioId: string,
  ): Promise<ConcentrationCellRow[]> {
    const { rows } = await this.db.query<ConcentrationCellRow>(
      `SELECT c.i, c.j, c.c_ug_m3[$2] AS concentration,
              ST_AsGeoJSON(ST_Transform(g.geom, 4326), 7)::json AS geometry
       FROM concentration_columns c
       JOIN scenarios s ON s.id = $4
       JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
       WHERE c.run_id = $1 AND c.c_ug_m3[$2] > $3
       ORDER BY c.j, c.i`,
      [runId, layer, threshold, scenarioId],
    );
    return rows;
  }

  async verticalProfile(
    runId: string,
    i: number,
    j: number,
    scenarioId: string,
  ): Promise<VerticalProfileRow | null> {
    const { rows } = await this.db.query<VerticalProfileRow>(
      `SELECT c.c_ug_m3,
              ST_AsGeoJSON(ST_Transform(ST_Centroid(g.geom), 4326), 7)::json AS centre
       FROM concentration_columns c
       JOIN scenarios s ON s.id = $4
       JOIN grid_cells g ON g.study_area_id = s.study_area_id AND g.i = c.i AND g.j = c.j
       WHERE c.run_id = $1 AND c.i = $2 AND c.j = $3`,
      [runId, i, j, scenarioId],
    );
    return rows[0] ?? null;
  }

  async layerSummaries(runId: string): Promise<LayerSummaryRow[]> {
    const { rows } = await this.db.query<LayerSummaryRow>(
      `SELECT u.ordinality - 1 AS k,
              count(u.value)::int AS air_cells,
              avg(u.value)::double precision AS mean_ug_m3,
              max(u.value)::double precision AS max_ug_m3
       FROM concentration_columns c
       CROSS JOIN LATERAL unnest(c.c_ug_m3) WITH ORDINALITY AS u(value, ordinality)
       WHERE c.run_id = $1
       GROUP BY u.ordinality ORDER BY u.ordinality`,
      [runId],
    );
    return rows;
  }

  async thresholds(): Promise<ThresholdSchema[]> {
    const { rows } = await this.db.query<ThresholdSchema>(
      'SELECT key, value_ug_m3, label FROM thresholds ORDER BY value_ug_m3 DESC',
    );
    return rows;
  }

  async metrics(runId: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.db.query<{ value: Record<string, unknown> }>(
      "SELECT to_jsonb(m) - 'run_id' AS value FROM run_metrics m WHERE run_id = $1",
      [runId],
    );
    return rows[0]?.value ?? null;
  }

  async verificationChecks(runId: string) {
    const { rows } = await this.db.query<{
      name: string;
      status: string;
      value: number | null;
      tolerance: number | null;
    }>(
      'SELECT check_name AS name, status, value, tolerance FROM verification_checks WHERE run_id = $1 ORDER BY check_name',
      [runId],
    );
    return rows;
  }

  async exceedanceCount(runId: string, threshold: number): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM concentration_columns c
       CROSS JOIN LATERAL unnest(c.c_ug_m3) AS u(value)
       WHERE c.run_id = $1 AND u.value > $2`,
      [runId, threshold],
    );
    return Number(rows[0].n);
  }

  async columns(runId: string): Promise<ConcentrationColumnRow[]> {
    const { rows } = await this.db.query<ConcentrationColumnRow>(
      'SELECT i, j, c_ug_m3 FROM concentration_columns WHERE run_id = $1 ORDER BY j, i',
      [runId],
    );
    return rows;
  }

  async artifacts(runId: string): Promise<ArtifactSchema[]> {
    const { rows } = await this.db.query<ArtifactSchema>(
      `SELECT kind, sha256, size_bytes,
              '/api/runs/' || run_id || '/artifacts/' || kind || '/download' AS download_url
       FROM artifacts WHERE run_id = $1 ORDER BY kind`,
      [runId],
    );
    return rows;
  }

  async artifact(runId: string, kind: string): Promise<ArtifactFileSchema | null> {
    const { rows } = await this.db.query<ArtifactFileSchema>(
      'SELECT path, size_bytes FROM artifacts WHERE run_id = $1 AND kind = $2',
      [runId, kind],
    );
    return rows[0] ?? null;
  }

  async runContext(runId: string): Promise<ResultRunContext | null> {
    const { rows } = await this.db.query<ResultRunContext>(
      `SELECT r.id, r.status, r.model, r.model_version, r.input_hash, r.warnings,
              r.scenario_id, sa.grid
       FROM simulation_runs r
       JOIN scenarios s ON s.id = r.scenario_id
       JOIN study_areas sa ON sa.id = s.study_area_id
       WHERE r.id = $1`,
      [runId],
    );
    return rows[0] ?? null;
  }

  async threshold(key: string): Promise<ThresholdSchema | null> {
    const { rows } = await this.db.query<ThresholdSchema>(
      'SELECT key, label, value_ug_m3 FROM thresholds WHERE key = $1',
      [key],
    );
    return rows[0] ?? null;
  }
}
