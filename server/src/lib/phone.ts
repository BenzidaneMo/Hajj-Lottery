/**
 * Server-only phone helpers.
 *
 * `normalizePhoneNumber`/`isValidPhoneNumber` live in `shared/src/phone.ts`
 * now — the registration form needs the identical rule while the citizen is
 * still typing — and are re-exported here so existing server imports are
 * unaffected. `maskPhoneNumber` stays server-only: it exists for logs and
 * support screens, which have no client-side equivalent.
 */
import { COUNTRY_CALLING_CODE, isValidPhoneNumber } from '@hajj-lottery/shared'

export { isValidPhoneNumber, normalizePhoneNumber } from '@hajj-lottery/shared'

/**
 * Last 2 digits only, for logs and support screens: enough to confirm a
 * number with the person who owns it, useless to anyone else.
 */
export function maskPhoneNumber(canonical: string): string {
  if (!isValidPhoneNumber(canonical)) return '(invalid)'
  return `+${COUNTRY_CALLING_CODE}·······${canonical.slice(-2)}`
}
