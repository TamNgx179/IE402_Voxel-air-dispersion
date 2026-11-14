/** Height milestones for the slider (port of ViewerSidebar.milestones). */
import { LOCALE_TAGS, type Locale } from '../i18n/types';

export interface Milestone {
  index: number;
  height: number;
  /** Percentage along the slider track. */
  position: number;
  /** Localised label such as "51 m". */
  label: string;
}

/** Actual voxel-centre heights at 0, 25, 50, 75 and 100 % of the slider, deduplicated. */
export function milestones(heights: readonly number[], locale: Locale = 'vi'): Milestone[] {
  if (!heights.length) return [];
  const last = heights.length - 1;
  return [...new Set([0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * last)))].map((index) => ({
    index,
    height: heights[index],
    position: last ? (index / last) * 100 : 0,
    label: `${Number(heights[index]).toLocaleString(LOCALE_TAGS[locale], { maximumFractionDigits: 2 })} m`,
  }));
}
