/**
 * The single place phone numbers are normalized and validated.
 *
 * A phone number is contact information, never a credential — nothing
 * authenticates on it. It is normalized anyway so that the same person typing
 * 0555…, +213555… or 00213555… does not end up with three different stored
 * values, and so a later notification run has one canonical form to dial.
 *
 * Shared rather than server-only because the registration form needs the
 * identical verdict while the citizen is still typing — a required field with
 * no client-side check would only discover an invalid number after a round
 * trip, and a looser client check than the server's would let the form accept
 * numbers the server then refuses.
 */
import { normalizeTypedNumber } from './digits.js'

/** Algeria. */
export const COUNTRY_CALLING_CODE = '213'

/**
 * The national significant number is 9 digits. Algerian mobile numbers begin
 * 5, 6 or 7 (written 05/06/07 nationally); this deliberately does not accept
 * landlines, since the number exists to reach an applicant about their
 * application.
 */
const MOBILE_PATTERN = /^[567]\d{8}$/

const CANONICAL_PATTERN = new RegExp(`^\\+${COUNTRY_CALLING_CODE}[567]\\d{8}$`)

/**
 * Canonical form: `+213` followed by the 9-digit national number.
 *
 * Accepts every way a citizen might write their own number — with or without
 * the national trunk `0`, with `+213`, `00213` or a bare `213` prefix, in
 * Arabic-Indic digits, and grouped with spaces or dashes. Returns the input
 * folded but otherwise unchanged when it is not recognizable, so the caller
 * can reject it rather than storing a guess.
 */
export function normalizePhoneNumber(raw: string): string {
  const folded = normalizeTypedNumber(raw)
  const digits = stripCallingCode(folded)

  return MOBILE_PATTERN.test(digits) ? `+${COUNTRY_CALLING_CODE}${digits}` : folded
}

/** Reduces any accepted prefix form to the 9-digit national number. */
function stripCallingCode(value: string): string {
  let digits = value

  // International prefixes, most specific first.
  if (digits.startsWith(`+${COUNTRY_CALLING_CODE}`)) {
    digits = digits.slice(COUNTRY_CALLING_CODE.length + 1)
  } else if (digits.startsWith(`00${COUNTRY_CALLING_CODE}`)) {
    digits = digits.slice(COUNTRY_CALLING_CODE.length + 2)
  } else if (digits.startsWith(COUNTRY_CALLING_CODE) && digits.length > 9) {
    // A bare 213… prefix, but only when what follows is long enough to be a
    // national number — "213456789" is itself a valid 9-digit number and must
    // not be mistaken for a country code.
    digits = digits.slice(COUNTRY_CALLING_CODE.length)
  }

  // National trunk prefix.
  if (digits.startsWith('0')) digits = digits.slice(1)

  return digits
}

/** True when `value` is already in canonical form. */
export function isValidPhoneNumber(value: string): boolean {
  return CANONICAL_PATTERN.test(value)
}
