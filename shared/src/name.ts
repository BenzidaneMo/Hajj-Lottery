/**
 * Name handling for the participant identity model.
 *
 * An Algerian legal name has both an Arabic-script form and a Latin-script
 * (transliterated) form — not one string in one script, and not a choice the
 * interface language gets to make. Both are collected, and both are validated
 * the same way everywhere a name is entered: at registration and in the
 * legacy import pipeline. There is exactly one set of rules, here, so a
 * client-only check the server didn't repeat could never become a rule the
 * API actually enforces.
 *
 * Shared rather than server-only for the same reason `digits.ts` is: the
 * registration form needs the identical verdict while the citizen is still
 * typing, not a looser client check the server then disagrees with.
 */
import { isDigitCharacter } from './digits.js'

/** Bounds apply to one field — a first name or a last name, never a combined string. */
export const NAME_MIN_LENGTH = 2
export const NAME_MAX_LENGTH = 100

// Letters of the named script, plus a plain space, hyphen and apostrophe
// (straight or curly) for names like "Jean-Paul" or "O'Brien". Nothing else —
// digits, emoji, control characters and markup all fall outside every one of
// these classes and are refused by construction, not by a denylist.
const ARABIC_PATTERN = /^[\p{Script=Arabic}\s'’-]+$/u
const LATIN_PATTERN = /^[\p{Script=Latin}\s'’-]+$/u
const HAS_ARABIC_LETTER = /\p{Script=Arabic}/u
const HAS_LATIN_LETTER = /\p{Script=Latin}/u

/**
 * NFKC plus whitespace cleanup, identical for both scripts. Casing is never
 * touched — Arabic has no case, and a Latin name's casing is meaningful
 * ("McDonald", "O'Brien"), not noise to normalize away.
 */
function normalize(raw: string): string {
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ')
}

function isValidScriptName(value: string, pattern: RegExp, hasLetter: RegExp): boolean {
  if (value.length < NAME_MIN_LENGTH || value.length > NAME_MAX_LENGTH) return false
  if (!pattern.test(value)) return false
  if (!hasLetter.test(value)) return false
  // \p{Script=Arabic} also matches the Arabic-Indic digits (٠-٩), which a
  // name must not contain even though the character class alone would accept
  // them.
  if ([...value].some(isDigitCharacter)) return false
  return true
}

export function normalizeArabicName(raw: string): string {
  return normalize(raw)
}

/** True for a non-empty run of Arabic-script letters (plus space/hyphen/apostrophe), no digits. */
export function isValidArabicName(value: string): boolean {
  return isValidScriptName(value, ARABIC_PATTERN, HAS_ARABIC_LETTER)
}

export function normalizeLatinName(raw: string): string {
  return normalize(raw)
}

/** True for a non-empty run of Latin-script letters (plus space/hyphen/apostrophe), no digits. */
export function isValidLatinName(value: string): boolean {
  return isValidScriptName(value, LATIN_PATTERN, HAS_LATIN_LETTER)
}
