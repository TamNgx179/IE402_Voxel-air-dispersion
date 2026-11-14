/**
 * Dictionary typing. English dictionaries are the source of truth: every
 * Vietnamese namespace is typed as `Messages<typeof en>` so a missing or extra
 * key is a compile error.
 */
export type Messages<T> = { readonly [K in keyof T]: string };

export const LOCALES = ['en', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** BCP 47 tags used for Intl number formatting and `<html lang>`. */
export const LOCALE_TAGS: Record<Locale, string> = { en: 'en-US', vi: 'vi-VN' };

export type TranslationParams = Record<string, string | number>;
