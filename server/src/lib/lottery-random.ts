import { randomInt } from 'node:crypto'

import { MAX_TOTAL_ACTIVE_WEIGHT, type RandomIntSource } from './lottery.js'

/**
 * The randomness a real draw is run on.
 *
 * `crypto.randomInt` is Node's cryptographically secure uniform integer
 * generator: it reads from the platform CSPRNG and rejection-samples internally,
 * so every value in the range is equally likely and no value is reachable more
 * often than another through modulo bias.
 *
 * `Math.random` is forbidden here and anywhere near the draw. It is a fast
 * non-cryptographic PRNG whose internal state can be recovered from a handful
 * of outputs, which would make a lottery's future selections predictable to
 * anyone who watched a few of them. A test asserts the lottery code does not
 * contain it. The same reasoning rules out anything else that merely *looks*
 * unpredictable — a timestamp, a UUID, a database id, a process counter, or the
 * pool's own snapshot hash. Randomness derived from the pool would make the
 * outcome a function of who entered.
 *
 * This module exists separately from `lib/lottery.ts` so that the algorithm
 * imports no entropy at all and can only ever use what it is handed.
 */
export const cryptoRandomIntSource: RandomIntSource = {
  randomInt(maxExclusive: number): number {
    assertUsableBound(maxExclusive)

    // Zero-based and exclusive, matching the RandomIntSource contract exactly:
    // crypto.randomInt(max) returns an integer in [0, max).
    return randomInt(maxExclusive)
  },
}

/**
 * Refuses a range this generator cannot serve uniformly.
 *
 * `crypto.randomInt` requires its range to be below 2^48, which is the same
 * ceiling the engine enforces on a pool's total weight — so a real pool cannot
 * reach it (see MAX_TOTAL_ACTIVE_WEIGHT). Asserted rather than assumed because
 * the alternative to failing here would be a draw that quietly narrows the
 * range it selects from, and a biased lottery that still returns plausible
 * winners is undetectable from its output.
 */
function assertUsableBound(maxExclusive: number): void {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
    throw new Error(`Refusing to draw a random integer below 1: ${maxExclusive}`)
  }
  if (maxExclusive > MAX_TOTAL_ACTIVE_WEIGHT) {
    throw new Error(`Refusing to draw a random integer beyond the CSPRNG's range: ${maxExclusive}`)
  }
}
