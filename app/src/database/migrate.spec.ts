import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../common/hash.js';
import { migrate, migrationsDir } from './migrate.js';

/**
 * In-memory stand-in for a pg Pool/PoolClient. It records every statement,
 * keeps schema_migrations rows and can fail a chosen migration body.
 */
function fakePool(
  options: { applied?: Record<string, string>; failOn?: string } = {},
) {
  const statements: string[] = [];
  const applied = new Map(Object.entries(options.applied ?? {}));
  let pending: [string, string] | null = null;
  let released = 0;
  const client = {
    async query(text: string, values?: unknown[]) {
      statements.push(text.trim().split('\n')[0].trim());
      if (options.failOn && text.includes(options.failOn))
        throw new Error('syntax error at or near "BROKEN"');
      if (text.startsWith('SELECT version, checksum'))
        return {
          rows: [...applied].map(([version, checksum]) => ({
            version,
            checksum,
          })),
        };
      if (text.startsWith('INSERT INTO schema_migrations'))
        pending = values as [string, string];
      if (text === 'COMMIT' && pending) {
        applied.set(...pending);
        pending = null;
      }
      if (text === 'ROLLBACK') pending = null;
      return { rows: [] };
    },
    release() {
      released++;
    },
  };
  return {
    pool: { connect: async () => client } as never,
    statements,
    applied,
    released: () => released,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ie402-migrate-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function files(entries: Record<string, string>) {
  for (const [name, sql] of Object.entries(entries))
    await writeFile(join(dir, name), sql);
}

describe('migrate', () => {
  it('applies files in name order, each in its own transaction, under an advisory lock', async () => {
    await files({
      '0002_b.sql': 'CREATE TABLE b();',
      '0001_a.sql': 'CREATE TABLE a();',
      'README.md': 'not a migration',
      '01_short.sql': 'ignored: wrong pattern',
    });
    const db = fakePool();
    const log: string[] = [];
    const result = await migrate(db.pool, dir, (m) => log.push(m));

    expect(result).toEqual({
      applied: ['0001_a.sql', '0002_b.sql'],
      skipped: [],
    });
    expect(log).toEqual(['applying 0001_a.sql', 'applying 0002_b.sql']);
    expect(db.statements[0]).toBe('SELECT pg_advisory_lock($1)');
    expect(db.statements.at(-1)).toBe('SELECT pg_advisory_unlock($1)');
    expect(
      db.statements.filter((s) => s === 'BEGIN' || s === 'COMMIT'),
    ).toEqual(['BEGIN', 'COMMIT', 'BEGIN', 'COMMIT']);
    expect(db.applied.get('0001_a.sql')).toBe(sha256Hex('CREATE TABLE a();'));
    expect(db.released()).toBe(1);
  });

  it('skips applied files and treats CRLF and LF checkouts as the same file', async () => {
    await files({ '0001_a.sql': 'CREATE TABLE a();\r\nSELECT 1;\r\n' });
    const db = fakePool({
      applied: { '0001_a.sql': sha256Hex('CREATE TABLE a();\nSELECT 1;\n') },
    });
    await expect(migrate(db.pool, dir)).resolves.toEqual({
      applied: [],
      skipped: ['0001_a.sql'],
    });
    expect(db.statements).not.toContain('BEGIN');
  });

  it('refuses an applied migration whose file was edited', async () => {
    await files({ '0001_a.sql': 'CREATE TABLE a(id int);' });
    const db = fakePool({ applied: { '0001_a.sql': sha256Hex('old') } });
    await expect(migrate(db.pool, dir)).rejects.toThrow(
      /already applied but its file changed/,
    );
    expect(db.statements.at(-1)).toBe('SELECT pg_advisory_unlock($1)');
    expect(db.released()).toBe(1);
  });

  it('rolls back a failing migration, keeps earlier ones and names the file', async () => {
    await files({
      '0001_a.sql': 'CREATE TABLE a();',
      '0002_bad.sql': 'BROKEN SQL;',
      '0003_c.sql': 'CREATE TABLE c();',
    });
    const db = fakePool({ failOn: 'BROKEN' });
    const error = await migrate(db.pool, dir).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'migration 0002_bad.sql failed: syntax error at or near "BROKEN"',
    );
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect([...db.applied.keys()]).toEqual(['0001_a.sql']);
    expect(db.statements).toContain('ROLLBACK');
    expect(db.statements).not.toContain('CREATE TABLE c();');
    expect(db.released()).toBe(1);
  });

  it('fails clearly when the directory holds no migrations', async () => {
    await files({ 'notes.txt': '' });
    await expect(migrate(fakePool().pool, dir)).rejects.toThrow(
      /no migrations found/,
    );
  });
});

describe('repository migrations', () => {
  const repo = resolve(import.meta.dirname, '../../..');

  it('are uniquely numbered, follow the file pattern and stay in order', async () => {
    const names = (await readdir(migrationsDir(repo)))
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names)
      expect(name).toMatch(/^\d{4}_[A-Za-z0-9_-]+\.sql$/);
    const numbers = names.map((n) => Number(n.slice(0, 4)));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('apply cleanly to an empty database in a single pass', async () => {
    const db = fakePool();
    const result = await migrate(db.pool, migrationsDir(repo));
    expect(result.skipped).toEqual([]);
    // A second run against the recorded checksums is a no-op.
    const again = await migrate(
      fakePool({ applied: Object.fromEntries(db.applied) }).pool,
      migrationsDir(repo),
    );
    expect(again).toEqual({ applied: [], skipped: result.applied });
  });
});
