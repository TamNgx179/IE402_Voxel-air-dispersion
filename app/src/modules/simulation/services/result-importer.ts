import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type pg from 'pg';
import { parse } from 'csv-parse';

const BATCH_SIZE = 250;
const ARRAY_LITERAL =
  /^\{(?:NULL|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:,(?:NULL|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))*\}$/;
// Decimal digits only: Number('') is 0 and Number('0x1') is 1, so a blank or
// non-decimal coordinate must not be coerced into a real grid column.
const INDEX = /^\d+$/;
const SMALLINT_MAX = 32767;

interface ColumnRecord {
  i: string;
  j: string;
  c_ug_m3: string;
}

/**
 * Imports the verified solver columns artifact into PostGIS in batches.
 * The caller owns the transaction; any malformed row aborts the run before
 * it can become `succeeded` (A5.1, BR-20, BR-24). `pipeline` destroys the
 * file, gunzip and parser streams on every exit path, so a rejected row or a
 * failed batch never leaks the artifact's file handle.
 */
export async function importConcentrationColumns(
  client: pg.PoolClient,
  runId: string,
  gzipCsvPath: string,
): Promise<number> {
  let count = 0;
  await pipeline(
    createReadStream(gzipCsvPath),
    createGunzip(),
    parse({ columns: true, bom: true, skip_empty_lines: true, trim: true }),
    async (rows: AsyncIterable<ColumnRecord>) => {
      let batch: ColumnRecord[] = [];
      for await (const row of rows) {
        validate(row, count + batch.length + 2);
        batch.push(row);
        if (batch.length >= BATCH_SIZE) {
          await insertBatch(client, runId, batch);
          count += batch.length;
          batch = [];
        }
      }
      if (batch.length > 0) {
        await insertBatch(client, runId, batch);
        count += batch.length;
      }
    },
  );
  if (count === 0) throw new Error('columns.csv.gz has no concentration rows');
  return count;
}

function validate(row: ColumnRecord, line: number): void {
  for (const index of [row.i, row.j]) {
    if (!INDEX.test(index ?? '') || Number(index) > SMALLINT_MAX) {
      throw new Error(
        `columns.csv.gz line ${line}: i and j must be decimal integers in 0..${SMALLINT_MAX}`,
      );
    }
  }
  if (!ARRAY_LITERAL.test(row.c_ug_m3 ?? '')) {
    throw new Error(
      `columns.csv.gz line ${line}: invalid PostgreSQL real[] literal`,
    );
  }
  // Check the numeric domain before batching. PostgreSQL repeats this check
  // for every writer, including SQL that bypasses this importer.
  for (const text of row.c_ug_m3.slice(1, -1).split(',')) {
    const value = Number(text);
    if (text !== 'NULL' && !(Number.isFinite(value) && value >= 0)) {
      throw new Error(
        `columns.csv.gz line ${line}: concentrations must be finite and non-negative`,
      );
    }
  }
}

async function insertBatch(
  client: pg.PoolClient,
  runId: string,
  rows: ColumnRecord[],
): Promise<void> {
  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 4;
    values.push(runId, Number(row.i), Number(row.j), row.c_ug_m3);
    return `($${offset + 1}::uuid, $${offset + 2}::smallint, $${offset + 3}::smallint, $${offset + 4}::real[])`;
  });
  await client.query(
    `INSERT INTO concentration_columns (run_id, i, j, c_ug_m3)
     VALUES ${tuples.join(',')}`,
    values,
  );
}
