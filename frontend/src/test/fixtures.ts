/** Shared test fixtures: a 2×2×3 study area and an in-memory API. */
import { ApiError } from '../api/client';
import type { ApiFn } from '../store/controller';

export const fixtureArea = {
  id: 'area-1',
  name: 'Nguyen Hue',
  srid: 32648,
  grid: { origin_x_m: 0, origin_y_m: 0, dx_m: 5, dy_m: 5, dz_m: 2, nx: 2, ny: 2, nz: 3 },
  bounds: [106.7, 10.77, 106.71, 10.78] as [number, number, number, number],
  bounds_projected: [0, 0, 10, 10],
  geometry: {},
  scene_version: 's1',
  provenance: { buildings: { footprint: 'OpenStreetMap contributors', height: 'GOB' } },
};

const run = (id: string, extra: Record<string, unknown> = {}) => ({
  run_id: id,
  scenario_id: 'dry_nov_apr',
  scenario_name: 'Dry',
  emission_multiplier: 1,
  wind_from_deg: 90,
  wind_speed_m_s: 1.5,
  model: 'fv',
  model_version: '1',
  warnings: [],
  ...extra,
});

export function fakeApi(overrides: Record<string, unknown> = {}): ApiFn & { calls: string[] } {
  const calls: string[] = [];
  const routes: Record<string, unknown> = {
    '/study-areas': [fixtureArea],
    '/scenarios': [{ id: 'dry_nov_apr', study_area_id: 'area-1', name: 'Dry', wind_from_deg: 90, wind_speed_m_s: 1.5, parameters: {} }],
    '/thresholds': [{ key: 'who_24h', value_ug_m3: 15, label: 'WHO 24h' }],
    '/runs?status=succeeded&limit=20': [run('mock-run', { warnings: ['mock run'] }), run('real-run')],
    '/study-areas/area-1/scene': {
      study_area_id: 'area-1',
      buildings: { type: 'FeatureCollection', features: [] },
      roads: { type: 'FeatureCollection', features: [] },
      water: { type: 'FeatureCollection', features: [] },
      green: { type: 'FeatureCollection', features: [] },
    },
    ...overrides,
  };
  const fn = (async (path: string) => {
    calls.push(path);
    const runMatch = path.match(/^\/runs\/([^/?]+)\/(volume|summary|artifacts)$/);
    if (path in routes) {
      const value = routes[path];
      if (value instanceof Error) throw value;
      return structuredClone(value);
    }
    if (runMatch) {
      const [, id, kind] = runMatch;
      if (kind === 'volume')
        return { run_id: id, shape: [3, 2, 2], axis_order: 'z,y,x', units: 'ug m-3', codes_base64: btoa('\x00\x01\x02\xff'.repeat(3)), scale: { c_max: 100, decades: 4, levels: 254, first_code: 2 } };
      if (kind === 'summary')
        return { run_id: id, model: 'fv', layers: [{ k: 0, z_m: 1, air_cells: 3, mean_ug_m3: 30, max_ug_m3: 90 }], thresholds: [], warnings: [], verification: null, metrics: null, units: 'ug m-3', grid: fixtureArea.grid, emission_multiplier: 1, model_version: '1', input_hash: 'h' };
      return { run_id: id, artifacts: [] };
    }
    if (path.startsWith('/runs/real-run/exceedance')) return { area_m2: 25 };
    if (path.startsWith('/runs/real-run/profile'))
      return { run_id: 'real-run', i: 1, j: 0, units: 'ug m-3', centre: {}, levels: [{ k: 0, z_m: 1, concentration_ug_m3: 12 }] };
    throw new ApiError('not-found', 404);
  }) as ApiFn & { calls: string[] };
  fn.calls = calls;
  return fn;
}

