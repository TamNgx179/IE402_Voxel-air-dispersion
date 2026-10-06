import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { projectConfigPath } from '../../src/common/project-config.js';
import { APP_ROOT } from '../../src/config/env.validation.js';
import {
  migrate,
  migrationsDir,
  resetSchema,
} from '../../src/database/migrate.js';
import { seed, type SeedSummary } from '../../src/database/seed.js';

/**
 * Integration tests run against a real PostGIS (docker compose up -d db) in a
 * SEPARATE database, `<name>_test`, created on demand, so they never wipe the
 * dev data. Override with TEST_DATABASE_URL.
 */

export const REPO_ROOT = resolve(APP_ROOT, '..');
export const FIXTURE_SCENE = join(APP_ROOT, 'test', 'fixtures', 'scene');
export const FAKE_SOLVER = join(
  APP_ROOT,
  'test',
  'fixtures',
  'fake-solver.mjs',
);

const DEFAULT_URL = 'postgres://ie402:ie402@localhost:5433/ie402';

function testUrls(): { admin: string; test: string; name: string } {
  if (process.env.TEST_DATABASE_URL) {
    const u = new URL(process.env.TEST_DATABASE_URL);
    const name = decodeURIComponent(u.pathname.slice(1));
    const admin = new URL(u);
    admin.pathname = '/postgres';
    return { admin: admin.toString(), test: u.toString(), name };
  }
  const base = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
  const baseName = decodeURIComponent(base.pathname.slice(1)) || 'ie402';
  const name = baseName.endsWith('_test') ? baseName : `${baseName}_test`;
  const test = new URL(base);
  test.pathname = `/${name}`;
  return { admin: base.toString(), test: test.toString(), name };
}

export type TestDb =
  | { ok: true; url: string; pool: pg.Pool; seeded: SeedSummary }
  | { ok: false; reason: string };

/** Creates (if needed), resets, migrates and seeds the test database. */
export async function prepareTestDatabase(): Promise<TestDb> {
  const { admin, test, name } = testUrls();
  const adminClient = new pg.Client({
    connectionString: admin,
    connectionTimeoutMillis: 3000,
  });
  try {
    await adminClient.connect();
    const exists = await adminClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (exists.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } catch (err) {
    const e = err as { code?: string; message?: string; errors?: Error[] };
    const reason =
      [e.code, e.message || e.errors?.[0]?.message].filter(Boolean).join(' ') ||
      String(err);
    process.stderr.write(
      `\n[e2e] PostGIS unreachable (${reason}); skipping DB integration tests.\n` +
        '      Start it with `docker compose up -d db` (repo root) or set TEST_DATABASE_URL.\n',
    );
    return { ok: false, reason };
  } finally {
    await adminClient.end().catch(() => undefined);
  }

  const pool = new pg.Pool({ connectionString: test, max: 4 });
  await resetSchema(pool);
  await migrate(pool, migrationsDir(REPO_ROOT));
  const seeded = await seed(pool, {
    sceneDir: FIXTURE_SCENE,
    configPath: projectConfigPath(REPO_ROOT),
  });
  return { ok: true, url: test, pool, seeded };
}

/**
 * Builds the real AppModule with `env` applied first. AppModule is imported
 * lazily because ConfigModule.forRoot reads the environment at import time.
 */
export async function createTestApp(
  env: Record<string, string>,
): Promise<INestApplication> {
  Object.assign(process.env, env);
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/setup.js');
  const app = await NestFactory.create<INestApplication>(AppModule, {
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

export async function waitFor<T>(
  probe: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000,
  intervalMs = 50,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (done(value)) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor timed out after ${timeoutMs} ms; last value: ${JSON.stringify(value)}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
