import pg from 'pg';
import { prepareTestDatabase, testUrls } from './test-db.js';

describe('integration database isolation', () => {
  it('derives a separate test database without changing the development URL', () => {
    const env = { DATABASE_URL: 'postgres://dev:dev@localhost:5433/ie402' };
    const urls = testUrls(env);
    expect(new URL(urls.test).pathname).toBe('/ie402_test');
    expect(new URL(urls.admin).pathname).toBe('/ie402');
    expect(env.DATABASE_URL).toBe('postgres://dev:dev@localhost:5433/ie402');
  });
  it('never appends _test twice', () => {
    expect(
      testUrls({ DATABASE_URL: 'postgres://localhost/ie402_test' }).name,
    ).toBe('ie402_test');
  });
  it.each(['ie402', 'postgres', 'production', ''])(
    'rejects explicit non-test database %s before any reset',
    (name) => {
      expect(() =>
        testUrls({ TEST_DATABASE_URL: `postgres://localhost/${name}` }),
      ).toThrow(/Refusing schema reset/);
    },
  );
  it('allows an explicitly named isolated test database', () => {
    const urls = testUrls({
      TEST_DATABASE_URL: 'postgres://localhost/a7_regression_test',
    });
    expect(urls.name).toBe('a7_regression_test');
    expect(new URL(urls.admin).pathname).toBe('/postgres');
  });
  it('required E2E fails instead of skipping when PostGIS cannot connect', async () => {
    vi.stubEnv('E2E_REQUIRE_DB', '1');
    vi.spyOn(pg.Client.prototype, 'connect').mockRejectedValue(
      new Error('fixture DB offline'),
    );
    vi.spyOn(pg.Client.prototype, 'end').mockResolvedValue(undefined);
    try {
      await expect(prepareTestDatabase()).rejects.toThrow(
        'Required PostGIS E2E cannot run',
      );
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
});
