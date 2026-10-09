/** Import an offline production run through the same verifier/persistence as executor. */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { parse } from 'yaml';
import { APP_ROOT, validate } from '../config/env.validation.js';
import { DatabaseService } from './database.service.js';
import { sha256Hex } from '../common/hash.js';
import {
  compileManifestSchema,
  verifyRunOutput,
} from '../modules/simulation/infrastructure/manifest-verifier.js';
import { SimulationExecutionRepository } from '../modules/simulation/repositories/simulation-execution.repository.js';

const envFile = join(APP_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const cfg = validate(process.env);
const source = resolve(process.argv[2] ?? '');
if (!process.argv[2])
  throw new Error('usage: db:import-run <verified run directory>');
const rawConfig = await readFile(join(source, 'config.yaml'));
const snapshot = parse(rawConfig.toString('utf8'));
const rawManifest = JSON.parse(
  await readFile(join(source, 'manifest.json'), 'utf8'),
);
// Sensitivity runs use modified geometry and must never be attached to the
// baseline city's database grid. Keep them as offline report artifacts.
const scene = resolve(cfg.REPO_ROOT, snapshot.paths.scene_package_dir);
const baseline = join(cfg.REPO_ROOT, 'db', 'seeds', 'scene');
if (
  sha256Hex(await readFile(join(scene, 'scene_manifest.json'))) !==
  sha256Hex(await readFile(join(baseline, 'scene_manifest.json')))
)
  throw new Error(
    'run scene differs from seeded baseline; do not import sensitivity geometry',
  );
const output = await verifyRunOutput({
  runDir: source,
  runId: rawManifest.run_id,
  model: rawManifest.model,
  scenarioId: snapshot.run.scenario_id,
  configSha256: sha256Hex(rawConfig),
  validate: compileManifestSchema(
    join(cfg.REPO_ROOT, 'config', 'manifest.schema.json'),
  ),
});
if (!output.ok) throw new Error(output.message);
if (output.manifest.stopping.criterion !== 'steady_state')
  throw new Error('production import requires steady state');
const db = new DatabaseService(new ConfigService(cfg));
try {
  const existing = await db.query(
    'SELECT status FROM simulation_runs WHERE id=$1',
    [output.manifest.run_id],
  );
  if (existing.rowCount)
    throw new Error('run already exists; refusing to overwrite it');
  const target = join(cfg.ARTIFACT_DIR, output.manifest.run_id);
  await mkdir(target, { recursive: false });
  for (const artifact of output.artifacts)
    await cp(join(source, artifact.path), join(target, artifact.path), {
      errorOnExist: true,
      force: false,
    });
  // Verify again after copy, before inserting any rows.
  const copied = await verifyRunOutput({
    runDir: target,
    runId: output.manifest.run_id,
    model: output.manifest.model,
    scenarioId: snapshot.run.scenario_id,
    configSha256: sha256Hex(rawConfig),
    validate: compileManifestSchema(
      join(cfg.REPO_ROOT, 'config', 'manifest.schema.json'),
    ),
  });
  if (!copied.ok) throw new Error(copied.message);
  await db.query(
    `INSERT INTO simulation_runs(id,scenario_id,model,status,config_snapshot,started_at)
    VALUES($1,$2,$3,'running',$4,$5)`,
    [
      output.manifest.run_id,
      snapshot.run.scenario_id,
      output.manifest.model,
      snapshot,
      output.manifest.started_at,
    ],
  );
  try {
    await new SimulationExecutionRepository(db).persistSuccess({
      runId: output.manifest.run_id,
      runDir: target,
      manifest: copied.manifest,
      artifacts: copied.artifacts,
      metrics: JSON.parse(await readFile(join(target, 'metrics.json'), 'utf8')),
    });
  } catch (error) {
    await new SimulationExecutionRepository(db).persistFailure(
      output.manifest.run_id,
      'system',
      String(error),
    );
    throw error;
  }
  console.log(
    JSON.stringify({
      run_id: output.manifest.run_id,
      status: 'succeeded',
      mode: 'real',
      stopping: 'steady_state',
    }),
  );
} finally {
  await db.getPool().end();
}
