/**
 * The single place national IDs are normalized and validated.
 *
 * Every path into the system — API, seed, future imports and admin tools —
 * must go through `normalizeNationalId` before comparing or storing a
 * national ID, so one person can never end up with two identity records that
 * differ only in formatting.
 */
import { NATIONAL_ID_LENGTH, normalizeTypedNumber } from '@hajj-lottery/shared'

// Re-exported so callers keep importing identifier rules from one module,
// even though the constant is shared with the registration form.
export { NATIONAL_ID_LENGTH }

const CANONICAL_PATTERN = new RegExp(`^\\d{${NATIONAL_ID_LENGTH}}$`)

/**
 * Canonical form of a national ID: Arabic-Indic digits folded to ASCII and
 * grouping separators removed. Does not validate — call `isValidNationalId`
 * on the result. Never strips leading zeros or otherwise reinterprets the
 * number.
 */
export function normalizeNationalId(raw: string): string {
  return normalizeTypedNumber(raw)
}

/** True when `value` is already in canonical form and structurally valid. */
export function isValidNationalId(value: string): boolean {
  return CANONICAL_PATTERN.test(value)
}
