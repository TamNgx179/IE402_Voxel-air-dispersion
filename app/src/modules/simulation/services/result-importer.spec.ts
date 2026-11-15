import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importConcentrationColumns } from './result-importer.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function artifact(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'voxel-columns-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'columns.csv.gz');
  await writeFile(path, gzipSync(contents));
  return path;
}

describe('importConcentrationColumns', () => {
  it('validates and imports gzip CSV rows as PostgreSQL arrays', async () => {
    const path = await artifact(
      'i,j,c_ug_m3\n0,1,"{1,2,NULL}"\n2,3,"{4.5,6e-2,7}"\n',
    );
    const query = vi.fn().mockResolvedValue({ rows: [] });

    const count = await importConcentrationColumns(
      { query } as never,
      '00000000-0000-4000-8000-000000000001',
      path,
    );

    expect(count).toBe(2);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain(
      'INSERT INTO concentration_columns',
    );
    expect(query.mock.calls[0][1]).toEqual([
      '00000000-0000-4000-8000-000000000001',
      0,
      1,
      '{1,2,NULL}',
      '00000000-0000-4000-8000-000000000001',
      2,
      3,
      '{4.5,6e-2,7}',
    ]);
  });

  it('rejects malformed coordinates before writing to the database', async () => {
    const path = await artifact('i,j,c_ug_m3\n-1,0,"{1,2}"\n');
    const query = vi.fn();

    await expect(
      importConcentrationColumns({ query } as never, 'run-id', path),
    ).rejects.toThrow('i and j must be non-negative integers');
    expect(query).not.toHaveBeenCalled();
  });
});
