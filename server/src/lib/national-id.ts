/**
 * The single place national IDs are normalized and validated.
 *
 * Every path into the system — API, seed, future imports and admin tools —
 * must go through `normalizeNationalId` before comparing or storing a
 * national ID, so one person can never end up with two identity records that
 * differ only in formatting.
 */

/** Algeria's Numéro d'Identification National is exactly 18 digits. */
export const NATIONAL_ID_LENGTH = 18

/**
 * Code points people type as grouping separators, or that an RTL keyboard
 * leaves behind invisibly. They carry no identity meaning, so they are
 * dropped. Listed as code points rather than a character class because most
 * of them are invisible and would make a regex literal unreviewable.
 *
 * Leading zeros are NOT in this table: they are part of the number.
 */
const SEPARATOR_CODE_POINTS = new Set([
  0x09, // tab
  0x0a, // line feed
  0x0b, // vertical tab
  0x0c, // form feed
  0x0d, // carriage return
  0x20, // space
  0xa0, // no-break space
  0x2007, // figure space
  0x202f, // narrow no-break space
  0x200b, // zero-width space
  0x200e, // left-to-right mark
  0x200f, // right-to-left mark
  0x061c, // Arabic letter mark
  0x2066, // left-to-right isolate
  0x2067, // right-to-left isolate
  0x2068, // first strong isolate
  0x2069, // pop directional isolate
  0x5f, // _
  0x2e, // .
  0x2f, // /
  0x5c, // \
  0x2d, // hyphen-minus
  0x2010, // hyphen
  0x2011, // non-breaking hyphen
  0x2012, // figure dash
  0x2013, // en dash
  0x2014, // em dash
  0x2015, // horizontal bar
  0x2212, // minus sign
])

const ARABIC_INDIC_ZERO = 0x0660 // ٠
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0 // ۰

/** Folds Arabic-Indic and extended/Persian digits to their ASCII equivalent. */
function toAsciiDigit(codePoint: number): string | undefined {
  for (const zero of [ARABIC_INDIC_ZERO, EXTENDED_ARABIC_INDIC_ZERO]) {
    if (codePoint >= zero && codePoint <= zero + 9) return String(codePoint - zero)
  }
  return undefined
}

const CANONICAL_PATTERN = new RegExp(`^\\d{${NATIONAL_ID_LENGTH}}$`)

/**
 * Canonical form of a national ID: Arabic-Indic digits folded to ASCII and
 * grouping separators removed. Does not validate — call `isValidNationalId`
 * on the result. Never strips leading zeros or otherwise reinterprets the
 * number.
 */
export function normalizeNationalId(raw: string): string {
  let normalized = ''

  for (const character of raw.normalize('NFKC')) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || SEPARATOR_CODE_POINTS.has(codePoint)) continue
    normalized += toAsciiDigit(codePoint) ?? character
  }

  return normalized
}

/** True when `value` is already in canonical form and structurally valid. */
export function isValidNationalId(value: string): boolean {
  return CANONICAL_PATTERN.test(value)
}
