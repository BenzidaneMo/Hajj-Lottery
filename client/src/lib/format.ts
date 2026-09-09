import type { SupportedLocale } from '@hajj-lottery/shared'

/**
 * Locale-correct numbers and dates for the public pages.
 *
 * Two decisions worth stating.
 *
 * **The locale tags are Algerian.** `ar` becomes `ar-DZ` rather than bare `ar`,
 * which matters: the generic Arabic locale renders numerals in Arabic-Indic
 * form (٤٢), while Algeria writes them in the Western form the whole country's
 * paperwork uses. A citizen comparing a printed result against this page must
 * see the same digits on both.
 *
 * **Nothing is concatenated.** Every string a citizen reads is assembled by
 * i18next interpolation from a translated template, so a translator can put the
 * number where their language puts it. These helpers only produce the values
 * that go into those templates.
 */

const INTL_LOCALES: Record<SupportedLocale, string> = {
  ar: 'ar-DZ',
  fr: 'fr-DZ',
  en: 'en-GB',
}

export function intlLocale(locale: SupportedLocale): string {
  return INTL_LOCALES[locale] ?? INTL_LOCALES.en
}

/** A count, grouped the way the active language groups digits. */
export function formatNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}

/**
 * A year, ungrouped.
 *
 * `2027`, never `2,027`. A draw year is a label rather than a quantity, and
 * grouping it would make it read as one.
 */
export function formatYear(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), { useGrouping: false }).format(value)
}

/** A day, for anything a citizen might quote back to an office. */
export function formatDate(iso: string, locale: SupportedLocale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'long' }).format(date)
}

/** A day and a time, for the moments that need one — publication, submission. */
export function formatDateTime(iso: string, locale: SupportedLocale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: 'long', timeStyle: 'short' }).format(date)
}
