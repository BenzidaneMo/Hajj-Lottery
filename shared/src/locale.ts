/** Supported UI languages. Arabic is the RTL language of the three. */
export const SUPPORTED_LOCALES = ['ar', 'fr', 'en'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'ar'

const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(['ar'])

export function isRtlLocale(locale: SupportedLocale): boolean {
  return RTL_LOCALES.has(locale)
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}
