import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { sha256Hex } from '../common/hash.js';

/**
 * Minimal migration runner: plain SQL files `NNNN_name.sql` in
 * db/migrations/, applied in name order, each in its own transaction, and
 * recorded in `schema_migrations` with a checksum. Re-running is a no-op; an
 * applied migration whose file changed is refused.
 */

const MIGRATION_FILE = /^\d{4}_[A-Za-z0-9_-]+\.sql$/;
// Arbitrary constant: serialises concurrent `db:migrate` runs.
const LOCK_KEY = 402_0001;

export function migrationsDir(repoRoot: string): string {
  return join(repoRoot, 'db', 'migrations');
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(
  pool: pg.Pool,
  dir: string,
  log: (msg: string) => void = () => undefined,
): Promise<MigrationResult> {
  const files = (await readdir(dir))
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  if (files.length === 0) throw new Error(`no migrations found in ${dir}`);

  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const file of files) {
      const sql = await readFile(join(dir, file), 'utf8');
      const checksum = sha256Hex(sql.replace(/\r\n/g, '\n'));
      const known = applied.get(file);
      if (known !== undefined) {
        if (known !== checksum) {
          throw new Error(
            `migration ${file} was already applied but its file changed ` +
              `(checksum ${known.slice(0, 12)}… → ${checksum.slice(0, 12)}…). ` +
              'Add a new migration instead, or run db:reset on a dev database.',
          );
        }
        result.skipped.push(file);
        continue;
      }
      log(`applying ${file}`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`migration ${file} failed: ${msg}`, { cause: err });
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
      .catch(() => undefined);
    client.release();
  }
}

/**
 * Drops every object in the `public` schema (including the PostGIS extension
 * and schema_migrations) and recreates it empty. Dev/test only: "rebuild clean".
 */
export async function resetSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
}
