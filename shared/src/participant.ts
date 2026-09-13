import type { ApplicantGender } from './application.js'
import type { SupportedLocale } from './locale.js'

/**
 * A participant identity record, as exposed by the participant API.
 *
 * This is the administrative view: it carries the national ID, so it must
 * only ever be returned from access-controlled endpoints. It deliberately
 * has no draw year, commune, status or weight — those belong to the annual
 * application models, which reference a participant by `id`.
 */
export interface ParticipantDto {
  id: string
  nationalId: string
  firstNameAr: string
  lastNameAr: string
  firstNameLatin: string
  lastNameLatin: string
  /** Calendar date, `YYYY-MM-DD`. No time component. */
  dob: string
  gender: ApplicantGender
  phoneNumber: string
  hasWonHajj: boolean
  createdAt: string
  updatedAt: string
}

/**
 * A single-line display name, for contexts that show one label rather than
 * four fields (a card title, a breadcrumb). Picks the script by locale
 * rather than concatenating both — showing both at once belongs to a table
 * or a review screen, not a one-line label.
 */
export function formatParticipantName(
  name: { firstNameAr: string; lastNameAr: string; firstNameLatin: string; lastNameLatin: string },
  locale: SupportedLocale,
): string {
  return locale === 'ar'
    ? `${name.firstNameAr} ${name.lastNameAr}`
    : `${name.firstNameLatin} ${name.lastNameLatin}`
}
