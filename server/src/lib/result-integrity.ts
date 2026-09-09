import type { CommuneDrawStatus } from '@hajj-lottery/shared'

/**
 * Whether a concluded draw is whole enough to be announced.
 *
 * Publication is the moment a result stops being an internal record and becomes
 * the thing citizens are told, quote, and plan around. It is also the last point
 * at which anybody looks at the result before that happens. So this runs first,
 * and it refuses rather than repairs: a result that does not add up is a
 * question for the people who ran the draw, and quietly correcting it during
 * publication would destroy the only evidence that anything was ever wrong.
 *
 * Pure, in the same way the eligibility and import rules are: no database, no
 * clock, no Prisma. The service gathers the counts and hands them over, which is
 * what makes every rule here enumerable by a test without a draw having to exist.
 */

/**
 * What can be wrong. A closed vocabulary, so a new failure mode has to be named
 * rather than folded into a generic "invalid".
 */
export const RESULT_INTEGRITY_ISSUES = [
  /** The commune draw was never executed, or was cancelled. */
  'DRAW_NOT_COMPLETED',
  /** Completed with no result — a state the deferred trigger should forbid. */
  'RESULT_MISSING',
  /** The result names a pool other than the one the commune froze. */
  'POOL_MISMATCH',
  /** The frozen input's fingerprint no longer matches what the draw recorded. */
  'POOL_HASH_MISMATCH',
  /** Winner rows do not match the count the result claims. */
  'WINNER_COUNT_MISMATCH',
  /** The randomness behind the selections is incomplete. */
  'SELECTION_EVENT_MISSING',
  /** Selection order is not the contiguous 1..n sequence a draw produces. */
  'SELECTION_ORDER_BROKEN',
  /** Winning people are not all archived — or somebody extra is. */
  'WINNER_ARCHIVE_MISMATCH',
  /** An archived winner is not excluded from future draws. */
  'WINNER_EXCLUSION_MISSING',
  /** The draw selected a different number of entries than the pool allocated. */
  'ALLOCATION_MISMATCH',
  /** The participation ledger is missing years for people who were in the pool. */
  'PARTICIPATION_HISTORY_INCOMPLETE',
] as const

export type ResultIntegrityIssue = (typeof RESULT_INTEGRITY_ISSUES)[number]

/**
 * Everything the rules judge, counted from the database by the caller.
 *
 * Counts rather than rows on purpose: the question is whether the *shape* of the
 * result is right, and answering it from aggregates keeps a check that runs
 * before every publication from loading a commune's entire winner list.
 */
export interface ResultIntegrityFacts {
  communeDrawStatus: CommuneDrawStatus
  /** Null when the commune draw has no result at all. */
  result: {
    winnerCount: number
    drawPoolId: string
    poolHash: string
  } | null
  /** Null when the commune never froze a pool. */
  pool: {
    id: string
    snapshotHash: string
    entryCount: number
    allocatedSpots: number
  } | null
  /** Rows in `draw_winners` for this result. */
  drawWinnerCount: number
  /** Rows in `draw_selection_events` for this result. */
  selectionEventCount: number
  /**
   * The lowest and highest selection order stored, or null when there are no
   * winners at all.
   *
   * Bounds rather than the orders themselves, so this check costs one aggregate
   * however many places a commune allocated. Distinctness does not have to be
   * counted here because `UNIQUE(draw_result_id, selection_order)` already
   * guarantees it — given that, a count of n spanning exactly 1..n can only be
   * the contiguous sequence.
   */
  selectionOrderBounds: { min: number; max: number } | null
  /**
   * People the winning entries win for: one per SINGLE entry, two per PAIRED.
   * Derived from the winner rows, so it is what the result actually says rather
   * than what the archive claims.
   */
  expectedWinningParticipants: number
  /** Rows in `winner_archive` for this result. */
  archivedWinnerCount: number
  /** Archived winners whose `has_won_hajj` is set. */
  excludedWinnerCount: number
  /** Distinct people named by the frozen pool's entries. */
  pooledParticipantCount: number
  /** Ledger rows those people hold for this draw year. */
  participationRecordCount: number
}

/**
 * Every reason this result may not be published, or an empty list.
 *
 * Reports all of them rather than the first, the way pool validation does: an
 * administrator fixing one problem and discovering another on the next attempt
 * learns the state of their draw one round trip at a time.
 */
export function assessResultIntegrity(facts: ResultIntegrityFacts): ResultIntegrityIssue[] {
  const issues: ResultIntegrityIssue[] = []

  if (facts.communeDrawStatus !== 'COMPLETED') {
    // Nothing below is meaningful for a draw that has not been run, and
    // reporting a cascade of consequential failures would obscure the one
    // fact that matters.
    return ['DRAW_NOT_COMPLETED']
  }

  const { result, pool } = facts
  if (!result) return ['RESULT_MISSING']
  if (!pool) return ['POOL_MISMATCH']

  if (result.drawPoolId !== pool.id) issues.push('POOL_MISMATCH')
  // The tamper check. The pool is immutable by trigger and the result records
  // the hash it verified immediately before drawing, so a disagreement means
  // either the snapshot or the record of it has been changed by something that
  // bypassed those triggers.
  if (result.poolHash !== pool.snapshotHash) issues.push('POOL_HASH_MISMATCH')

  if (facts.drawWinnerCount !== result.winnerCount) issues.push('WINNER_COUNT_MISMATCH')
  if (facts.selectionEventCount !== result.winnerCount) issues.push('SELECTION_EVENT_MISSING')
  if (!spansExactly(facts.selectionOrderBounds, facts.drawWinnerCount)) {
    issues.push('SELECTION_ORDER_BROKEN')
  }

  // A draw awards exactly the places the pool was frozen with. Fewer would mean
  // a commune announcing an allocation it did not fill; more is impossible and
  // would mean the result was assembled by something other than the engine.
  if (result.winnerCount !== pool.allocatedSpots) issues.push('ALLOCATION_MISMATCH')

  if (facts.archivedWinnerCount !== facts.expectedWinningParticipants) {
    issues.push('WINNER_ARCHIVE_MISMATCH')
  }
  // Lifetime exclusion and the archive are written in one transaction, so a
  // winner who is not excluded means somebody has since cleared the flag.
  // Publishing them as a winner while they remain eligible for next year's draw
  // is precisely the inconsistency this gate exists to catch.
  if (facts.excludedWinnerCount !== facts.archivedWinnerCount) issues.push('WINNER_EXCLUSION_MISSING')

  // Everyone in the pool took part, and the ledger is what next year's priority
  // is computed from. A gap here would quietly cost somebody a year of patience.
  if (facts.participationRecordCount < facts.pooledParticipantCount) {
    issues.push('PARTICIPATION_HISTORY_INCOMPLETE')
  }

  return issues
}

/** Whether `count` distinct orders span exactly 1..count, the sequence a draw produces. */
function spansExactly(bounds: { min: number; max: number } | null, count: number): boolean {
  if (count === 0) return bounds === null
  return bounds !== null && bounds.min === 1 && bounds.max === count
}
