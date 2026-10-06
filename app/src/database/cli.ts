import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { projectConfigPath } from '../common/project-config.js';
import {
  APP_ROOT,
  ConfigValidationError,
  validate,
} from '../config/env.validation.js';
import { createPool } from './database.service.js';
import { migrate, migrationsDir, resetSchema } from './migrate.js';
import { defaultSceneDir, seed } from './seed.js';

/**
 * Database CLI behind `npm run db:migrate | db:reset | db:seed`.
 *
 *   migrate                    apply pending db/migrations/*.sql
 *   reset                      DROP SCHEMA public CASCADE, then migrate (dev only)
 *   seed [--scene <dir>]       load scene package + config/project.yaml
 *        [--config <yaml>]
 *
 * Reads app/.env like the app does; real environment variables win.
 */

const USAGE =
  'usage: cli <migrate|reset|seed> [--scene <dir>] [--config <project.yaml>]';

async function main(): Promise<number> {
  const envFile = join(APP_ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { scene: { type: 'string' }, config: { type: 'string' } },
  });
  const command = positionals[0];
  if (!command || !['migrate', 'reset', 'seed'].includes(command)) {
    console.error(USAGE);
    return 64;
  }

  let cfg;
  try {
    cfg = validate(process.env);
  } catch (err) {
    console.error(err instanceof ConfigValidationError ? err.message : err);
    return 78;
  }
  if (!cfg.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Copy app/.env.example to app/.env (the default points at ' +
        '`docker compose up -d db`), or export DATABASE_URL.',
    );
    return 78;
  }

  const log = (msg: string) => console.log(`[db:${command}] ${msg}`);
  const pool = createPool(cfg.DATABASE_URL);
  try {
    if (command === 'reset') {
      log('dropping schema public (all data)');
      await resetSchema(pool);
    }
    if (command === 'migrate' || command === 'reset') {
      const r = await migrate(pool, migrationsDir(cfg.REPO_ROOT), log);
      log(`applied ${r.applied.length}, already applied ${r.skipped.length}`);
    }
    if (command === 'seed') {
      const sceneDir = values.scene
        ? resolve(process.cwd(), values.scene)
        : process.env.SCENE_DIR
          ? resolve(APP_ROOT, process.env.SCENE_DIR)
          : defaultSceneDir(cfg.REPO_ROOT);
      const configPath = values.config
        ? resolve(process.cwd(), values.config)
        : projectConfigPath(cfg.REPO_ROOT);
      log(`scene: ${sceneDir}`);
      log(`config: ${configPath}`);
      const summary = await seed(pool, { sceneDir, configPath, log });
      log(JSON.stringify(summary));
    }
    return 0;
  } catch (err) {
    console.error(
      `[db:${command}] FAILED: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main();
