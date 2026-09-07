import type { ParticipationStreakDto, StreakStopReason } from '@hajj-lottery/shared'

/**
 * The consecutive non-winning participation streak, as a pure function.
 *
 * No database, no clock: the rows arrive already loaded, so the same ledger
 * always yields the same count. The service does the fetching; this decides
 * what the rows mean.
 *
 * The streak will eventually drive priority weighting — someone passed over
 * five years running should outrank a first-time applicant — but this returns
 * a count of years and nothing more. Turning years into a weight is a separate
 * decision, deliberately not made here.
 */

/**
 * The earliest year the ledger can express, matching the CHECK constraint on
 * `participation_history.draw_year`. The walk stops here rather than looping
 * toward zero over years no record could exist for.
 */
const EARLIEST_DRAW_YEAR = 2000

/** One year of history, reduced to what the streak depends on. */
export interface HistoryYear {
  drawYear: number
  participated: boolean
  won: boolean
  verified: boolean
}

/**
 * Walks backward from the year before `targetDrawYear`, counting years that
 * positively establish participation without a win, and stopping at the first
 * year that does not.
 *
 * The walk is over *years*, not over rows. That distinction is the whole
 * point: iterating the rows a participant happens to have would silently
 * bridge a gap, quietly crediting someone for a year the ledger knows nothing
 * about. Asking about each year in turn means a hole stops the count, because
 * a hole is exactly what it looks like — an absence of evidence.
 *
 * A year counts only when the ledger says, with a verified record, that the
 * person took part and did not win. Every other answer stops the walk:
 *
 *   no record        we have nothing authoritative — not a claim of absence
 *   unverified       we have a claim nobody has vouched for yet
 *   participated=false  we know they did not take part
 *   won=true         they went; a non-winning streak cannot span it
 *
 * The target year itself is never counted: it is the year being decided, and
 * its outcome does not exist yet.
 */
export function calculateStreak(
  participantId: string,
  targetDrawYear: number,
  years: readonly HistoryYear[],
): ParticipationStreakDto {
  const byYear = new Map(years.map((year) => [year.drawYear, year]))

  let count = 0

  for (let year = targetDrawYear - 1; year >= EARLIEST_DRAW_YEAR; year -= 1) {
    const record = byYear.get(year)
    const stop = stopReasonFor(record)

    if (stop) {
      return {
        participantId,
        targetDrawYear,
        consecutiveNonWinningYears: count,
        stoppedAt: year,
        stoppedBecause: stop,
      }
    }

    count += 1
  }

  // An unbroken run all the way back to the earliest year the ledger allows.
  // Nothing stopped it, so there is no year to point at.
  return {
    participantId,
    targetDrawYear,
    consecutiveNonWinningYears: count,
    stoppedAt: null,
    stoppedBecause: 'REACHED_EARLIEST_YEAR',
  }
}

/**
 * Why this year does not extend the streak, or undefined when it does.
 *
 * Ordered so the most specific truth wins: a missing year is reported as
 * missing rather than as non-participation, because conflating "no record"
 * with "did not participate" is the single most damaging mistake this ledger
 * can make. One is an absence of evidence; the other is evidence of absence,
 * and only the second is a fact about the person.
 */
function stopReasonFor(record: HistoryYear | undefined): StreakStopReason | undefined {
  if (!record) return 'NO_AUTHORITATIVE_RECORD'
  // An unreviewed legacy import must not be able to inflate someone's
  // priority merely by existing. Verification is what makes a row count.
  if (!record.verified) return 'UNVERIFIED_RECORD'
  if (!record.participated) return 'DID_NOT_PARTICIPATE'
  if (record.won) return 'WON'

  return undefined
}
