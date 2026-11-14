/** Localised labels for runs and scenarios (legacy scenarioLabel / SCENARIO_NAMES / MODEL_NOTES). */
import type { TranslationKey } from '../i18n/dictionaries';
import type { TranslationParams } from '../i18n/types';
import type { RunEntry } from '../store/types';

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

const SEASON_KEYS: Record<string, TranslationKey> = {
  dry_nov_apr: 'viewer.scenarioDry',
  wet_may_oct: 'viewer.scenarioWet',
};

/** Season name for a scenario id prefix, or `null` for unknown scenarios. */
export function seasonKey(scenarioId: string): TranslationKey | null {
  const season = Object.keys(SEASON_KEYS).find((key) => scenarioId.startsWith(key));
  return season ? SEASON_KEYS[season] : null;
}

export function isMockRun(entry: Pick<RunEntry, 'warnings'>): boolean {
  return entry.warnings.some((warning) => /mock run/.test(warning));
}

/** e.g. "Dry season · Voxel · Reduced 20% · 2a3a". The 4-char id suffix is not translated. */
export function runLabel(entry: RunEntry, t: Translate): string {
  const scenarioId = entry.scenario_id || entry.id;
  const key = seasonKey(scenarioId);
  const name = key ? t(key) : entry.name || scenarioId;
  const kind = isMockRun(entry) ? t('viewer.labelMock') : entry.model === 'fv' ? t('viewer.labelVoxel') : t('viewer.labelGaussian');
  const reduction = Math.round((1 - (entry.emission_multiplier ?? 1)) * 100);
  return `${name} · ${kind}${reduction ? ` · ${t('viewer.labelReduction', { percent: reduction })}` : ''} · ${entry.id.slice(0, 4)}`;
}

export function modelNoteKey(model: string | undefined): TranslationKey {
  if (model === undefined) return 'viewer.modelNoteNone';
  if (model === 'gaussian') return 'viewer.modelNoteGaussian';
  if (model === 'fv') return 'viewer.modelNoteFv';
  return 'viewer.modelNoteOther';
}
