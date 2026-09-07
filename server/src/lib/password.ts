import { hash, verify } from '@node-rs/argon2'

/**
 * The one place passwords are hashed and checked.
 *
 * argon2id at the OWASP-recommended work factor (19 MiB memory, 2 passes).
 * The algorithm, parameters, salt and version are all encoded in the digest
 * string, so raising these values later stays compatible with existing
 * hashes — old digests keep verifying with the parameters they were made
 * with, and get upgraded the next time the password is set.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/**
 * Minimum length for a new administrator password. Deliberately long rather
 * than composition-based (NIST SP 800-63B), and enforced when a password is
 * *set*, never when it is checked.
 */
export const MIN_PASSWORD_LENGTH = 12

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS)
}

/**
 * Verifies a candidate password. Returns false rather than throwing on a
 * malformed digest, so a corrupted row cannot 500 the login endpoint.
 */
export async function verifyPassword(digest: string, candidate: string): Promise<boolean> {
  try {
    return await verify(digest, candidate)
  } catch {
    return false
  }
}
