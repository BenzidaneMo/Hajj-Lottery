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
  /** A draw allocating N places did not record N reserve positions. */
  'RESERVE_COUNT_MISMATCH',
  /** The randomness behind the selections is incomplete. */
  'SELECTION_EVENT_MISSING',
  /** Selection order is not the contiguous 1..n sequence a draw produces. */
  'SELECTION_ORDER_BROKEN',
  /**
   * The reserve list is not the second half of the draw: its positions do not
   * span 1..N, or its selections do not follow every winner's.
   */
  'RESERVE_ORDER_BROKEN',
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
  /** Rows in `draw_reserves` for this result. */
  drawReserveCount: number
  /** Rows in `draw_selection_events` for this result — winners and reserves. */
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
   * The lowest and highest *reserve* position, and the lowest and highest place
   * those reserves took in the draw. Both, because the reserve list has two
   * orderings to be wrong about: it must occupy positions 1..N, and it must sit
   * entirely after the winners in the selection order it was drawn in.
   */
  reservePositionBounds: { min: number; max: number } | null
  reserveSelectionOrderBounds: { min: number; max: number } | null
  /**
   * People the winning entries win for: one per SINGLE entry, two per PAIRED.
   * Derived from the winner rows, so it is what the result actually says rather
   * than what the archive claims.
   *
   * Abandoned winners are still counted. Giving up a place does not un-archive
   * anybody, so an abandonment must not make the archive look short.
   */
  expectedWinningParticipants: number
  /**
   * People promoted from the reserve list, who hold archive rows of their own.
   * Zero for a draw nobody has dropped out of, which is nearly all of them.
   */
  promotedReserveParticipants: number
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

  // A draw produces as many reserves as it does winners. Fewer would mean a
  // commune whose contingency list runs out before its places do, with nobody
  // having decided which places were the protected ones.
  if (facts.drawReserveCount !== result.winnerCount) issues.push('RESERVE_COUNT_MISMATCH')

  // One event per selection, across both halves: the reserve order is drawn and
  // is as checkable as the winner order. A missing event would mean part of the
  // list could not be verified against the randomness that produced it.
  if (facts.selectionEventCount !== facts.drawWinnerCount + facts.drawReserveCount) {
    issues.push('SELECTION_EVENT_MISSING')
  }

  if (!spansExactly(facts.selectionOrderBounds, facts.drawWinnerCount)) {
    issues.push('SELECTION_ORDER_BROKEN')
  }

  // The reserve half, checked on both of its orderings. Positions must be
  // 1..N — that is the call order an official reads out — and the selections
  // they came from must all follow the winners, which is what makes "the
  // reserves were drawn after the winners, by the same draw" a fact rather than
  // a claim.
  if (
    !spansExactly(facts.reservePositionBounds, facts.drawReserveCount) ||
    !spansRange(
      facts.reserveSelectionOrderBounds,
      facts.drawWinnerCount + 1,
      facts.drawWinnerCount + facts.drawReserveCount,
    )
  ) {
    issues.push('RESERVE_ORDER_BROKEN')
  }

  // A draw awards exactly the places the pool was frozen with. Fewer would mean
  // a commune announcing an allocation it did not fill; more is impossible and
  // would mean the result was assembled by something other than the engine.
  if (result.winnerCount !== pool.allocatedSpots) issues.push('ALLOCATION_MISMATCH')

  // The archive holds everyone this draw made a winner: the people the winning
  // entries won for, plus anybody promoted from the reserve list since. An
  // abandoned winner is still in that first group — a place given up was still
  // awarded, and nothing un-archives anybody.
  if (facts.archivedWinnerCount !== facts.expectedWinningParticipants + facts.promotedReserveParticipants) {
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
  return spansRange(bounds, 1, count)
}

/**
 * Whether the stored orders span exactly `from`..`to`.
 *
 * Bounds rather than the values themselves, so each check costs one aggregate
 * however many places a commune allocated. Distinctness does not have to be
 * counted: `UNIQUE(draw_result_id, selection_order)` already guarantees it, and
 * given that, the right number of rows spanning exactly the right range can only
 * be the contiguous sequence.
 */
function spansRange(bounds: { min: number; max: number } | null, from: number, to: number): boolean {
  if (to < from) return bounds === null
  return bounds !== null && bounds.min === from && bounds.max === to
}
