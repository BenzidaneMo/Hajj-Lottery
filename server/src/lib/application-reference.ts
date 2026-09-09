import { randomInt } from 'node:crypto'

/**
 * Citizen-facing application references, e.g. `HZ-2027-MES-8F42K1`.
 *
 * The reference is printed on a receipt, read aloud at a counter and typed
 * back in later, so it is built to survive that: no database id, no national
 * ID, nothing sequential that would reveal how many people have applied or
 * let someone guess a neighbour's reference by adding one.
 */

const PREFIX = 'HZ'

/**
 * Crockford-style alphabet with I, L, O and U removed: the first three are
 * confusable with 1 and 0 when handwritten or read out, and dropping U keeps
 * the alphabet from spelling unfortunate words by accident.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 32^6 ≈ 1.07 billion possibilities per commune per year. */
const RANDOM_LENGTH = 6

/**
 * Three letters derived from the commune's Latin name, purely so a human can
 * tell two references apart at a glance. It is a label, not an identifier:
 * several communes can share a token, and uniqueness never depends on it.
 */
export function communeToken(communeNameFr: string): string {
  const letters = communeNameFr
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')

  return letters.length >= 3 ? letters.slice(0, 3) : letters.padEnd(3, 'X')
}

/**
 * Combining accents, so NFD-decomposed "Béjaïa" contributes BEJ rather than
 * BJA. Built from escapes because the characters themselves are invisible.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

/**
 * `randomInt` draws from the CSPRNG and is free of the modulo bias a
 * `Math.random() * length` would introduce — worth having even here, since a
 * predictable suffix would make references guessable.
 */
function randomSuffix(): string {
  let suffix = ''
  for (let index = 0; index < RANDOM_LENGTH; index += 1) {
    suffix += ALPHABET[randomInt(ALPHABET.length)]
  }
  return suffix
}

/**
 * Builds a candidate reference. Uniqueness is guaranteed by the unique index
 * on `applications.application_reference`, not by this function — the caller
 * retries on collision rather than trusting randomness alone.
 */
export function generateApplicationReference(drawYear: number, communeNameFr: string): string {
  return `${PREFIX}-${drawYear}-${communeToken(communeNameFr)}-${randomSuffix()}`
}

const REFERENCE_PATTERN = new RegExp(`^${PREFIX}-\\d{4}-[A-Z]{3}-[${ALPHABET}]{${RANDOM_LENGTH}}$`)

/**
 * A reference as typed back in, reduced to the form it was stored in.
 *
 * References are printed on receipts, photographed and read aloud, so they come
 * back lowercased, spaced, or with the separators the citizen remembers rather
 * than the ones that were printed. None of that changes which application is
 * meant, and treating it as a different reference would tell somebody their own
 * application does not exist.
 *
 * Only case, whitespace and separator style are normalized. Characters are never
 * substituted — mapping O to 0 or I to 1 would be guessing at what somebody
 * meant, and the alphabet excludes those characters precisely so that guess is
 * never needed.
 */
export function normalizeApplicationReference(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '').replace(/[–—_]/g, '-')
}

/** Shape check for a reference a citizen types back in. */
export function isValidApplicationReference(value: string): boolean {
  return REFERENCE_PATTERN.test(normalizeApplicationReference(value))
}
