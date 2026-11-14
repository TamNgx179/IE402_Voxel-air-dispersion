import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../src/config/env.validation.js';
import { DatabaseService } from '../src/database/database.service.js';
import { SimulationRunsRepository } from '../src/modules/simulation/repositories/simulation-runs.repository.js';
import { prepareTestDatabase } from './support/test-db.js';

/**
 * Concurrent dispatchers against real PostGIS: several independent
 * DatabaseService instances (separate pools, as separate processes would
 * have) race to claim queued runs. The slot cap must hold.
 */

const db = await prepareTestDatabase();
const DISPATCHERS = 6;
const CLAIMS_PER_DISPATCHER = 4;

describe.skipIf(!db.ok)('SimulationRunsRepository.claimNext (e2e, concurrent dispatchers)', () => {
  const pool = db.ok ? db.pool : (undefined as never);
  let services: DatabaseService[] = [];
  let repos: SimulationRunsRepository[] = [];

  beforeAll(() => {
    const config = {
      get: (key: string) => (key === 'DATABASE_URL' && db.ok ? db.url : undefined),
    } as unknown as ConfigService<AppConfig, true>;
    services = Array.from({ length: DISPATCHERS }, () => new DatabaseService(config));
    repos = services.map((s) => new SimulationRunsRepository(s));
  });

  afterAll(async () => {
    await Promise.all(services.map((s) => s.onApplicationShutdown()));
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM simulation_runs');
    await pool.query(
      `INSERT INTO simulation_runs (scenario_id, status, created_at)
       SELECT 'dry_nov_apr', 'queued', now() + make_interval(secs => g)
       FROM generate_series(1, 12) AS g`,
    );
  });

  const runningCount = async () =>
    (
      await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM simulation_runs WHERE status = 'running'`,
      )
    ).rows[0].n;

  it.each([1, 2])('never exceeds a cap of %i under concurrent claims', async (cap) => {
    const claims = await Promise.all(
      repos.flatMap((repo) =>
        Array.from({ length: CLAIMS_PER_DISPATCHER }, () => repo.claimNext(cap)),
      ),
    );
    const claimed = claims.filter((c) => c !== null).map((c) => c!.id);
    expect(claimed.length).toBe(cap);
    expect(new Set(claimed).size).toBe(cap);
    expect(await runningCount()).toBe(cap);

    // The oldest queued runs are the ones claimed.
    const oldest = await pool.query<{ id: string }>(
      `SELECT id FROM simulation_runs ORDER BY created_at, id LIMIT $1`,
      [cap],
    );
    expect(new Set(claimed)).toEqual(new Set(oldest.rows.map((r) => r.id)));
  });

  it('frees a slot only after the running run leaves `running`', async () => {
    const first = await repos[0].claimNext();
    expect(first).not.toBeNull();
    expect(
      (await Promise.all(repos.map((r) => r.claimNext()))).every((c) => c === null),
    ).toBe(true);
    await pool.query(
      `UPDATE simulation_runs SET status = 'stale', finished_at = now() WHERE id = $1`,
      [first!.id],
    );
    const next = await Promise.all(repos.map((r) => r.claimNext()));
    expect(next.filter((c) => c !== null).length).toBe(1);
    expect(await runningCount()).toBe(1);
  });
});
