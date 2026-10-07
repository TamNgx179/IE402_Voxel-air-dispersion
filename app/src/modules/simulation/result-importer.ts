import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type pg from 'pg';
import { parse } from 'csv-parse';

const BATCH_SIZE = 250;
const ARRAY_LITERAL =
  /^\{(?:NULL|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:,(?:NULL|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?))*\}$/;

interface ColumnRecord {
  i: string;
  j: string;
  c_ug_m3: string;
}

/**
 * Imports the verified solver columns artifact into PostGIS in batches.
 * The caller owns the transaction; any malformed row aborts the run before
 * it can become `succeeded` (A5.1, BR-20, BR-24).
 */
export async function importConcentrationColumns(
  client: pg.PoolClient,
  runId: string,
  gzipCsvPath: string,
): Promise<number> {
  const parser = createReadStream(gzipCsvPath)
    .pipe(createGunzip())
    .pipe(
      parse({
        columns: true,
        bom: true,
        skip_empty_lines: true,
        trim: true,
      }),
    );

  let count = 0;
  let batch: ColumnRecord[] = [];
  for await (const raw of parser) {
    const row = raw as ColumnRecord;
    validate(row, count + 2);
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
  if (count === 0) throw new Error('columns.csv.gz has no concentration rows');
  return count;
}

function validate(row: ColumnRecord, line: number): void {
  const i = Number(row.i);
  const j = Number(row.j);
  if (!Number.isInteger(i) || i < 0 || !Number.isInteger(j) || j < 0) {
    throw new Error(
      `columns.csv.gz line ${line}: i and j must be non-negative integers`,
    );
  }
  if (!ARRAY_LITERAL.test(row.c_ug_m3)) {
    throw new Error(
      `columns.csv.gz line ${line}: invalid PostgreSQL real[] literal`,
    );
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
     VALUES ${tuples.join(',')}
     ON CONFLICT (run_id, i, j) DO UPDATE SET c_ug_m3 = EXCLUDED.c_ug_m3`,
    values,
  );
}
