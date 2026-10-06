import { join } from 'node:path';
import type pg from 'pg';
import {
  loadProjectConfig,
  scenariosFromConfig,
  thresholdsFromConfig,
} from '../common/project-config.js';
import { loadScenePackage, type ScenePackage } from './scene-package.js';

/** SRID fixed in the geometry column types of 0001_init.sql. */
export const SCHEMA_SRID = 32648;

export function defaultSceneDir(repoRoot: string): string {
  return join(repoRoot, 'db', 'seeds', 'scene');
}

export interface SeedOptions {
  sceneDir: string;
  configPath: string;
  log?: (msg: string) => void;
}

export interface SeedSummary {
  study_area_id: string;
  study_area: string;
  buildings: number;
  roads: number;
  water: number;
  green: number;
  grid_cells: number;
  scenarios: string[];
  thresholds: string[];
  config_hash: string;
}

/**
 * Loads the scene package and config/project.yaml into the database in one
 * transaction. Idempotent: the study area is matched by name and its features
 * are replaced; scenarios and thresholds are upserted by key, so re-running
 * never creates duplicates. Runs that reference a scenario are kept.
 */
export async function seed(
  pool: pg.Pool,
  options: SeedOptions,
): Promise<SeedSummary> {
  const log = options.log ?? (() => undefined);
  const scene = await loadScenePackage(options.sceneDir);
  log(
    `scene package OK (${scene.buildings.length} buildings, ${scene.roads.length} roads, ` +
      `${scene.water.length} water, ${scene.green.length} green, ${scene.gridCells.length} grid cells)`,
  );
  const srid = scene.manifest.study_area.srid;
  if (srid !== SCHEMA_SRID) {
    throw new Error(
      `scene package SRID ${srid} does not match the schema SRID ${SCHEMA_SRID} (DATABASE.md §2)`,
    );
  }
  const config = await loadProjectConfig(options.configPath);
  const scenarios = scenariosFromConfig(config.data);
  const thresholds = thresholdsFromConfig(config.data);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const studyAreaId = await upsertStudyArea(client, scene);
    await replaceFeatures(client, studyAreaId, scene);

    for (const s of scenarios) {
      await client.query(
        `INSERT INTO scenarios (id, study_area_id, name, wind_from_deg, wind_speed_m_s, parameters)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           study_area_id = EXCLUDED.study_area_id, name = EXCLUDED.name,
           wind_from_deg = EXCLUDED.wind_from_deg, wind_speed_m_s = EXCLUDED.wind_speed_m_s,
           parameters = EXCLUDED.parameters`,
        [
          s.id,
          studyAreaId,
          s.name,
          s.wind_from_deg,
          s.wind_speed_m_s,
          s.parameters,
        ],
      );
    }
    // Scenarios removed from the config disappear unless a run references them.
    await client.query(
      `DELETE FROM scenarios s
       WHERE NOT (s.id = ANY($1::text[]))
         AND NOT EXISTS (SELECT 1 FROM simulation_runs r WHERE r.scenario_id = s.id)`,
      [scenarios.map((s) => s.id)],
    );

    for (const t of thresholds) {
      await client.query(
        `INSERT INTO thresholds (key, value_ug_m3, label, config_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET
           value_ug_m3 = EXCLUDED.value_ug_m3, label = EXCLUDED.label,
           config_hash = EXCLUDED.config_hash`,
        [t.key, t.value_ug_m3, t.label, config.sha256],
      );
    }
    await client.query(
      'DELETE FROM thresholds WHERE NOT (key = ANY($1::text[]))',
      [thresholds.map((t) => t.key)],
    );

    await client.query('COMMIT');
    log(
      `seeded study area "${scene.manifest.study_area.name}" (${studyAreaId})`,
    );
    return {
      study_area_id: studyAreaId,
      study_area: scene.manifest.study_area.name,
      buildings: scene.buildings.length,
      roads: scene.roads.length,
      water: scene.water.length,
      green: scene.green.length,
      grid_cells: scene.gridCells.length,
      scenarios: scenarios.map((s) => s.id),
      thresholds: thresholds.map((t) => t.key),
      config_hash: config.sha256,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function upsertStudyArea(
  client: pg.PoolClient,
  scene: ScenePackage,
): Promise<string> {
  const m = scene.manifest;
  const sceneVersion = `${m.schema_version}+${scene.manifestSha256.slice(0, 12)}`;
  const provenance = {
    ...(typeof m.provenance === 'object' && m.provenance !== null
      ? m.provenance
      : { value: m.provenance }),
    scene_manifest_sha256: scene.manifestSha256,
    generated_at: m.generated_at ?? null,
    counts: m.counts,
    files: m.files,
  };
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO study_areas (name, geom, projected_srid, grid, scene_version, provenance)
     VALUES ($1, ST_GeomFromText($2, $3), $3, $4, $5, $6)
     ON CONFLICT (name) DO UPDATE SET
       geom = EXCLUDED.geom, projected_srid = EXCLUDED.projected_srid, grid = EXCLUDED.grid,
       scene_version = EXCLUDED.scene_version, provenance = EXCLUDED.provenance
     RETURNING id`,
    [
      m.study_area.name,
      m.study_area.wkt,
      m.study_area.srid,
      m.grid,
      sceneVersion,
      provenance,
    ],
  );
  return rows[0].id;
}

async function replaceFeatures(
  client: pg.PoolClient,
  id: string,
  scene: ScenePackage,
) {
  const srid = scene.manifest.study_area.srid;
  for (const table of [
    'building_footprints',
    'road_segments',
    'water_features',
    'green_features',
    'grid_cells',
  ]) {
    await client.query(`DELETE FROM ${table} WHERE study_area_id = $1`, [id]);
  }

  const b = scene.buildings;
  await client.query(
    `INSERT INTO building_footprints (study_area_id, source_feature_id, geom, height_m, height_source)
     SELECT $1, u.fid, ST_Multi(ST_GeomFromText(u.wkt, $2)), u.h, u.src
     FROM unnest($3::text[], $4::text[], $5::real[], $6::text[]) AS u(fid, wkt, h, src)`,
    [
      id,
      srid,
      b.map((r) => r.source_feature_id),
      b.map((r) => r.wkt),
      b.map((r) => r.height_m),
      b.map((r) => r.height_source),
    ],
  );
  const r = scene.roads;
  await client.query(
    `INSERT INTO road_segments (study_area_id, source_feature_id, geom, road_class, emission_weight)
     SELECT $1, u.fid, ST_GeomFromText(u.wkt, $2), u.cls, u.w
     FROM unnest($3::text[], $4::text[], $5::text[], $6::real[]) AS u(fid, wkt, cls, w)`,
    [
      id,
      srid,
      r.map((x) => x.source_feature_id),
      r.map((x) => x.wkt),
      r.map((x) => x.road_class),
      r.map((x) => x.emission_weight),
    ],
  );
  for (const [table, rows] of [
    ['water_features', scene.water],
    ['green_features', scene.green],
  ] as const) {
    await client.query(
      `INSERT INTO ${table} (study_area_id, source_feature_id, geom, kind)
       SELECT $1, u.fid, ST_GeomFromText(u.wkt, $2), u.kind
       FROM unnest($3::text[], $4::text[], $5::text[]) AS u(fid, wkt, kind)`,
      [
        id,
        srid,
        rows.map((x) => x.source_feature_id),
        rows.map((x) => x.wkt),
        rows.map((x) => x.kind),
      ],
    );
  }
  const g = scene.gridCells;
  await client.query(
    `INSERT INTO grid_cells (study_area_id, i, j, geom, solid_from_k, solid_to_k)
     SELECT $1, u.i, u.j, ST_GeomFromText(u.wkt, $2), u.f, u.t
     FROM unnest($3::smallint[], $4::smallint[], $5::text[], $6::smallint[], $7::smallint[])
       AS u(i, j, wkt, f, t)`,
    [
      id,
      srid,
      g.map((c) => c.i),
      g.map((c) => c.j),
      g.map((c) => c.wkt),
      g.map((c) => c.solid_from_k),
      g.map((c) => c.solid_to_k),
    ],
  );
}
