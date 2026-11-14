// Ported from web/tests/viewer-evidence.test.cjs (model parts) and the milestone test of viewer-sidebar.test.cjs.
import { describe, expect, test } from 'vitest';
import type { RunSummary } from '../api/types';
import { dataQuality, hasDataWarning, number, viewModel } from './evidence';
import { milestones } from './heightMarks';
import { translate } from '../i18n';

const summary = (): RunSummary => ({
  run_id: 'run-one',
  model: 'fv',
  model_version: '0.1.0+abcdef1',
  input_hash: 'sha256:' + 'a'.repeat(64),
  units: 'ug m-3',
  emission_multiplier: 1,
  grid: { origin_x_m: 0, origin_y_m: 0, dx_m: 5, dy_m: 5, dz_m: 2, nx: 1, ny: 1, nz: 1 },
  layers: [],
  thresholds: [],
  warnings: ['LoD1; not field validation'],
  verification: {
    status: 'pass',
    checks: [
      { name: 'mass_balance', status: 'pass', value: 1e-14, tolerance: 1e-6 },
      { name: 'positivity', status: 'pass', value: 0, tolerance: 1e-9 },
    ],
  },
  metrics: {
    wall_clock_s: 60,
    simulated_s: 660,
    steps: 5324,
    dt_s: 0.124,
    emitted_kg: 0.002,
    remaining_kg: 0.0005,
    escaped_kg: 0.0015,
    correction_kg: 0,
    stopping_criterion: 'steady_state',
    convergence_history: [{ relative_l1_change: 9e-5 }],
  },
});

const metric = (model: ReturnType<typeof viewModel>, key: string) => model.metrics!.find(([name]) => name === key)![1];

describe('run evidence', () => {
  test('empty and stale-run summaries cannot show verification pass', () => {
    expect(viewModel(null, null).state).toBe('empty');
    const model = viewModel(summary(), 'different-run');
    expect(model.state).toBe('error');
    expect(model.identity).toBeUndefined();
  });

  test('dashboard preserves full identity, exact metrics and warnings', () => {
    const model = viewModel(summary(), 'run-one');
    expect(model.state).toBe('pass');
    expect(translate('vi', model.message.key, model.message.params)).toMatch(/2\/2 kiểm tra đạt/);
    expect(translate('en', model.message.key, model.message.params)).toBe('2/2 checks passed');
    expect(model.identity!.find(([name]) => name === 'evidence.identity.inputHash')).toEqual([
      'evidence.identity.inputHash',
      'sha256:' + 'a'.repeat(64),
    ]);
    expect(metric(model, 'evidence.metric.correction')).toBe('0 kg');
    expect(metric(model, 'evidence.metric.residual')).toMatch(/e-5/);
    expect(metric(model, 'evidence.metric.stopping')).toBe('steady_state');
    expect(model.warnings![0]).toBe('LoD1; not field validation');
    expect(hasDataWarning(model.warnings)).toBe(false);
    expect(hasDataWarning(['mock run'])).toBe(true);
  });

  test('empty checks and contradictory check status never look verified', () => {
    const data = summary();
    data.verification!.checks = [];
    expect(viewModel(data, data.run_id).state).toBe('unverified');
    data.verification!.checks = [{ name: 'mass_balance', status: 'fail', value: 0.1, tolerance: 1e-6 }];
    expect(viewModel(data, data.run_id).state).toBe('unverified');
  });

  test('missing measurements are distinct from zero', () => {
    expect(number(undefined)).toBeNull();
    expect(number(null)).toBeNull();
    expect(number(NaN)).toBeNull();
    expect(number(Infinity)).toBeNull();
    expect(number(0, 'kg')).toBe('0 kg');
    const model = viewModel({ ...summary(), metrics: null }, 'run-one');
    expect(metric(model, 'evidence.metric.massError')).toBeNull();
  });

  test('numbers are formatted per locale with 5 significant digits', () => {
    expect(number(5324, '', 'en')).toBe('5,324');
    expect(number(5324, '', 'vi')).toBe('5.324');
    expect(number(0.124, 's', 'vi')).toBe('0,124 s');
    expect(number(0.124, 's', 'en')).toBe('0.124 s');
  });

  test('known checks have translated names; unknown keep the raw name', () => {
    const data = summary();
    data.verification!.checks.push({ name: 'custom_check', status: 'pass', value: 1, tolerance: 2 });
    const checks = viewModel(data, data.run_id).checks!;
    expect(translate('vi', checks[0].nameKey!)).toBe('Bảo toàn khối lượng');
    expect(translate('en', checks[0].nameKey!)).toBe('Mass conservation');
    expect(checks[2].nameKey).toBeNull();
    expect(checks[2].name).toBe('custom_check');
  });
});

// Unknown tags must not silently be described as measured or fallback heights.
describe('scene data quality', () => {
  test('distinguishes satellite, tagged, derived, fallback and unknown', () => {
    const scene = {
      features: ['gob:building_height', 'direct:height', 'levels:building:levels', 'fallback:fixed', 'unresolved', 'new-provider'].map(
        (height_source) => ({ properties: { height_source, height_m: 20 } }),
      ),
    };
    const q = dataQuality(scene, { buildings: { footprint: 'OpenStreetMap contributors' } });
    expect(q.total).toBe(6);
    expect(q.groups.map((g) => [g.key, g.count])).toEqual([
      ['gob', 1],
      ['tagged', 1],
      ['levels', 1],
      ['fallback', 1],
      ['unknown', 2],
    ]);
    expect(q.footprint_source).toBe('OpenStreetMap contributors');
    expect(q.terrain).toBe('flat');
    expect(dataQuality(null).total).toBeNull();
    expect(dataQuality({ features: [] }).state).toBe('empty');
    expect(dataQuality({ features: [{ properties: { height_source: 'gob:x', height_m: null } }] }).groups[0].key).toBe('unknown');
  });

  test('upstream OSM and derived-median provenance tags are classified explicitly', () => {
    for (const [height_source, key] of [
      ['osm:height', 'tagged'],
      ['osm:building:levels', 'levels'],
      ['derived:median', 'fallback'],
    ])
      expect(dataQuality({ features: [{ properties: { height_source, height_m: 12 } }] }).groups[0].key).toBe(key);
  });
});

describe('height milestones', () => {
  test('altitude milestones are actual voxel centres at proportional slider positions', () => {
    const list = milestones(Array.from({ length: 50 }, (_, k) => k * 2 + 1));
    expect(list.map((x) => x.index)).toEqual([0, 12, 25, 37, 49]);
    expect(list.map((x) => x.label)).toEqual(['1 m', '25 m', '51 m', '75 m', '99 m']);
    expect(list[1].position).toBe((12 / 49) * 100);
    expect(list[2].position).toBe((25 / 49) * 100);
    expect(milestones([1]).length).toBe(1);
    expect(milestones([1, 3]).length).toBe(2);
    expect(milestones([])).toEqual([]);
  });

  test('labels follow the locale decimal separator', () => {
    expect(milestones([2.5, 7.5], 'en').map((m) => m.label)).toEqual(['2.5 m', '7.5 m']);
    expect(milestones([2.5, 7.5], 'vi').map((m) => m.label)).toEqual(['2,5 m', '7,5 m']);
  });
});
