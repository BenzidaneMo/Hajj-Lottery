/**
 * Digit handling for the identifiers citizens type: national IDs and phone
 * numbers.
 *
 * Both face the same two problems — an Arabic keyboard produces Arabic-Indic
 * digits, and people group long numbers with spaces, dashes and dots — so the
 * folding lives here once rather than being reimplemented (and drifting) per
 * field.
 *
 * Shared rather than server-only because the registration form needs the same
 * rules while the citizen is still typing: a field that silently deleted
 * Arabic-Indic digits, or miscounted them, would be unusable in the app's
 * default language.
 */

/** Algeria's Numéro d'Identification National is exactly 18 digits. */
export const NATIONAL_ID_LENGTH = 18

/**
 * Code points people type as grouping separators, or that an RTL keyboard
 * leaves behind invisibly. They carry no meaning inside a number, so they are
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
  0x28, // (
  0x29, // )
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

/** True for a digit in any script this system accepts. */
export function isDigitCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return false
  if (codePoint >= 0x30 && codePoint <= 0x39) return true
  return toAsciiDigit(codePoint) !== undefined
}

/**
 * Keeps only digits, at most `maxDigits` of them, in whatever script they
 * were typed.
 *
 * Used to stop a field accepting more than it can mean — an 18-digit national
 * ID field should not take a 19th character. The digits are left in the
 * citizen's own script so the field does not rewrite itself under their
 * cursor; canonicalization to ASCII happens on submission.
 */
export function limitToDigits(raw: string, maxDigits: number): string {
  let kept = ''
  for (const character of raw) {
    if (!isDigitCharacter(character)) continue
    kept += character
    if (kept.length >= maxDigits) break
  }
  return kept
}

/**
 * Folds non-ASCII digits to ASCII and removes grouping separators, leaving
 * every other character untouched so the caller can reject it. Never strips
 * leading zeros or otherwise reinterprets the number.
 */
export function normalizeTypedNumber(raw: string): string {
  let normalized = ''

  for (const character of raw.normalize('NFKC')) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || SEPARATOR_CODE_POINTS.has(codePoint)) continue
    normalized += toAsciiDigit(codePoint) ?? character
  }

  return normalized
}
