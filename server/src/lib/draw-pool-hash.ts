import { createHash } from 'node:crypto'

/**
 * A deterministic fingerprint of a frozen draw pool.
 *
 * Its purpose is integrity: given a pool, anyone can recompute the hash and
 * see whether the draw input still says what it said when it was frozen. It is
 * **not a random seed**, and the draw must never use it as one — deriving
 * randomness from the input would make the outcome a function of the entrants,
 * which is the opposite of a lottery.
 *
 * Nothing personal goes in. The hash covers what the draw acts on — which
 * application, which participants, what weight — and no names, national IDs,
 * dates of birth or phone numbers, so a published hash discloses nothing about
 * anybody even if the format is known.
 */

/**
 * The canonical format's version, stored alongside every hash.
 *
 * If the serialization below ever changes, this changes with it, so an old
 * pool that no longer verifies under the new format can be told apart from one
 * that has actually been tampered with.
 */
export const SNAPSHOT_VERSION = 1

/** One entry's contribution to the fingerprint. */
export interface HashableEntry {
  applicationId: string
  applicationReference: string
  entryType: string
  primaryParticipantId: string
  secondaryParticipantId: string | null
  weight: number
}

/** The pool-level facts the fingerprint also covers. */
export interface HashablePool {
  communeDrawId: string
  communeId: string
  drawYear: number
  allocatedSpots: number
  entries: readonly HashableEntry[]
}

/**
 * Field and record separators chosen from characters that cannot occur in any
 * value being serialized: ids are cuids, references are `HZ-…` from a fixed
 * alphabet, entry types are enum names, weights are integers. Nothing needs
 * escaping, and `assertSerializable` refuses anything that would.
 */
const FIELD = '|'
const RECORD = '\n'

/**
 * Builds the exact string that gets hashed.
 *
 * Deliberately not JSON. Object key order is a property of how an object was
 * built, and two runs that disagree about it would produce different hashes
 * for identical pools — an integrity check that fails at random is worse than
 * none. This format fixes the order of every field by writing it out.
 *
 * Entries are sorted by application id, so the order they were read from the
 * database in cannot affect the result.
 */
export function canonicalizePool(pool: HashablePool): string {
  const header = [
    `hajj-draw-pool/v${SNAPSHOT_VERSION}`,
    pool.communeDrawId,
    pool.communeId,
    String(pool.drawYear),
    String(pool.allocatedSpots),
    String(pool.entries.length),
  ].join(FIELD)

  const entries = [...pool.entries]
    .sort((a, b) => (a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0))
    .map((entry) => {
      const fields = [
        entry.applicationId,
        entry.applicationReference,
        entry.entryType,
        entry.primaryParticipantId,
        // A fixed placeholder rather than an empty field, so a single
        // applicant cannot be confused with a missing value.
        entry.secondaryParticipantId ?? '-',
        String(entry.weight),
      ]
      fields.forEach(assertSerializable)
      return fields.join(FIELD)
    })

  return [header, ...entries].join(RECORD)
}

/** SHA-256 of the canonical form, lowercase hex. */
export function hashPool(pool: HashablePool): string {
  return createHash('sha256').update(canonicalizePool(pool), 'utf8').digest('hex')
}

/**
 * Refuses a value that would break the format's unambiguity.
 *
 * Unreachable with the data this system produces, which is exactly why it is
 * checked: a separator smuggled into an identifier could make two different
 * pools serialize identically, and a fingerprint that can collide on purpose
 * is not an integrity mechanism.
 */
function assertSerializable(value: string): void {
  if (value.includes(FIELD) || value.includes(RECORD)) {
    throw new Error('Refusing to hash a draw pool containing a separator character')
  }
}
