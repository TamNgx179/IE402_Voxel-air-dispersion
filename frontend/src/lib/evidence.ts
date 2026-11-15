/** Building provenance included in the exported report. */
import type { TranslationKey } from '../i18n/dictionaries';
import type { FeatureCollection, Provenance } from '../api/types';

export type QualityKey = 'gob' | 'tagged' | 'levels' | 'fallback' | 'unknown';

export interface DataQuality {
  state: 'missing' | 'ready' | 'empty';
  total: number | null;
  counts?: Record<QualityKey, number>;
  groups: Array<{ key: QualityKey; labelKey: TranslationKey; count: number }>;
  footprint_source?: string | null;
  height_source?: string | null;
  geometry?: 'LoD1';
  terrain?: 'flat';
  materials?: 'illustrative';
}

/** Count actual scene attributes; never infer measurement quality from a height alone. */
export function dataQuality(
  buildings: Pick<FeatureCollection, 'features'> | null | undefined | { features?: unknown },
  provenance: Provenance = {},
): DataQuality {
  const features = (buildings as { features?: unknown } | null | undefined)?.features;
  if (!Array.isArray(features)) return { state: 'missing', total: null, groups: [] };
  const counts: Record<QualityKey, number> = { gob: 0, tagged: 0, levels: 0, fallback: 0, unknown: 0 };
  for (const feature of features as Array<{ properties?: Record<string, unknown> } | null>) {
    const p = feature?.properties || {},
      source = String(p.height_source || '');
    const valid = typeof p.height_m === 'number' && Number.isFinite(p.height_m) && p.height_m > 0;
    const key: QualityKey = !valid
      ? 'unknown'
      : /^gob:/.test(source)
        ? 'gob'
        : /^(direct:)/.test(source) || source === 'osm:height'
          ? 'tagged'
          : /^levels:/.test(source) || source === 'osm:building:levels'
            ? 'levels'
            : /^(fallback|median|fixed)(:|$)/.test(source) || source === 'derived:median'
              ? 'fallback'
              : 'unknown';
    counts[key]++;
  }
  return {
    state: features.length ? 'ready' : 'empty',
    total: features.length,
    counts: { ...counts },
    groups: (Object.entries(counts) as Array<[QualityKey, number]>)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => ({ key, labelKey: `evidence.quality.group.${key}` as TranslationKey, count })),
    footprint_source: typeof provenance.buildings?.footprint === 'string' ? provenance.buildings.footprint : null,
    height_source: typeof provenance.buildings?.height === 'string' ? provenance.buildings.height : null,
    geometry: 'LoD1',
    terrain: 'flat',
    materials: 'illustrative',
  };
}
