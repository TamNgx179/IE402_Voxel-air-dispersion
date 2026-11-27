import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import type { AppConfig } from '../config/env.validation.js';

export type DatabaseStatus =
  | { configured: false; status: 'not_configured' }
  | { configured: true; status: 'up'; postgres: string; postgis: string }
  | { configured: true; status: 'down'; error: string };

const HEALTH_TIMEOUT_MS = 3_000;

export interface DatabaseLimits {
  statementTimeoutMs?: number;
  lockTimeoutMs?: number;
  max?: number;
}

/** Server cancellation limits the actual SQL, rather than just abandoning a Promise. */
export function createPool(
  connectionString: string,
  limits: DatabaseLimits = {},
): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: limits.max ?? 10,
    statement_timeout: limits.statementTimeoutMs ?? 15_000,
    lock_timeout: limits.lockTimeoutMs ?? 3_000,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

/**
 * Budgets for offline `db:*` maintenance, which may scan all historical voxels:
 * at least 120 s / 10 s, but never below what the operator configured.
 */
export function maintenanceLimits(
  cfg: Pick<AppConfig, 'DB_STATEMENT_TIMEOUT_MS' | 'DB_LOCK_TIMEOUT_MS'>,
): DatabaseLimits {
  return {
    statementTimeoutMs: Math.max(cfg.DB_STATEMENT_TIMEOUT_MS, 120_000),
    lockTimeoutMs: Math.max(cfg.DB_LOCK_TIMEOUT_MS, 10_000),
  };
}

/**
 * Owns the PostgreSQL/PostGIS connection pool (raw SQL through `pg`, no ORM,
 * so every query can be EXPLAINed as written, BR-27).
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool?: pg.Pool;

  constructor(config: ConfigService<AppConfig, true>) {
    const url = config.get('DATABASE_URL', { infer: true });
    if (url) {
      this.pool = createPool(url, {
        statementTimeoutMs: config.get('DB_STATEMENT_TIMEOUT_MS', {
          infer: true,
        }),
        lockTimeoutMs: config.get('DB_LOCK_TIMEOUT_MS', { infer: true }),
      });
      // An idle client losing its connection must not crash the process.
      this.pool.on('error', (err) =>
        this.logger.warn(`idle PostgreSQL client error: ${err.message}`),
      );
    }
  }

  get configured(): boolean {
    return this.pool !== undefined;
  }

  /** The pool, or 503 when DATABASE_URL is not set. */
  getPool(): pg.Pool {
    if (!this.pool) {
      throw new ServiceUnavailableException(
        'Database is not configured (set DATABASE_URL, see app/.env.example)',
      );
    }
    return this.pool;
  }

  query<R extends pg.QueryResultRow = any>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    return this.getPool().query<R>(text, values);
  }

  /** Runs `fn` inside BEGIN/COMMIT, rolling back on any error. */
  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getPool().connect();
    // pg-pool detaches its own listener while a client is checked out, so a
    // connection dropped between statements would otherwise be an unhandled
    // 'error' event and crash the process.
    let lost: Error | undefined;
    const onError = (err: Error) => {
      lost ??= err;
      this.logger.warn(
        `PostgreSQL connection lost in transaction: ${err.message}`,
      );
    };
    client.on('error', onError);
    let discard = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // A disconnected or unrecoverable transaction must never re-enter the pool.
        discard = true;
      }
      throw err;
    } finally {
      client.removeListener('error', onError);
      client.release(discard || lost !== undefined);
    }
  }

  async status(): Promise<DatabaseStatus> {
    if (!this.pool) return { configured: false, status: 'not_configured' };
    try {
      const probe = this.pool.query<{ postgres: string; postgis: string }>(
        `SELECT current_setting('server_version') AS postgres,
                postgis_lib_version() AS postgis`,
      );
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${HEALTH_TIMEOUT_MS} ms`)),
          HEALTH_TIMEOUT_MS,
        ).unref();
      });
      try {
        const { rows } = await Promise.race([probe, timeout]);
        return {
          configured: true,
          status: 'up',
          postgres: rows[0].postgres,
          postgis: rows[0].postgis,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return {
        configured: true,
        status: 'down',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.end();
  }
}
