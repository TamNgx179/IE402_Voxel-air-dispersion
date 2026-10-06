import { resolve } from 'node:path';
import { APP_ROOT } from '../config/env.validation.js';
import {
  buildRunSnapshot,
  loadProjectConfig,
  projectConfigPath,
  scenariosFromConfig,
  thresholdsFromConfig,
} from './project-config.js';

describe('project config (config/project.yaml)', () => {
  const path = projectConfigPath(resolve(APP_ROOT, '..'));

  it('extracts the meteorology scenarios', async () => {
    const { data, sha256 } = await loadProjectConfig(path);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    const scenarios = scenariosFromConfig(data);
    expect(scenarios.map((s) => s.id)).toEqual(
      expect.arrayContaining(['dry_nov_apr', 'wet_may_oct']),
    );
    for (const s of scenarios) {
      expect(s.wind_from_deg).toBeGreaterThanOrEqual(0);
      expect(s.wind_from_deg).toBeLessThan(360);
      expect(s.wind_speed_m_s).toBeGreaterThanOrEqual(0);
    }
  });

  it('extracts the thresholds with their labels', async () => {
    const { data } = await loadProjectConfig(path);
    const thresholds = thresholdsFromConfig(data);
    expect(thresholds.find((t) => t.key === 'qcvn_24h')).toMatchObject({
      value_ug_m3: expect.any(Number),
      label: expect.any(String),
    });
  });

  it('rejects malformed sections', () => {
    expect(() => scenariosFromConfig({})).toThrow(/meteorology/);
    expect(() =>
      scenariosFromConfig({
        meteorology: {
          scenarios: { a: { direction_from_deg: 'x', speed_m_s: 1 } },
        },
      }),
    ).toThrow(/direction_from_deg/);
    expect(() =>
      thresholdsFromConfig({
        analysis: { thresholds_ug_m3: { a: { value: 0 } } },
      }),
    ).toThrow(/> 0/);
  });

  it('adds a run block to the snapshot without touching the source', () => {
    const src = { grid: { dx_m: 5 } };
    const snap = buildRunSnapshot(src, {
      run_id: 'r',
      scenario_id: 's',
      model: 'fv',
    });
    expect(snap).toEqual({
      grid: { dx_m: 5 },
      run: { run_id: 'r', scenario_id: 's', model: 'fv' },
    });
    expect(src).not.toHaveProperty('run');
  });
});
