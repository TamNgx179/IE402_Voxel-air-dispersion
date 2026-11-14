import type pg from 'pg';
import type { DatabaseService } from '../../../database/database.service.js';
import {
  CLAIM_LOCK_KEY,
  SimulationRunsRepository,
} from './simulation-runs.repository.js';

/**
 * In-memory stand-in for PostgreSQL that models just what claimNext relies
 * on: a transaction-scoped advisory lock (a FIFO mutex released at
 * COMMIT/ROLLBACK) and READ COMMITTED visibility (a transaction sees its own
 * writes plus other transactions' writes only after they commit).
 */
class FakeDb {
  committed = new Map<string, string>(); // id -> status
  queries: string[] = [];
  private lockHeld = false;
  private waiters: Array<() => void> = [];

  constructor(queued: number, running = 0) {
    for (let i = 0; i < running; i++) this.committed.set(`r${i}`, 'running');
    for (let i = 0; i < queued; i++)
      this.committed.set(`q${String(i).padStart(2, '0')}`, 'queued');
  }

  private async acquire() {
    if (!this.lockHeld) {
      this.lockHeld = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.lockHeld = false;
  }

  service(): DatabaseService {
    return {
      transaction: async <T>(fn: (c: pg.PoolClient) => Promise<T>) => {
        const local = new Map<string, string>();
        let holdsLock = false;
        const view = () => new Map([...this.committed, ...local]);
        const client = {
          query: async (text: string, values?: unknown[]) => {
            this.queries.push(text);
            // Yield so concurrent transactions interleave between statements.
            await new Promise((r) => setTimeout(r, 0));
            if (text.includes('pg_advisory_xact_lock')) {
              expect(values).toEqual([CLAIM_LOCK_KEY]);
              await this.acquire();
              holdsLock = true;
              return { rows: [{}], rowCount: 1 };
            }
            if (text.includes('count(*)')) {
              const n = [...view().values()].filter((s) => s === 'running').length;
              return { rows: [{ n }], rowCount: 1 };
            }
            if (text.includes('UPDATE simulation_runs')) {
              const id = [...view().entries()]
                .filter(([, s]) => s === 'queued')
                .map(([k]) => k)
                .sort()[0];
              if (!id) return { rows: [], rowCount: 0 };
              local.set(id, 'running');
              return {
                rows: [{ id, scenario_id: 's', model: 'fv', attempt: 1, config_snapshot: null }],
                rowCount: 1,
              };
            }
            throw new Error(`unexpected SQL: ${text}`);
          },
        } as unknown as pg.PoolClient;
        try {
          const result = await fn(client);
          for (const [k, v] of local) this.committed.set(k, v);
          return result;
        } finally {
          if (holdsLock) this.release();
        }
      },
    } as unknown as DatabaseService;
  }

  runningCount() {
    return [...this.committed.values()].filter((s) => s === 'running').length;
  }
}

describe('SimulationRunsRepository.claimNext', () => {
  it('takes the claim lock before counting running runs', async () => {
    const db = new FakeDb(1);
    await new SimulationRunsRepository(db.service()).claimNext();
    expect(db.queries[0]).toMatch(/pg_advisory_xact_lock/);
    expect(db.queries[1]).toMatch(/count\(\*\)/);
    expect(db.queries[2]).toMatch(/UPDATE simulation_runs/);
  });

  it('claims the oldest queued run and returns null once the cap is reached', async () => {
    const db = new FakeDb(3);
    const repo = new SimulationRunsRepository(db.service());
    expect((await repo.claimNext())?.id).toBe('q00');
    expect(await repo.claimNext()).toBeNull();
    // At the cap no UPDATE is even attempted.
    expect(db.queries.filter((q) => q.includes('UPDATE')).length).toBe(1);
  });

  it('returns null when nothing is queued', async () => {
    const db = new FakeDb(0);
    expect(await new SimulationRunsRepository(db.service()).claimNext()).toBeNull();
  });

  it.each([1, 2, 3])(
    'concurrent claimers never exceed a cap of %i',
    async (cap) => {
      const db = new FakeDb(10);
      const repo = new SimulationRunsRepository(db.service());
      const claims = await Promise.all(
        Array.from({ length: 8 }, () => repo.claimNext(cap)),
      );
      const claimed = claims.filter((c) => c !== null).map((c) => c!.id);
      expect(claimed.length).toBe(cap);
      expect(new Set(claimed).size).toBe(cap);
      expect(db.runningCount()).toBe(cap);
    },
  );

  it('does not claim when runs are already running at the cap', async () => {
    const db = new FakeDb(5, 1);
    const repo = new SimulationRunsRepository(db.service());
    const claims = await Promise.all(Array.from({ length: 4 }, () => repo.claimNext()));
    expect(claims.every((c) => c === null)).toBe(true);
    expect(db.runningCount()).toBe(1);
  });
});
