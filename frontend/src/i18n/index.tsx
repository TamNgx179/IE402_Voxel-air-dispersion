import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dictionaries, type TranslationKey } from './dictionaries';
import { DEFAULT_LOCALE, LOCALES, LOCALE_TAGS, type Locale, type TranslationParams } from './types';

export type { Locale, TranslationParams } from './types';
export type { TranslationKey, Namespace } from './dictionaries';
export { LOCALES, LOCALE_TAGS, DEFAULT_LOCALE } from './types';

export const LOCALE_STORAGE_KEY = 'voxel-locale';

/** Look up `ns.key` and substitute `{name}` placeholders. Unknown keys return the key itself. */
export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  const dot = key.indexOf('.');
  const ns = key.slice(0, dot) as keyof (typeof dictionaries)['en'];
  const name = key.slice(dot + 1);
  const table = dictionaries[locale][ns] as Record<string, string> | undefined;
  const fallback = dictionaries.en[ns] as Record<string, string> | undefined;
  const template = table?.[name] ?? fallback?.[name] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, p: string) =>
    Object.prototype.hasOwnProperty.call(params, p) ? String(params[p]) : match,
  );
}

/**
 * Display number formatting (legacy `fmt`): "–" for null/NaN/±Infinity, "0" for
 * zero, otherwise 3 significant digits in the locale's separators. Pass options to
 * override (e.g. `{ maximumFractionDigits: 0 }`). Never use this for CSV/JSON.
 */
export function formatNumber(
  locale: Locale,
  value: number | null | undefined,
  options: Intl.NumberFormatOptions = { maximumSignificantDigits: 3 },
): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return '–';
  if (value === 0) return '0';
  return value.toLocaleString(LOCALE_TAGS[locale], options);
}

/** Rounded integer with grouping (legacy `fmtVolume`), used for areas and volumes. */
export function formatInteger(locale: Locale, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return value === 0 ? '0' : Math.round(value).toLocaleString(LOCALE_TAGS[locale]);
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

function storeLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* private mode or blocked storage: the choice lasts for this page only */
  }
}

export interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => string;
  formatInteger: (value: number | null | undefined) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale() ?? DEFAULT_LOCALE);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    storeLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'viewer.documentTitle');
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      formatNumber: (v, options) => formatNumber(locale, v, options),
      formatInteger: (v) => formatInteger(locale, v),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
