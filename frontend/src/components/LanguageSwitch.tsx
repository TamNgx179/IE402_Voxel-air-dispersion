import { useI18n, type Locale } from '../i18n';

const OPTIONS: Array<{ locale: Locale; short: string; lang: string }> = [
  { locale: 'en', short: 'EN', lang: 'en' },
  { locale: 'vi', short: 'VI', lang: 'vi' },
];

/** Visible EN/VI switch. Changing language keeps run, layer and map state. */
export function LanguageSwitch() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('common.languageSwitch')}>
      {OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          lang={option.lang}
          aria-pressed={locale === option.locale}
          aria-label={option.locale === 'en' ? t('common.switchToEnglish') : t('common.switchToVietnamese')}
          title={option.locale === 'en' ? t('common.languageEnglish') : t('common.languageVietnamese')}
          onClick={() => setLocale(option.locale)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
