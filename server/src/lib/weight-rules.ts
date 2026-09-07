import { MINIMUM_APPLICATION_WEIGHT, type WeightRule } from '@hajj-lottery/shared'

/**
 * The weighting rules, as a pure function of already-known numbers.
 *
 * No database, no clock, no randomness — the same streaks always produce the
 * same weight. The service fetches the streaks; this decides what they are
 * worth, and nothing here can accidentally read history it was not given.
 *
 * These rules do not select anybody. A weight is a claim's strength, not an
 * outcome, and turning weights into winners is a separate step that does not
 * exist yet.
 */

/**
 * Overflow guard, not a domain rule.
 *
 * A streak cannot structurally exceed the span of years the ledger can express
 * (`draw_year` is constrained to 2000-2200, so roughly 200), and the same
 * bound is a CHECK constraint on the column. This leaves generous headroom
 * while still refusing a value that could only come from corrupt input.
 */
export const MAX_APPLICATION_WEIGHT = 1000

/**
 * One person's weight for a target draw year.
 *
 * The weight *is* the streak — five consecutive years of applying and being
 * passed over is a weight of five — with a floor of one, because an eligible
 * applicant who has never applied before must still be drawable. Zero would
 * remove them from the draw entirely, which is a decision for the eligibility
 * rules to make, not for arithmetic.
 */
export function individualWeight(consecutiveNonWinningYears: number): number {
  assertUsableStreak(consecutiveNonWinningYears)

  return Math.max(consecutiveNonWinningYears, MINIMUM_APPLICATION_WEIGHT)
}

/** What a pair's two weights combine into, and by which rule. */
export interface CombinedWeight {
  calculatedWeight: number
  rule: WeightRule
}

/**
 * Combines the applicants' weights into the application's.
 *
 * A pair takes the **higher** of the two. They travel together and share one
 * outcome, so pairing with someone newer must not cost a long-waiting
 * applicant their accumulated claim — nor must it let the pair inherit more
 * than the strongest claim either of them holds. An average would punish the
 * patient one; a sum would make pairing a way to buy chances.
 */
export function combineWeights(primaryWeight: number, secondaryWeight: number | null): CombinedWeight {
  if (secondaryWeight === null) {
    return { calculatedWeight: assertUsableWeight(primaryWeight), rule: 'SINGLE' }
  }

  return {
    calculatedWeight: assertUsableWeight(Math.max(primaryWeight, secondaryWeight)),
    rule: 'MAX',
  }
}

/**
 * A streak arrives from the ledger and should already be a count of years, but
 * it is the one input here that comes from outside — so it is checked rather
 * than trusted, before it can turn into a weight nobody notices is wrong.
 */
function assertUsableStreak(streak: number): void {
  if (!Number.isSafeInteger(streak) || streak < 0 || streak > MAX_APPLICATION_WEIGHT) {
    throw new Error(`Refusing to weight an implausible participation streak: ${streak}`)
  }
}

function assertUsableWeight(weight: number): number {
  if (
    !Number.isSafeInteger(weight) ||
    weight < MINIMUM_APPLICATION_WEIGHT ||
    weight > MAX_APPLICATION_WEIGHT
  ) {
    throw new Error(`Refusing to produce an out-of-range application weight: ${weight}`)
  }

  return weight
}
