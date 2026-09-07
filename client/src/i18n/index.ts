import { DEFAULT_LOCALE, isRtlLocale, isSupportedLocale, type SupportedLocale } from '@hajj-lottery/shared'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import ar from './locales/ar.json'
import en from './locales/en.json'
import fr from './locales/fr.json'

const STORAGE_KEY = 'hajj-lottery.locale'

function readStoredLocale(): SupportedLocale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && isSupportedLocale(stored)) return stored
  } catch {
    // localStorage may be unavailable (e.g. privacy mode) — fall back silently.
  }
  return DEFAULT_LOCALE
}

/** Applies the language's writing direction to the document root. */
export function applyDocumentDirection(locale: SupportedLocale): void {
  document.documentElement.lang = locale
  document.documentElement.dir = isRtlLocale(locale) ? 'rtl' : 'ltr'
}

export function setLocale(locale: SupportedLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Ignore storage failures; the in-memory language still switches.
  }
  void i18n.changeLanguage(locale)
}

const initialLocale = readStoredLocale()

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initialLocale,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
})

applyDocumentDirection(initialLocale)
i18n.on('languageChanged', (lng) => {
  if (isSupportedLocale(lng)) applyDocumentDirection(lng)
})

export default i18n
