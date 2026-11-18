import { describe, expect, test } from 'vitest';
import { translate } from '../i18n';
import type { Locale } from '../i18n';
import type { RunEntry } from '../store/types';
import { milestones } from './heightMarks';
import { isMockRun, runLabel, seasonKey } from './labels';

const entry = (overrides: Partial<RunEntry> = {}): RunEntry => ({
  id: '2a3a9f00-0000-4000-8000-000000000000',
  scenario_id: 'dry_nov_apr',
  name: 'Dry Nov–Apr',
  emission_multiplier: 1,
  wind_from_deg: 112,
  wind_speed_m_s: 1.62,
  model: 'fv',
  model_version: '0.1.0',
  warnings: [],
  ...overrides,
});
const t = (locale: Locale) => (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate(locale, key, params);

describe('run labels', () => {
  test('season keys match scenario prefixes only', () => {
    expect(seasonKey('dry_nov_apr')).toBe('viewer.scenarioDry');
    expect(seasonKey('wet_may_oct_v2')).toBe('viewer.scenarioWet');
    expect(seasonKey('x_dry_nov_apr')).toBeNull();
    expect(seasonKey('')).toBeNull();
  });

  test('label carries season, model and the untranslated 4-character id suffix in both languages', () => {
    expect(runLabel(entry(), t('en'))).toBe('Dry season, Voxel, 2a3a');
    expect(runLabel(entry({ scenario_id: 'wet_may_oct', model: 'gaussian' }), t('vi'))).toBe('Mùa mưa, Gaussian, 2a3a');
  });

  test('source reductions are shown as whole percentages without float noise', () => {
    // 1 − 0.8 is 0.19999999999999996 in binary floating point.
    expect(runLabel(entry({ emission_multiplier: 0.8 }), t('en'))).toBe('Dry season, Voxel, Reduced 20%, 2a3a');
    expect(runLabel(entry({ emission_multiplier: 0.6 }), t('vi'))).toBe('Mùa khô, Voxel, Giảm 40%, 2a3a');
  });

  test('an unknown scenario falls back to its name, then to its id', () => {
    expect(runLabel(entry({ scenario_id: 'custom', name: 'Custom wind' }), t('en'))).toBe('Custom wind, Voxel, 2a3a');
    expect(runLabel(entry({ scenario_id: 'custom', name: '' }), t('en'))).toBe('custom, Voxel, 2a3a');
    expect(runLabel(entry({ scenario_id: '', name: '' }), t('en'))).toBe('2a3a9f00-0000-4000-8000-000000000000, Voxel, 2a3a');
  });

  test('mock runs are labelled as test data whatever their model', () => {
    const mock = entry({ warnings: ['solver: mock run, synthetic field'] });
    expect(isMockRun(mock)).toBe(true);
    expect(isMockRun(entry({ warnings: ['Mock Run'] }))).toBe(false);
    expect(runLabel(mock, t('en'))).toBe('Dry season, Test data, 2a3a');
  });
});

describe('height milestones', () => {
  const heights = Array.from({ length: 50 }, (_, k) => k * 2 + 1);

  test('picks real voxel-centre heights at 0, 25, 50, 75 and 100 % of the slider', () => {
    const marks = milestones(heights, 'en');
    expect(marks.map((m) => m.index)).toEqual([0, 12, 25, 37, 49]);
    expect(marks.map((m) => m.height)).toEqual([1, 25, 51, 75, 99]);
    expect(marks[0].position).toBe(0);
    expect(marks.at(-1)!.position).toBe(100);
    expect(marks[2].position).toBeCloseTo((25 / 49) * 100, 12);
    expect(marks.map((m) => m.label)).toEqual(['1 m', '25 m', '51 m', '75 m', '99 m']);
  });

  test('deduplicates marks on short grids', () => {
    expect(milestones([1, 3], 'en').map((m) => m.index)).toEqual([0, 1]);
    expect(milestones([1.5], 'en')).toEqual([{ index: 0, height: 1.5, position: 0, label: '1.5 m' }]);
    expect(milestones([], 'en')).toEqual([]);
  });

  test('formats labels with the locale decimal separator and at most two decimals', () => {
    expect(milestones([0.125, 1234.5], 'vi').map((m) => m.label)).toEqual(['0,13 m', '1.234,5 m']);
    expect(milestones([0.125, 1234.5], 'en').map((m) => m.label)).toEqual(['0.13 m', '1,234.5 m']);
  });
});
