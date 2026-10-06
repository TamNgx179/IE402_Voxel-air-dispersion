import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'csv-parse/sync';
import { sha256File } from '../common/hash.js';

/**
 * Reader for the scene package written by src/07_export_scene.py into
 * db/seeds/scene/ (docs/DATABASE.md §5 "Scene package"). Every geometry is WKT
 * in the study area's EPSG. Loading verifies the SHA-256 of every file listed
 * in scene_manifest.json and refuses the package on any mismatch.
 */

export const SCENE_MANIFEST = 'scene_manifest.json';

const REQUIRED_FILES = {
  buildings: 'buildings.csv',
  roads: 'roads.csv',
  water: 'water.csv',
  green: 'green.csv',
  grid_cells: 'grid_cells.csv',
} as const;

const COLUMNS: Record<keyof typeof REQUIRED_FILES, string[]> = {
  buildings: ['source_feature_id', 'height_m', 'height_source', 'wkt'],
  roads: ['source_feature_id', 'road_class', 'emission_weight', 'wkt'],
  water: ['source_feature_id', 'kind', 'wkt'],
  green: ['source_feature_id', 'kind', 'wkt'],
  grid_cells: ['i', 'j', 'solid_from_k', 'solid_to_k', 'wkt'],
};

export interface SceneGrid {
  origin_x_m: number;
  origin_y_m: number;
  dx_m: number;
  dy_m: number;
  dz_m: number;
  nx: number;
  ny: number;
  nz: number;
}

export interface SceneManifest {
  schema_version: string;
  study_area: { name: string; srid: number; wkt: string };
  grid: SceneGrid;
  counts: Record<string, number>;
  files: Record<string, string>;
  provenance: unknown;
  generated_at?: string;
}

export interface BuildingRow {
  source_feature_id: string;
  height_m: number;
  height_source: string;
  wkt: string;
}
export interface RoadRow {
  source_feature_id: string;
  road_class: string | null;
  emission_weight: number | null;
  wkt: string;
}
export interface FeatureRow {
  source_feature_id: string;
  kind: string | null;
  wkt: string;
}
export interface GridCellRow {
  i: number;
  j: number;
  solid_from_k: number | null;
  solid_to_k: number | null;
  wkt: string;
}

export interface ScenePackage {
  dir: string;
  manifest: SceneManifest;
  /** Lower-case hex SHA-256 of scene_manifest.json itself. */
  manifestSha256: string;
  buildings: BuildingRow[];
  roads: RoadRow[];
  water: FeatureRow[];
  green: FeatureRow[];
  gridCells: GridCellRow[];
}

export class ScenePackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScenePackageError';
  }
}

function fail(dir: string, msg: string): never {
  throw new ScenePackageError(`scene package ${dir}: ${msg}`);
}

function normaliseSha(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.toLowerCase().replace(/^sha256:/, '');
  return /^[0-9a-f]{64}$/.test(hex) ? hex : undefined;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkManifest(dir: string, m: any): SceneManifest {
  if (m === null || typeof m !== 'object')
    fail(dir, `${SCENE_MANIFEST} is not a JSON object`);
  if (
    typeof m.schema_version !== 'string' &&
    typeof m.schema_version !== 'number'
  ) {
    fail(dir, `${SCENE_MANIFEST}: missing schema_version`);
  }
  const sa = m.study_area;
  if (!sa || typeof sa.name !== 'string' || !sa.name.trim()) {
    fail(dir, `${SCENE_MANIFEST}: study_area.name is required`);
  }
  if (!Number.isInteger(sa.srid))
    fail(dir, `${SCENE_MANIFEST}: study_area.srid must be an integer`);
  if (typeof sa.wkt !== 'string' || !sa.wkt.trim()) {
    fail(dir, `${SCENE_MANIFEST}: study_area.wkt is required`);
  }
  const g = m.grid;
  if (!g || typeof g !== 'object')
    fail(dir, `${SCENE_MANIFEST}: grid is required`);
  for (const k of ['origin_x_m', 'origin_y_m', 'dx_m', 'dy_m', 'dz_m']) {
    if (!isNum(g[k]))
      fail(dir, `${SCENE_MANIFEST}: grid.${k} must be a number`);
  }
  for (const k of ['dx_m', 'dy_m', 'dz_m']) {
    if (g[k] <= 0) fail(dir, `${SCENE_MANIFEST}: grid.${k} must be > 0`);
  }
  for (const k of ['nx', 'ny', 'nz']) {
    if (!Number.isInteger(g[k]) || g[k] < 1) {
      fail(dir, `${SCENE_MANIFEST}: grid.${k} must be a positive integer`);
    }
  }
  if (!m.counts || typeof m.counts !== 'object')
    fail(dir, `${SCENE_MANIFEST}: counts is required`);
  if (!m.files || typeof m.files !== 'object')
    fail(dir, `${SCENE_MANIFEST}: files is required`);
  return {
    ...m,
    schema_version: String(m.schema_version),
    provenance: m.provenance ?? {},
  } as SceneManifest;
}

function parseCsv(dir: string, file: string, text: string, columns: string[]) {
  let records: Record<string, string>[];
  try {
    records = parse(text.replace(/^﻿/, ''), {
      columns: true,
      skip_empty_lines: true,
      trim: false,
    });
  } catch (err) {
    fail(
      dir,
      `${file}: invalid CSV (${err instanceof Error ? err.message : err})`,
    );
  }
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const present = header.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const missing = columns.filter((c) => !present.includes(c));
  if (missing.length > 0)
    fail(dir, `${file}: missing column(s) ${missing.join(', ')}`);
  return records;
}

function num(
  dir: string,
  file: string,
  row: number,
  col: string,
  v: string,
): number {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) {
    fail(dir, `${file} row ${row}: ${col} must be a number (got "${v}")`);
  }
  return n;
}

function optNum(
  dir: string,
  file: string,
  row: number,
  col: string,
  v: string | undefined,
) {
  if (v === undefined || v.trim() === '') return null;
  return num(dir, file, row, col, v);
}

function optInt(
  dir: string,
  file: string,
  row: number,
  col: string,
  v: string | undefined,
) {
  const n = optNum(dir, file, row, col, v);
  if (n !== null && !Number.isInteger(n)) {
    fail(dir, `${file} row ${row}: ${col} must be an integer (got "${v}")`);
  }
  return n;
}

function text(v: string | undefined): string | null {
  return v === undefined || v.trim() === '' ? null : v;
}

function wkt(
  dir: string,
  file: string,
  row: number,
  v: string | undefined,
): string {
  if (!v || !v.trim()) fail(dir, `${file} row ${row}: wkt is empty`);
  return v;
}

/** Reads and verifies a scene package. Throws ScenePackageError on any problem. */
export async function loadScenePackage(dir: string): Promise<ScenePackage> {
  const manifestPath = join(dir, SCENE_MANIFEST);
  if (!existsSync(manifestPath)) {
    fail(
      dir,
      `${SCENE_MANIFEST} not found. Export it first with ` +
        '`python src/07_export_scene.py` (docs/DATABASE.md §5), or pass --scene <dir>.',
    );
  }
  const manifestRaw = await readFile(manifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw.toString('utf8'));
  } catch (err) {
    fail(
      dir,
      `${SCENE_MANIFEST} is not valid JSON (${err instanceof Error ? err.message : err})`,
    );
  }
  const manifest = checkManifest(dir, parsed);

  // Checksums: every listed file must exist and match; required files must be listed.
  for (const required of Object.values(REQUIRED_FILES)) {
    if (!(required in manifest.files))
      fail(dir, `${SCENE_MANIFEST}: files.${required} is missing`);
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (
      name !== basename(name) ||
      name === '.' ||
      name === '..' ||
      /[\\/]/.test(name)
    ) {
      fail(
        dir,
        `${SCENE_MANIFEST}: file name "${name}" must be a bare file name`,
      );
    }
    const sha = normaliseSha(expected);
    if (!sha)
      fail(dir, `${SCENE_MANIFEST}: files.${name} is not a SHA-256 hex digest`);
    const path = join(dir, name);
    if (!existsSync(path))
      fail(dir, `${name} is listed in ${SCENE_MANIFEST} but missing`);
    const actual = await sha256File(path);
    if (actual !== sha) {
      fail(
        dir,
        `checksum mismatch for ${name}: manifest ${sha.slice(0, 12)}…, file ${actual.slice(0, 12)}…. ` +
          'Refusing to seed; re-export the scene package.',
      );
    }
  }

  const read = async (key: keyof typeof REQUIRED_FILES) => {
    const file = REQUIRED_FILES[key];
    const records = parseCsv(
      dir,
      file,
      await readFile(join(dir, file), 'utf8'),
      COLUMNS[key],
    );
    const expected = manifest.counts[key];
    if (expected !== undefined && expected !== records.length) {
      fail(
        dir,
        `${file} has ${records.length} rows but counts.${key} = ${expected}`,
      );
    }
    return { file, records };
  };

  const b = await read('buildings');
  const buildings = b.records.map((r, idx) => ({
    source_feature_id: r.source_feature_id,
    height_m: num(dir, b.file, idx + 2, 'height_m', r.height_m),
    height_source: r.height_source,
    wkt: wkt(dir, b.file, idx + 2, r.wkt),
  }));
  const rd = await read('roads');
  const roads = rd.records.map((r, idx) => ({
    source_feature_id: r.source_feature_id,
    road_class: text(r.road_class),
    emission_weight: optNum(
      dir,
      rd.file,
      idx + 2,
      'emission_weight',
      r.emission_weight,
    ),
    wkt: wkt(dir, rd.file, idx + 2, r.wkt),
  }));
  const feature =
    (file: string) => (r: Record<string, string>, idx: number) => ({
      source_feature_id: r.source_feature_id,
      kind: text(r.kind),
      wkt: wkt(dir, file, idx + 2, r.wkt),
    });
  const w = await read('water');
  const water = w.records.map(feature(w.file));
  const gr = await read('green');
  const green = gr.records.map(feature(gr.file));
  const gc = await read('grid_cells');
  const gridCells = gc.records.map((r, idx) => {
    const row = idx + 2;
    const i = optInt(dir, gc.file, row, 'i', r.i);
    const j = optInt(dir, gc.file, row, 'j', r.j);
    if (i === null || j === null)
      fail(dir, `${gc.file} row ${row}: i and j are required`);
    if (i < 0 || i >= manifest.grid.nx || j < 0 || j >= manifest.grid.ny) {
      fail(
        dir,
        `${gc.file} row ${row}: (i, j) = (${i}, ${j}) outside the ${manifest.grid.nx} x ${manifest.grid.ny} grid`,
      );
    }
    return {
      i,
      j,
      solid_from_k: optInt(dir, gc.file, row, 'solid_from_k', r.solid_from_k),
      solid_to_k: optInt(dir, gc.file, row, 'solid_to_k', r.solid_to_k),
      wkt: wkt(dir, gc.file, row, r.wkt),
    };
  });
  const expectedCells = manifest.grid.nx * manifest.grid.ny;
  if (gridCells.length !== expectedCells) {
    fail(
      dir,
      `${gc.file} has ${gridCells.length} cells but nx * ny = ${expectedCells}`,
    );
  }

  return {
    dir,
    manifest,
    manifestSha256: await sha256File(manifestPath),
    buildings,
    roads,
    water,
    green,
    gridCells,
  };
}
