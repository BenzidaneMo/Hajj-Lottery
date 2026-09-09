/**
 * Reserves, abandonment and replacement.
 *
 * A commune's draw selects twice its allocation in one continuous weighted
 * sample: the first N entries are the winners, the next N are the reserves, in
 * that order. Both halves are original lottery selections and neither can be
 * rewritten afterwards — what changes over time is the *administrative outcome*
 * recorded alongside them, which is a different question with a different answer.
 *
 * Two vocabularies, kept apart on purpose:
 *
 *   original selection   WINNER #4        RESERVE #1
 *   current outcome      ABANDONED        PROMOTED
 *
 * A reserve that is promoted does not become "winner #4". It stays reserve #1 of
 * this draw, forever, and separately becomes a winner. Collapsing the two would
 * make the published result a record of who holds a place today rather than of
 * what the lottery did, and there would then be no way to show that the lottery
 * did anything in particular.
 */

import type { EntryType } from './application.js'

/**
 * Reserve positions created per allocated spot.
 *
 * One, by the approved domain rule: ten places produce ten winners and ten
 * ordered reserves. A constant rather than a literal 2 scattered through the
 * engine, the integrity gate and the documentation, so the rule has one home.
 */
export const RESERVE_POSITIONS_PER_SPOT = 1

/**
 * How many entries one draw selects in total: the winners, then the reserves.
 *
 * This is the number the lottery engine is asked for, and — since sampling is
 * without replacement — also the minimum number of entries a pool must hold.
 */
export function totalDrawSelections(allocatedSpots: number): number {
  return allocatedSpots * (1 + RESERVE_POSITIONS_PER_SPOT)
}

/**
 * Where one reserve stands.
 *
 * Deliberately short. `SKIPPED` and `EXPIRED` are absent because nothing skips a
 * reserve and nothing expires one: the call order is enforced rather than
 * chosen, and silence is never read as an answer — an administrator records what
 * the citizen actually said. A state nothing can reach is an invented lifecycle,
 * not a recorded one.
 */
export const RESERVE_STATUSES = [
  /** Selected as a reserve and not yet needed. Not a winner in any sense. */
  'WAITING',
  /** Offered the place left by a specific abandoned winner. */
  'CALLED',
  /** Took the place. This is the moment they become a winner. */
  'ACCEPTED',
  /** Refused it. The next reserve may then be called for the same place. */
  'DECLINED',
] as const

export type ReserveStatus = (typeof RESERVE_STATUSES)[number]

/**
 * Why an original winner gave up their place.
 *
 * A small controlled vocabulary plus a required explanation, rather than a long
 * taxonomy nobody agrees on. The categories are administrative record-keeping:
 * the software never concludes any of them, an official records the reason that
 * was officially established.
 */
export const ABANDONMENT_REASONS = ['VOLUNTARY_WITHDRAWAL', 'DEATH', 'MEDICAL', 'OTHER'] as const

export type AbandonmentReason = (typeof ABANDONMENT_REASONS)[number]

/** How a person came to be a winner. Provenance on their lifetime archive row. */
export const WINNER_SOURCES = [
  /** Drawn as one of the original N winners. */
  'ORIGINAL_DRAW',
  /** Drawn as a reserve, called after an abandonment, and accepted. */
  'RESERVE_REPLACEMENT',
] as const

export type WinnerSource = (typeof WINNER_SOURCES)[number]

/**
 * An original winner's current administrative outcome.
 *
 * Derived from whether an abandonment has been recorded, never stored as a
 * column on the winner row: `draw_winners` is immutable evidence of a lottery,
 * and a mutable status on it could disagree with the record of who decided what.
 */
export const WINNER_OUTCOMES = ['ACTIVE', 'ABANDONED'] as const

export type WinnerOutcome = (typeof WINNER_OUTCOMES)[number]

/**
 * The record of an original winner giving up their place, as an administrator
 * reads it.
 *
 * The explanation is free text an official wrote and may name a circumstance —
 * so it is administrative, scoped like everything else on the result, and it
 * never appears in any public payload.
 */
export interface WinnerAbandonmentDto {
  reason: AbandonmentReason
  explanation: string
  recordedBy: { id: string; username: string }
  recordedAt: string
}

/**
 * One reserve, as an administrator reads it: what the draw did, then what has
 * happened since.
 *
 * `reservePosition` and `selectionOrder` are the lottery's own facts and never
 * change. Everything below `status` is the lifecycle, which is the only mutable
 * part of a concluded draw anywhere in this system.
 */
export interface DrawReserveDto {
  /** 1..N, the order reserves are called in. */
  reservePosition: number
  /** Position in the whole draw: N+1..2N, always after every winner. */
  selectionOrder: number
  applicationReference: string
  entryType: EntryType
  /** 1 for SINGLE, 2 for PAIRED. A paired reserve is still one position. */
  participantCount: number
  /** The weight this entry carried in the pool. Administrative only. */
  selectedWeight: number
  status: ReserveStatus
  /**
   * The abandoned winner this reserve was called to replace, by that winner's
   * original selection order. Null while WAITING.
   */
  replacesSelectionOrder: number | null
  calledAt: string | null
  /** When the citizen's answer was recorded — acceptance or refusal. */
  decidedAt: string | null
}
