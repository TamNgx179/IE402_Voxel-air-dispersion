import type { ReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importConcentrationColumns } from './result-importer.js';

// Record every artifact stream so tests can prove none is left open.
const opened = vi.hoisted(() => [] as ReadStream[]);
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    createReadStream: (...args: Parameters<typeof fs.createReadStream>) => {
      const stream = fs.createReadStream(...args);
      opened.push(stream);
      return stream;
    },
  };
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  opened.splice(0);
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
    ).rejects.toThrow('i and j must be decimal integers');
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['', '0x1', '1.0', '1e1', '32768'])(
    'rejects coordinate %j instead of coercing it to a grid index',
    async (value) => {
      const path = await artifact(`i,j,c_ug_m3\n${value},0,"{1,2}"\n`);
      const query = vi.fn();
      await expect(
        importConcentrationColumns({ query } as never, 'run-id', path),
      ).rejects.toThrow('i and j must be decimal integers');
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a rejected row', '0,0,"{-1}"\n', null],
    ['a failed batch', '', new Error('db down')],
  ])('closes the artifact file after %s', async (_case, head, dbError) => {
    // Poorly compressible rows keep the gzip file larger than one read chunk,
    // so the failure happens while the file stream is still open.
    const rows = Array.from(
      { length: 30_000 },
      (_, n) => `${n},9,"{${Math.random()},${Math.random()}}"`,
    );
    const path = await artifact(`i,j,c_ug_m3\n${head}${rows.join('\n')}\n`);
    const query = vi.fn().mockImplementation(async () => {
      if (dbError) throw dbError;
      return { rows: [] };
    });
    await expect(
      importConcentrationColumns({ query } as never, 'run-id', path),
    ).rejects.toThrow();
    expect(opened).toHaveLength(1);
    await vi.waitFor(() => expect(opened[0].closed).toBe(true));
  });

  it.each(['-0.001', '1e999', 'NaN', 'Infinity', '-Infinity'])(
    'rejects invalid concentration %s before sending a batch',
    async (value) => {
      const path = await artifact(`i,j,c_ug_m3\n0,0,"{0,NULL,${value}}"\n`);
      const query = vi.fn();
      await expect(
        importConcentrationColumns({ query } as never, 'run-id', path),
      ).rejects.toThrow();
      expect(query).not.toHaveBeenCalled();
    },
  );
});
