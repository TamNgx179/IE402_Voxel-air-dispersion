import { ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Replace pg.Pool so the service can be exercised without a PostgreSQL server.
const pools: FakePool[] = [];
class FakePool {
  options: unknown;
  handlers: Record<string, (err: Error) => void> = {};
  client = {
    query: vi.fn(async (_text: string) => ({ rows: [] })),
    release: vi.fn(),
  };
  query = vi.fn(async (_text: string, _values?: unknown[]) => ({
    rows: [{ postgres: '16.4', postgis: '3.4.2' }],
  }));
  connect = vi.fn(async () => this.client);
  end = vi.fn(async () => undefined);
  constructor(options: unknown) {
    this.options = options;
    pools.push(this);
  }
  on(event: string, handler: (err: Error) => void) {
    this.handlers[event] = handler;
    return this;
  }
}
vi.mock('pg', () => ({ default: { Pool: FakePool } }));

const { DatabaseService, createPool } = await import('./database.service.js');

function service(url?: string) {
  const config = { get: () => url };
  return new DatabaseService(config as never);
}

beforeEach(() => {
  pools.length = 0;
});

describe('DatabaseService', () => {
  it('runs in viewer-only mode without DATABASE_URL and reports not_configured', async () => {
    const db = service(undefined);
    expect(db.configured).toBe(false);
    expect(pools).toHaveLength(0);
    expect(() => db.getPool()).toThrow(ServiceUnavailableException);
    expect(() => db.query('SELECT 1')).toThrow(/DATABASE_URL/);
    await expect(db.status()).resolves.toEqual({
      configured: false,
      status: 'not_configured',
    });
    await expect(db.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('creates one bounded pool and survives idle client errors', () => {
    const db = service('postgres://u:p@localhost:5433/ie402');
    expect(db.configured).toBe(true);
    expect(pools).toHaveLength(1);
    expect(pools[0].options).toMatchObject({
      connectionString: 'postgres://u:p@localhost:5433/ie402',
      max: 10,
      connectionTimeoutMillis: 5_000,
    });
    expect(() =>
      pools[0].handlers.error(new Error('terminating connection')),
    ).not.toThrow();
  });

  it('passes parameters through to pg unchanged', async () => {
    const db = service('postgres://localhost/db');
    await db.query('SELECT $1::int', [7]);
    expect(pools[0].query).toHaveBeenCalledWith('SELECT $1::int', [7]);
  });

  it('commits a successful transaction and releases the client', async () => {
    const db = service('postgres://localhost/db');
    const value = await db.transaction(async (client) => {
      await client.query('UPDATE simulation_runs SET status = $1', ['running']);
      return 'done';
    });
    const { client } = pools[0];
    expect(value).toBe('done');
    expect(client.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'UPDATE simulation_runs SET status = $1',
      'COMMIT',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back, rethrows the original error and still releases the client', async () => {
    const db = service('postgres://localhost/db');
    const { client } = pools[0];
    // A failing ROLLBACK (lost connection) must not hide the original error.
    client.query.mockImplementation(async (text: string) => {
      if (text === 'ROLLBACK') throw new Error('connection lost');
      return { rows: [] };
    });
    const failure = new Error('unique violation');
    await expect(
      db.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(client.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('reports PostgreSQL and PostGIS versions when the database is up', async () => {
    const db = service('postgres://localhost/db');
    await expect(db.status()).resolves.toEqual({
      configured: true,
      status: 'up',
      postgres: '16.4',
      postgis: '3.4.2',
    });
    expect(pools[0].query.mock.calls[0][0]).toContain('postgis_lib_version()');
  });

  it('reports down with the error instead of throwing', async () => {
    const db = service('postgres://localhost/db');
    pools[0].query.mockRejectedValueOnce(
      new Error('function postgis_lib_version() does not exist'),
    );
    await expect(db.status()).resolves.toEqual({
      configured: true,
      status: 'down',
      error: 'function postgis_lib_version() does not exist',
    });
  });

  it('reports down after 3 s when the probe hangs', async () => {
    vi.useFakeTimers();
    try {
      const db = service('postgres://localhost/db');
      pools[0].query.mockReturnValueOnce(new Promise(() => undefined));
      const status = db.status();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(status).resolves.toEqual({
        configured: true,
        status: 'down',
        error: 'timed out after 3000 ms',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the pool on application shutdown', async () => {
    const db = service('postgres://localhost/db');
    await db.onApplicationShutdown();
    expect(pools[0].end).toHaveBeenCalledTimes(1);
  });

  it('createPool is shared with the db:* CLI', () => {
    createPool('postgres://localhost/cli');
    expect(pools[0].options).toMatchObject({
      connectionString: 'postgres://localhost/cli',
    });
  });
});
