import { SUPPORTED_LOCALES, type SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { setLocale } from '../i18n'

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  ar: 'العربية',
  fr: 'Français',
  en: 'English',
}

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation()
  const current = i18n.language as SupportedLocale

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t('language.label')}</span>
      <select
        value={current}
        onChange={(event) => setLocale(event.target.value as SupportedLocale)}
        className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-700"
        aria-label={t('language.label')}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  )
}
