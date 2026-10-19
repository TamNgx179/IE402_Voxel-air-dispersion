import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parse } from 'csv-parse/sync';
import { createTestApp, prepareTestDatabase } from './support/test-db.js';

const db = await prepareTestDatabase();
describe.skipIf(!db.ok)('Spatial analysis with actual PostGIS', () => {
  let app: INestApplication;
  const pool = db.ok ? db.pool : (undefined as never);
  let baseline: string, comparison: string, area: string;
  const http = () => request(app.getHttpServer());
  const pair = (a = baseline, b = comparison, z = 1) =>
    `/api/runs/${a}/comparison?compare_run_id=${b}&z_m=${z}`;
  async function run(values: string[], model = 'fv') {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO simulation_runs(id,scenario_id,model,status,model_version,input_hash,finished_at)
      VALUES($1,'dry_nov_apr',$2,'succeeded','analysis-test',$3,now())`,
      [id, model, 'sha256:' + id],
    );
    for (let n = 0; n < 4; n++)
      await pool.query(
        'INSERT INTO concentration_columns(run_id,i,j,c_ug_m3) VALUES($1,$2,$3,$4)',
        [id, n % 2, Math.floor(n / 2), values[n]],
      );
    return id;
  }
  async function polygon(x1: number, y1: number, x2: number, y2: number) {
    return (
      await pool.query(
        `SELECT ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope($1,$2,$3,$4,32648),4326),15)::json AS p`,
        [x1, y1, x2, y2],
      )
    ).rows[0].p;
  }
  const body = async () => ({
    polygon: await polygon(686000.5, 1191300.5, 686007.5, 1191304.5),
    z_min_m: 1,
    z_max_m: 3,
    threshold_ug_m3: 15,
  });
  beforeAll(async () => {
    app = await createTestApp({
      DATABASE_URL: db.ok ? db.url : '',
      EXECUTOR_ENABLED: 'false',
    });
    area = (await pool.query('SELECT id FROM study_areas LIMIT 1')).rows[0].id;
    baseline = await run([
      '{NULL,NULL,5,2}',
      '{10,5,3,1}',
      '{20,10,5,2}',
      '{30,15,8,4}',
    ]);
    comparison = await run([
      '{NULL,NULL,5,2}',
      '{12,6,4,2}',
      '{18,9,4,1}',
      '{33,16,9,5}',
    ]);
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('returns exact positive/negative deltas, identity and requested/centre altitude', async () => {
    const { body: r } = await http().get(pair()).expect(200);
    expect(r).toMatchObject({
      baseline_run_id: baseline,
      comparison_run_id: comparison,
      k: 0,
      z_center_m: 1,
      units: 'ug m-3',
      delta_definition: 'comparison - baseline',
    });
    expect(
      r.feature_collection.features.map((f: any) => f.properties.delta_ug_m3),
    ).toEqual([2, -2, 3]);
    expect(r.stats.delta.mean_ug_m3).toBeCloseTo(1, 10);
    const top = await http()
      .get(pair(baseline, comparison, 2.1))
      .expect(200);
    expect(top.body).toMatchObject({ k: 1, requested_z_m: 2.1, z_center_m: 3 });
  });
  it('self comparison yields exactly zero and zero concentration is valid air', async () => {
    const self = await http().get(pair(baseline, baseline)).expect(200);
    expect(self.body.stats.delta).toEqual({
      mean_ug_m3: 0,
      min_ug_m3: 0,
      max_ug_m3: 0,
    });
    const zero = await run(Array(4).fill('{0,0,0,0}'));
    const response = await http().get(pair(zero, zero)).expect(200);
    expect(response.body.stats).toMatchObject({
      air_cells: 4,
      baseline: { mean_ug_m3: 0 },
    });
  });
  it('uses the stored float32 value exactly, not a rounded real text representation', async () => {
    const a = await run(Array(4).fill('{0.0230344,0,0,0}'));
    const b = await run(Array(4).fill('{0.0485567,0,0,0}'));
    const { body: r } = await http().get(pair(a, b)).expect(200);
    const p = r.feature_collection.features[0].properties;
    expect(p.baseline_ug_m3).toBe(Math.fround(0.0230344));
    expect(p.comparison_ug_m3).toBe(Math.fround(0.0485567));
    expect(p.delta_ug_m3).toBe(Math.fround(0.0485567) - Math.fround(0.0230344));
  });
  it('all-solid layer is empty, not a layer of zero concentrations', async () => {
    const solid = await run(Array(4).fill('{NULL,0,0,0}'));
    const response = await http().get(pair(solid, solid)).expect(200);
    expect(response.body.stats).toMatchObject({
      air_cells: 0,
      delta: { mean_ug_m3: null },
    });
  });
  it.each(['queued', 'running', 'failed', 'stale'])(
    'refuses either side of a %s pair and its region',
    async (status) => {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO simulation_runs(id,scenario_id,status,error_kind) VALUES($1,'dry_nov_apr',$2,$3)`,
        [id, status, status === 'failed' ? 'model' : null],
      );
      await http().get(pair(id, comparison)).expect(409);
      await http().get(pair(baseline, id)).expect(409);
      await http()
        .post(`/api/runs/${id}/region`)
        .send(await body())
        .expect(409);
      await http()
        .post(`/api/runs/${id}/region/csv`)
        .send(await body())
        .expect(409);
    },
  );
  it('rejects missing, malformed, unknown params, bad heights and unsupported bbox', async () => {
    await http().get(pair(randomUUID(), comparison)).expect(404);
    await http().get(pair(baseline, randomUUID())).expect(404);
    await http().get(pair(baseline, 'bad-id')).expect(400);
    await http().get(`/api/runs/${baseline}/comparison`).expect(400);
    for (const z of [-1, 8, Infinity])
      await http()
        .get(pair(baseline, comparison, z))
        .expect(400);
    await http()
      .get(pair() + '&extra=1')
      .expect(400);
    await http()
      .get(pair() + '&bbox=106,10,107,11')
      .expect(400);
  });
  it('refuses mismatched model, solid mask and missing columns', async () => {
    const other = await run(Array(4).fill('{0,0,0,0}'), 'gaussian');
    await http().get(pair(baseline, other)).expect(409);
    await pool.query("UPDATE simulation_runs SET model='fv' WHERE id=$1", [
      other,
    ]);
    await http().get(pair(baseline, other)).expect(409);
    await pool.query(
      'DELETE FROM concentration_columns WHERE run_id=$1 AND i=0 AND j=0',
      [other],
    );
    await http().get(pair(baseline, other)).expect(409);
  });
  it('refuses a second study area even if numeric grid happens to match', async () => {
    const otherArea = randomUUID(),
      scenario = 'other_' + randomUUID();
    await pool.query(
      `INSERT INTO study_areas(id,name,geom,grid,scene_version) SELECT $1,$2,geom,grid,scene_version FROM study_areas WHERE id=$3`,
      [otherArea, scenario, area],
    );
    await pool.query(
      `INSERT INTO scenarios(id,study_area_id,name,wind_speed_m_s,wind_from_deg,parameters) SELECT $1,$2,$1,wind_speed_m_s,wind_from_deg,parameters FROM scenarios LIMIT 1`,
      [scenario, otherArea],
    );
    const id = await run(Array(4).fill('{0,0,0,0}'));
    await pool.query('UPDATE simulation_runs SET scenario_id=$2 WHERE id=$1', [
      id,
      scenario,
    ]);
    await http().get(pair(baseline, id)).expect(409);
  });
  it('weights a partial cell and partial height; omits the adjacent solid cell', async () => {
    // Region intersects cell (0,0): 18 m², solid at k=0/1; (1,0): 10 m².
    // z=[1,3] intersects each of k=0 and k=1 by 1m -> volume 20m³, mean=(10+5)/2.
    const { body: r } = await http()
      .post(`/api/runs/${baseline}/region`)
      .send(await body())
      .expect(201);
    expect(r.area_m2).toBeCloseTo(28, 5);
    expect(r.air_volume_m3).toBeCloseTo(20, 5);
    expect(r.mean_ug_m3).toBeCloseTo(7.5, 5);
    expect(r.max_ug_m3).toBe(10);
    expect(r.exceedance_volume_m3).toBe(0);
    expect(r.layers).toHaveLength(2);
    expect(r.layers[0]).toMatchObject({ k: 0, z_center_m: 1, mean_ug_m3: 10 });
  });
  it('computes exceedance volume with fractional weights, not full cell counts', async () => {
    const q = { ...(await body()), threshold_ug_m3: 7 };
    const { body: r } = await http()
      .post(`/api/runs/${baseline}/region`)
      .send(q)
      .expect(201);
    expect(r.exceedance_volume_m3).toBeCloseTo(10, 5);
  });
  it('no air returns null mean/max while valid zero air returns mean 0', async () => {
    const q = {
      ...(await body()),
      polygon: await polygon(686000.5, 1191300.5, 686004.5, 1191304.5),
    };
    const { body: r } = await http()
      .post(`/api/runs/${baseline}/region`)
      .send(q)
      .expect(201);
    expect(r).toMatchObject({
      air_volume_m3: 0,
      mean_ug_m3: null,
      max_ug_m3: null,
      layers: [],
    });
    const zero = await run(Array(4).fill('{0,0,0,0}'));
    const { body: z } = await http()
      .post(`/api/runs/${zero}/region`)
      .send(q)
      .expect(201);
    expect(z.mean_ug_m3).toBe(0);
    expect(z.air_volume_m3).toBeCloseTo(32, 5);
  });
  it('supports holes and ignores pure boundary contact', async () => {
    const outer = await polygon(686000.1, 1191300.1, 686009.9, 1191309.9);
    const hole = await polygon(686006, 1191301, 686009, 1191304);
    const q = {
      ...(await body()),
      polygon: {
        type: 'Polygon',
        coordinates: [outer.coordinates[0], hole.coordinates[0]],
      },
      z_min_m: 0,
      z_max_m: 2,
    };
    const { body: r } = await http()
      .post(`/api/runs/${baseline}/region`)
      .send(q)
      .expect(201);
    // 3 air cells, each 4.9² m², minus a 3x3 hole in one air cell.
    expect(r.air_volume_m3).toBeCloseTo((3 * 4.9 * 4.9 - 9) * 2, 4);
  });
  it('rejects self intersections, outside domain, shape/coordinate limits and unknown keys', async () => {
    const q = await body();
    const self = await polygon(686001, 1191301, 686004, 1191304);
    const ring = self.coordinates[0];
    [ring[1], ring[2]] = [ring[2], ring[1]];
    for (const polygonValue of [
      self,
      await polygon(685999, 1191300, 686001, 1191302),
      { type: 'Point', coordinates: [106, 10] },
      { type: 'Polygon', coordinates: [] },
      {
        type: 'Polygon',
        coordinates: [
          [
            [106, 10],
            [106, 11],
            [107, 11],
            [107, 10],
          ],
        ],
      },
      { type: 'Polygon', coordinates: [Array(501).fill([106, 10])] },
      {
        type: 'Polygon',
        coordinates: Array(21).fill(q.polygon.coordinates[0]),
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [106, 10, 1],
            [106, 11, 1],
            [107, 11, 1],
            [106, 10, 1],
          ],
        ],
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [null, 10],
            [106, 11],
            [107, 11],
            [null, 10],
          ],
        ],
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [190, 10],
            [190, 11],
            [191, 11],
            [190, 10],
          ],
        ],
      },
      { type: 'Polygon', coordinates: q.polygon.coordinates, extra: true },
    ]) {
      await http()
        .post(`/api/runs/${baseline}/region`)
        .send({ ...q, polygon: polygonValue })
        .expect(400);
    }
    await http()
      .post(`/api/runs/${baseline}/region`)
      .send({ ...q, extra: true })
      .expect(400);
    await http().post(`/api/runs/${randomUUID()}/region`).send(q).expect(404);
  });
  it.each([
    [-1, 3],
    [3, 3],
    [4, 2],
    [0, 9],
  ])('rejects height interval [%s,%s]', async (min, max) => {
    await http()
      .post(`/api/runs/${baseline}/region`)
      .send({ ...(await body()), z_min_m: min, z_max_m: max })
      .expect(400);
  });
  it('allows the top of the domain exactly and exports matching CSV without new runs', async () => {
    const q = { ...(await body()), z_max_m: 8 };
    const before = Number(
      (await pool.query('SELECT count(*) AS n FROM simulation_runs')).rows[0].n,
    );
    const json = await http()
      .post(`/api/runs/${baseline}/region`)
      .send(q)
      .expect(201);
    const csv = await http()
      .post(`/api/runs/${baseline}/region/csv`)
      .send(q)
      .expect(201)
      .expect('Content-Type', /text\/csv/);
    const records = parse(csv.text, { columns: true });
    expect(records).toHaveLength(json.body.layers.length);
    expect(records[0]).toMatchObject({
      run_id: baseline,
      units: 'ug m-3',
      z_min_m: '1',
      z_max_m: '8',
    });
    for (let i = 0; i < records.length; i++)
      expect(Number(records[i].mean_ug_m3)).toBe(
        json.body.layers[i].mean_ug_m3,
      );
    expect(
      Number(
        (await pool.query('SELECT count(*) AS n FROM simulation_runs')).rows[0]
          .n,
      ),
    ).toBe(before);
  });
});
