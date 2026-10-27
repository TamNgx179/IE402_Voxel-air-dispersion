import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'csv-parse/sync';
import { createTestApp, prepareTestDatabase } from './support/test-db.js';

const db = await prepareTestDatabase();
describe.skipIf(!db.ok)('Vertical transect with actual PostGIS', () => {
  let app: INestApplication, run: string;
  const pool = db.ok ? db.pool : (undefined as never);
  const http = () => request(app.getHttpServer());
  async function line(points: number[][]) {
    return (
      await pool.query(
        `SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1),32648),4326),15)::json AS line`,
        [JSON.stringify({ type: 'LineString', coordinates: points })],
      )
    ).rows[0].line;
  }
  async function body(
    points = [
      [686006, 1191302.5],
      [686009, 1191302.5],
    ],
  ) {
    return { line: await line(points), z_min_m: 0, z_max_m: 3 };
  }
  const query = (id = run) => http().post(`/api/runs/${id}/transect`);
  beforeAll(async () => {
    app = await createTestApp({
      DATABASE_URL: db.ok ? db.url : '',
      EXECUTOR_ENABLED: 'false',
    });
    run = randomUUID();
    await pool.query(
      `INSERT INTO simulation_runs(id,scenario_id,model,status,model_version,input_hash,finished_at)
      VALUES($1,'dry_nov_apr','fv','succeeded','transect-fixture','sha256:fixture',now())`,
      [run],
    );
    // Scene occupancy: (0,0) k0..2 and (1,1) k0..3 solid. (0,1) has a genuine zero and missing air datum.
    for (const [i, j, values] of [
      [0, 0, '{NULL,NULL,NULL,23}'],
      [1, 0, '{5,11,0,23}'],
      [0, 1, '{0,NULL,17,23}'],
      [1, 1, '{NULL,NULL,NULL,NULL}'],
    ])
      await pool.query(
        'INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,$2,$3,$4)',
        [run, i, j, values],
      );
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('reads C=2+3z at centres and preserves partial-layer overlap, identity and requested coordinates', async () => {
    const { body: r } = await query()
      .send(await body())
      .expect(200);
    expect(r).toMatchObject({
      run_id: run,
      units: 'ug m-3',
      projected_srid: 32648,
      z_min_m: 0,
      z_max_m: 3,
      model_version: 'transect-fixture',
    });
    expect(r.layers).toEqual([
      { k: 0, z_center_m: 1, overlap_min_m: 0, overlap_max_m: 2 },
      { k: 1, z_center_m: 3, overlap_min_m: 2, overlap_max_m: 3 },
    ]);
    expect(r.length_m).toBeCloseTo(3, 6);
    expect(r.samples).toHaveLength(2);
    for (const sample of r.samples) {
      expect(sample).toMatchObject({ i: 1, j: 0 });
      expect(sample.cells).toEqual([
        { k: 0, concentration_ug_m3: 5, status: 'air' },
        { k: 1, concentration_ug_m3: 11, status: 'air' },
      ]);
      expect(sample.cell_center_coordinates).toHaveLength(2);
    }
    expect(r.samples[0].sample_coordinates).not.toEqual(
      r.samples[0].cell_center_coordinates,
    );
    expect(r.actual_step_m).toBeLessThanOrEqual(r.requested_step_m);
  });
  it('separates zero, missing air data and solid, without interpolation through buildings', async () => {
    const { body: r } = await query()
      .send(
        await body([
          [686000.5, 1191307.5],
          [686009.5, 1191307.5],
        ]),
      )
      .expect(200);
    expect(r.samples[0]).toMatchObject({
      i: 0,
      j: 1,
      cells: [
        { k: 0, status: 'air', concentration_ug_m3: 0 },
        { k: 1, status: 'no_data', concentration_ug_m3: null },
      ],
    });
    expect(r.samples.at(-1).cells).toEqual([
      { k: 0, status: 'solid', concentration_ug_m3: null },
      { k: 1, status: 'solid', concentration_ug_m3: null },
    ]);
  });
  it('uses the upper cell at an exact internal boundary and rejects the half-open maximum', async () => {
    const b = await body([
      [686005, 1191302],
      [686007, 1191302],
    ]);
    const r = await query().send(b).expect(200);
    expect(r.body.samples[0].i).toBe(1);
    await query()
      .send(
        await body([
          [686010, 1191302],
          [686009, 1191302],
        ]),
      )
      .expect(400);
  });
  it('reverses the same sample positions/values on a bent route and accumulates projected metres', async () => {
    const points = [
      [686001, 1191301],
      [686009, 1191301],
      [686009, 1191309],
    ];
    const a = (
      await query()
        .send(await body(points))
        .expect(200)
    ).body;
    const b = (
      await query()
        .send(await body([...points].reverse()))
        .expect(200)
    ).body;
    expect(a.length_m).toBeCloseTo(16, 6);
    expect(a.samples).toHaveLength(b.samples.length);
    for (let n = 0; n < a.samples.length; n++) {
      const x = a.samples[n],
        y = b.samples.at(-1 - n);
      expect(x.x_m).toBeCloseTo(y.x_m, 6);
      expect(x.y_m).toBeCloseTo(y.y_m, 6);
      expect(x.cells).toEqual(y.cells);
      expect(x.distance_m + y.distance_m).toBeCloseTo(a.length_m, 6);
    }
  });
  it('accepts a self-crossing line and keeps repeated visited voxels as samples, not volume', async () => {
    const { body: r } = await query()
      .send(
        await body([
          [686001, 1191301],
          [686009, 1191309],
          [686001, 1191309],
          [686009, 1191301],
        ]),
      )
      .expect(200);
    expect(r.samples.length).toBeGreaterThan(4);
    expect(r.air_volume_m3).toBeUndefined();
  });
  it('includes both endpoints on a sub-cell route and respects custom sampling spacing', async () => {
    const b = await body();
    const r = await query()
      .send({ ...b, step_m: 1 })
      .expect(200);
    expect(r.body.samples.length).toBeGreaterThanOrEqual(4);
    expect(r.body.samples[0].distance_m).toBe(0);
    expect(r.body.samples.at(-1).distance_m).toBe(r.body.length_m);
    expect(r.body.actual_step_m).toBeLessThanOrEqual(1);
  });
  it('returns no_data for a missing concentration column instead of inventing zero', async () => {
    await pool.query(
      'DELETE FROM concentration_columns WHERE run_id=$1 AND i=0 AND j=1',
      [run],
    );
    try {
      const { body: r } = await query()
        .send(
          await body([
            [686001, 1191307],
            [686002, 1191307],
          ]),
        )
        .expect(200);
      expect(
        r.samples[0].cells.every(
          (c: any) => c.status === 'no_data' && c.concentration_ug_m3 === null,
        ),
      ).toBe(true);
    } finally {
      await pool.query(
        "INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,0,1,'{0,NULL,17,23}')",
        [run],
      );
    }
  });
  it('returns CSV equal to JSON and escapes provenance text without changing scientific values', async () => {
    const b = await body();
    const result = (await query().send(b).expect(200)).body;
    const csv = await http()
      .post(`/api/runs/${run}/transect/csv`)
      .send(b)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const rows = parse(csv.text, { columns: true });
    expect(rows).toHaveLength(4);
    expect(rows.map((r: any) => +r.concentration_ug_m3)).toEqual(
      result.samples.flatMap((s: any) =>
        s.cells.map((c: any) => c.concentration_ug_m3),
      ),
    );
    expect(rows[1]).toMatchObject({
      run_id: run,
      units: 'ug m-3',
      k: '1',
      z_center_m: '3',
      overlap_max_m: '3',
    });
    await pool.query(
      'UPDATE simulation_runs SET model_version=$2 WHERE id=$1',
      [run, '=formula,"quoted"'],
    );
    try {
      const escaped = await http()
        .post(`/api/runs/${run}/transect/csv`)
        .send(b)
        .expect(200);
      expect(parse(escaped.text, { columns: true })[0].model_version).toBe(
        '\'=formula,"quoted"',
      );
    } finally {
      await pool.query(
        "UPDATE simulation_runs SET model_version='transect-fixture' WHERE id=$1",
        [run],
      );
    }
  });
  it.each(['queued', 'running', 'failed', 'stale'])(
    'refuses %s runs on both JSON and CSV',
    async (status) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO simulation_runs(id,scenario_id,status,error_kind) VALUES($1,'dry_nov_apr',$2,$3)`,
        [id, status, status === 'failed' ? 'model' : null],
      );
      const b = await body();
      await query(id).send(b).expect(409);
      await http().post(`/api/runs/${id}/transect/csv`).send(b).expect(409);
    },
  );
  it('returns 404 for missing runs and 400 for malformed IDs or DTOs', async () => {
    const b = await body();
    await query(randomUUID()).send(b).expect(404);
    await query('bad-id').send(b).expect(400);
    for (const invalid of [
      {},
      { ...b, extra: true },
      { ...b, z_min_m: -1 },
      { ...b, z_max_m: 0 },
      { ...b, z_max_m: 8.01 },
      { ...b, step_m: 0 },
      { ...b, step_m: -1 },
      { ...b, step_m: 6 },
      { ...b, step_m: null },
    ])
      await query().send(invalid).expect(400);
  });
  it('rejects oversized, malformed, duplicate, empty, nonfinite and outside lines', async () => {
    const b = await body();
    for (const invalid of [
      { type: 'Polygon', coordinates: b.line.coordinates },
      { type: 'LineString', coordinates: [] },
      { type: 'LineString', coordinates: [b.line.coordinates[0]] },
      {
        type: 'LineString',
        coordinates: Array(101).fill(b.line.coordinates[0]),
      },
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        type: 'LineString',
        coordinates: [
          [181, 10],
          [106, 10],
        ],
      },
      {
        type: 'LineString',
        coordinates: [
          [106, 10, null],
          [106, 11, 0],
        ],
      },
      {
        type: 'LineString',
        coordinates: [
          [null, 10],
          [106, 10],
        ],
      },
      {
        ...b.line,
        coordinates: [b.line.coordinates[0], b.line.coordinates[0]],
      },
      { ...b.line, extra: 1 },
      await line([
        [685999, 1191302],
        [686001, 1191302],
      ]),
    ])
      await query()
        .send({ ...b, line: invalid })
        .expect(400);
    const tooMany = await query()
      .send({ ...b, step_m: 1e-10 })
      .expect(400);
    expect(tooMany.body.message).toMatch(/20.000/);
  });
  it('refuses a missing grid mask or concentration inside a solid voxel instead of hiding inconsistent data', async () => {
    const area = (await pool.query('SELECT id FROM study_areas LIMIT 1'))
      .rows[0].id;
    const old = (
      await pool.query(
        'SELECT ST_AsEWKT(geom) AS geom FROM grid_cells WHERE study_area_id=$1 AND i=1 AND j=0',
        [area],
      )
    ).rows[0];
    await pool.query(
      'DELETE FROM grid_cells WHERE study_area_id=$1 AND i=1 AND j=0',
      [area],
    );
    try {
      await query()
        .send(await body())
        .expect(409);
    } finally {
      await pool.query(
        'INSERT INTO grid_cells(study_area_id,i,j,geom) VALUES($1,1,0,ST_GeomFromEWKT($2))',
        [area, old.geom],
      );
    }
    await pool.query(
      "UPDATE concentration_columns SET c_ug_m3='{1,NULL,NULL,23}' WHERE run_id=$1 AND i=0 AND j=0",
      [run],
    );
    try {
      await query()
        .send(
          await body([
            [686001, 1191302],
            [686002, 1191302],
          ]),
        )
        .expect(409);
    } finally {
      await pool.query(
        "UPDATE concentration_columns SET c_ug_m3='{NULL,NULL,NULL,23}' WHERE run_id=$1 AND i=0 AND j=0",
        [run],
      );
    }
  });
  it('queries never create runs or artifacts, including rejected requests', async () => {
    const counts = async () =>
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM simulation_runs)::int AS runs,(SELECT count(*) FROM artifacts)::int AS artifacts',
        )
      ).rows[0];
    const before = await counts();
    const b = await body();
    await query().send(b).expect(200);
    await http().post(`/api/runs/${run}/transect/csv`).send(b).expect(200);
    await query()
      .send({ ...b, step_m: 0 })
      .expect(400);
    expect(await counts()).toEqual(before);
  });
});
