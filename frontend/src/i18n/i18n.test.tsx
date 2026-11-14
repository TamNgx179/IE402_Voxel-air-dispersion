import { describe, expect, test } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { I18nProvider, LOCALE_STORAGE_KEY, formatInteger, formatNumber, translate, useI18n } from '.';
import { dictionaries } from './dictionaries';

function Probe() {
  const { t, locale, setLocale, formatNumber: fmt } = useI18n();
  return (
    <div>
      <span data-testid="text">{t('viewer.heightLabel')}</span>
      <span data-testid="num">{fmt(1234.5)}</span>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => setLocale(locale === 'en' ? 'vi' : 'en')}>toggle</button>
    </div>
  );
}

describe('i18n', () => {
  test('English is the default and Vietnamese is selectable, persisted and sets <html lang>', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('text').textContent).toBe('Height');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByTestId('num').textContent).toBe('1,230');
    act(() => screen.getByText('toggle').click());
    expect(screen.getByTestId('text').textContent).toBe('Độ cao');
    expect(screen.getByTestId('num').textContent).toBe('1.230');
    expect(document.documentElement.lang).toBe('vi');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('vi');
  });

  test('stored locale is restored and invalid values are ignored', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'vi');
    const { unmount } = render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('vi');
    unmount();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
  });

  test('blocked storage does not break locale switching', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      );
      act(() => screen.getByText('toggle').click());
      expect(screen.getByTestId('locale').textContent).toBe('vi');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  test('placeholders are substituted; missing params stay visible', () => {
    expect(translate('en', 'viewer.cellInfoHeader', { i: 1, j: 2, k: 3 })).toBe('Cell i=1, j=2 · level k=3');
    expect(translate('vi', 'viewer.cellInfoHeader', { i: 1 })).toBe('Ô i=1, j={j} · tầng k={k}');
  });

  test('number formatting follows the legacy fmt contract per locale', () => {
    for (const locale of ['en', 'vi'] as const) {
      expect(formatNumber(locale, null)).toBe('–');
      expect(formatNumber(locale, NaN)).toBe('–');
      expect(formatNumber(locale, Infinity)).toBe('–');
      expect(formatNumber(locale, 0)).toBe('0');
    }
    expect(formatNumber('en', 12.345)).toBe('12.3');
    expect(formatNumber('vi', 12.345)).toBe('12,3');
    expect(formatInteger('en', 12345.6)).toBe('12,346');
    expect(formatInteger('vi', 12345.6)).toBe('12.346');
  });

  test('every Vietnamese namespace has exactly the English keys and no empty strings', () => {
    for (const ns of Object.keys(dictionaries.en) as Array<keyof typeof dictionaries.en>) {
      const en = Object.keys(dictionaries.en[ns]).sort();
      const vi = Object.keys(dictionaries.vi[ns]).sort();
      expect(vi, ns).toEqual(en);
      for (const value of Object.values(dictionaries.vi[ns])) expect(value.trim().length).toBeGreaterThan(0);
      // Placeholders must match so substituted values are never lost in one language.
      for (const key of en) {
        const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const enText = (dictionaries.en[ns] as Record<string, string>)[key];
        const viText = (dictionaries.vi[ns] as Record<string, string>)[key];
        expect(names(viText), `${ns}.${key}`).toEqual(names(enText));
      }
    }
  });
});
