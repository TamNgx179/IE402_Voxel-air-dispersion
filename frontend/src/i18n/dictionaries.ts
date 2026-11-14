/**
 * Namespace registry. To add a namespace:
 *   1. create `en/<ns>.ts` (`const x = {...} as const; export default x;`)
 *   2. create `vi/<ns>.ts` typed `Messages<typeof en>`
 *   3. add both imports below (one line each in `en` and `vi`).
 * Keys are referenced as `t('<ns>.<key>')` and are fully type-checked.
 */
import type { Messages } from './types';

import enCommon from './en/common';
import enErrors from './en/errors';
import enViewer from './en/viewer';
import enEvidence from './en/evidence';
import enSimulation from './en/simulation';
import enMapOptions from './en/mapOptions';
import enStats from './en/stats';
import enAnalysis from './en/analysis';
import enRegion from './en/region';
import enCompare from './en/compare';
import enTransect from './en/transect';
import enCorridor from './en/corridor';
import enIllustration from './en/illustration';

import viCommon from './vi/common';
import viErrors from './vi/errors';
import viViewer from './vi/viewer';
import viEvidence from './vi/evidence';
import viSimulation from './vi/simulation';
import viMapOptions from './vi/mapOptions';
import viStats from './vi/stats';
import viAnalysis from './vi/analysis';
import viRegion from './vi/region';
import viCompare from './vi/compare';
import viTransect from './vi/transect';
import viCorridor from './vi/corridor';
import viIllustration from './vi/illustration';

export const en = {
  common: enCommon,
  errors: enErrors,
  viewer: enViewer,
  evidence: enEvidence,
  simulation: enSimulation,
  mapOptions: enMapOptions,
  stats: enStats,
  analysis: enAnalysis,
  region: enRegion,
  compare: enCompare,
  transect: enTransect,
  corridor: enCorridor,
  illustration: enIllustration,
} as const;

export type Dictionary = { readonly [NS in keyof typeof en]: Messages<(typeof en)[NS]> };

export const vi: Dictionary = {
  common: viCommon,
  errors: viErrors,
  viewer: viViewer,
  evidence: viEvidence,
  simulation: viSimulation,
  mapOptions: viMapOptions,
  stats: viStats,
  analysis: viAnalysis,
  region: viRegion,
  compare: viCompare,
  transect: viTransect,
  corridor: viCorridor,
  illustration: viIllustration,
};

export type Namespace = keyof typeof en;

/** Every valid key, e.g. `'viewer.heightLabel'`. */
export type TranslationKey = {
  [NS in Namespace]: `${NS}.${Extract<keyof (typeof en)[NS], string>}`;
}[Namespace];

export const dictionaries = { en: en as Dictionary, vi } as const;
