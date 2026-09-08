/**
 * Weighted random sampling without replacement — the selection algorithm, as a
 * pure function.
 *
 * No database, no clock, no entropy of its own: every random number arrives
 * through the injected `RandomIntSource`, which is what makes a real draw
 * cryptographically random and a test exactly reproducible without a seeded
 * PRNG ever reaching production. Given the same entries, the same winner count
 * and the same sequence of random values, this always produces the same result.
 *
 * It answers one question and refuses the rest: *given this frozen weighted
 * pool and this number of places, which entries are selected, and in what
 * order?* It does not evaluate eligibility, does not compute weights, does not
 * read participation history, and does not know who anybody is — those
 * decisions were made upstream and frozen into the pool it is handed.
 */

/**
 * The largest total weight a draw will be run against.
 *
 * This is the bound `crypto.randomInt` accepts (its range must be under 2^48),
 * so keeping the total under it is what lets the whole algorithm work in
 * ordinary integer arithmetic with no floating point and no BigInt.
 *
 * There is no realistic way to reach it. A weight is CHECK-constrained to
 * 1-1000 in the database, so exceeding this ceiling would take upwards of
 * 2.8 * 10^11 entries in a single commune — around thirty times the world's
 * population. The bound is asserted anyway rather than assumed: a total that
 * silently exceeded the random source's range would quietly bias the draw,
 * which is the one failure mode that must never pass unnoticed.
 */
export const MAX_TOTAL_ACTIVE_WEIGHT = 2 ** 48 - 1

/**
 * Where a draw's randomness comes from.
 *
 * Injected rather than imported so that the algorithm above has no way to
 * obtain a random number by itself — the only entropy in a selection is the
 * entropy handed to it. Production passes the CSPRNG in
 * `lib/lottery-random.ts`; tests pass a fixed sequence.
 */
export interface RandomIntSource {
  /**
   * A uniformly distributed integer in **[0, maxExclusive)** — zero is a
   * possible result, `maxExclusive` never is.
   */
  randomInt(maxExclusive: number): number
}

/**
 * The minimum an entry must be for the algorithm to draw it.
 *
 * A pool entry carries far more than this (which application, which
 * participants); the algorithm is given a view that deliberately contains
 * neither, because choosing between entries cannot be allowed to depend on
 * anything but their weights.
 */
export interface LotteryEntry {
  id: string
  weight: number
}

/**
 * One selection, with the random draw that produced it.
 *
 * Recorded because "why was this entry selected?" must have an arithmetic
 * answer: at this point the active entries summed to `totalActiveWeight`, the
 * random source returned `randomValue`, and that value falls in the selected
 * entry's slice of the cumulative range. A future audit and transparency layer
 * will persist these; nothing does yet.
 */
export interface SelectionEvent {
  /** 1-based: the first selection of the draw is 1. */
  selectionNumber: number
  /** The entries still in play, summed, *before* this selection. */
  totalActiveWeight: number
  /** The value drawn, in [0, totalActiveWeight). */
  randomValue: number
  selectedEntryId: string
  selectedWeight: number
}

/** An ordered selection, and the arithmetic that produced it. */
export interface Selection<E extends LotteryEntry> {
  /** The selected entries, in the order they were drawn. */
  selected: E[]
  events: SelectionEvent[]
  /** The whole pool's weight, before anything was removed. */
  initialTotalWeight: number
}

/**
 * Selects `winnerCount` entries, weighted by `weight`, without replacement.
 *
 * Each round maps the active entries onto one contiguous integer range and
 * draws a single value inside it:
 *
 * ```
 *   A weight 2   B weight 5   C weight 3      total 10
 *   [0 1]        [2 3 4 5 6]  [7 8 9]
 *   r = 0..1 → A   r = 2..6 → B   r = 7..9 → C
 * ```
 *
 * `r` is drawn from **[0, total)** and the winner is the first entry whose
 * cumulative weight *exceeds* it, so every entry owns exactly `weight` of the
 * `total` values and none owns a value twice: `r = 0` selects the first entry,
 * `r = total - 1` the last, and `r = total` cannot occur. A source that
 * returned it would silently make the final entry unselectable, so it is
 * rejected rather than clamped.
 *
 * The selected entry is then removed and the total recomputed, which is what
 * makes this sampling *without* replacement: an entry cannot win twice, and
 * every remaining entry's share of the next round grows accordingly.
 *
 * Nothing is mutated. The array handed in is copied, and the entries in it are
 * returned as they arrived — they are the frozen evidence of what the draw ran
 * against, and this is a reader.
 *
 * The scan is linear per selection, so a draw is O(winners x entries). For a
 * commune — hundreds to thousands of entries and tens of places — that is
 * nothing, and it keeps the algorithm one obviously-correct loop. A faster
 * structure (a cumulative-weight tree) is only worth introducing if a real pool
 * ever makes it necessary; being able to follow the arithmetic by eye matters
 * more here than constant factors.
 */
export function weightedSampleWithoutReplacement<E extends LotteryEntry>(
  entries: readonly E[],
  winnerCount: number,
  random: RandomIntSource,
): Selection<E> {
  assertUsableEntries(entries)
  assertUsableWinnerCount(winnerCount, entries.length)

  // A working copy: removal happens here, never in the caller's array. Order is
  // preserved on removal (rather than swapping the last entry into the gap) so
  // that the mapping from a random value to an entry stays as legible on the
  // tenth selection as on the first.
  const remaining = [...entries]

  let totalActiveWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0)
  assertUsableTotal(totalActiveWeight)

  const initialTotalWeight = totalActiveWeight
  const selected: E[] = []
  const events: SelectionEvent[] = []

  for (let selectionNumber = 1; selectionNumber <= winnerCount; selectionNumber += 1) {
    const randomValue = random.randomInt(totalActiveWeight)
    assertDrawnInRange(randomValue, totalActiveWeight)

    const index = indexAtCumulativeWeight(remaining, randomValue)
    const [winner] = remaining.splice(index, 1)
    if (!winner) {
      throw new Error('Refusing to complete a draw: the selected index held no entry')
    }

    selected.push(winner)
    events.push({
      selectionNumber,
      totalActiveWeight,
      randomValue,
      selectedEntryId: winner.id,
      selectedWeight: winner.weight,
    })

    totalActiveWeight -= winner.weight
  }

  return { selected, events, initialTotalWeight }
}

/**
 * The index of the entry whose slice of the cumulative range contains
 * `randomValue`.
 *
 * Strictly `<`, so a slice starts at the previous cumulative total and stops
 * one short of its own — the boundary that makes the ranges contiguous and
 * non-overlapping.
 */
function indexAtCumulativeWeight(entries: readonly LotteryEntry[], randomValue: number): number {
  let cumulative = 0
  let index = 0

  for (const entry of entries) {
    cumulative += entry.weight
    if (randomValue < cumulative) return index
    index += 1
  }

  // Unreachable: randomValue < total is asserted before the scan, and the scan
  // covers exactly the total. Checked because falling off the end silently
  // would mean drawing nobody.
  throw new Error(`Refusing to complete a draw: no entry covers the drawn value ${randomValue}`)
}

/**
 * A pool the algorithm can draw from at all.
 *
 * An empty pool, a zero or negative weight, a fraction, a duplicated entry —
 * each of these is a corrupted input rather than an edge case to accommodate,
 * and each would fail in a way that looks like a valid draw. A zero-weight
 * entry in particular would sit in the pool and be structurally unselectable,
 * which is an eligibility decision made by arithmetic.
 */
function assertUsableEntries(entries: readonly LotteryEntry[]): void {
  if (entries.length === 0) {
    throw new Error('Refusing to draw from an empty pool')
  }

  const seen = new Set<string>()

  for (const entry of entries) {
    if (!entry.id) {
      throw new Error('Refusing to draw from an entry with no identifier')
    }
    if (seen.has(entry.id)) {
      throw new Error(`Refusing to draw from a pool that lists the same entry twice: ${entry.id}`)
    }
    seen.add(entry.id)

    if (!Number.isSafeInteger(entry.weight) || entry.weight < 1) {
      throw new Error(`Refusing to draw with a weight that is not a positive integer: ${entry.weight}`)
    }
  }
}

/**
 * How many entries may be drawn.
 *
 * More places than entries is **refused, not truncated**. The pool is allowed
 * to be smaller than the allocation — freezing accepts that deliberately — so
 * what to do about it is a policy question, and quietly selecting everybody
 * would answer it invisibly on the domain's behalf. See docs/lottery-engine.md;
 * the service turns this into a typed `INSUFFICIENT_DRAW_ENTRIES`.
 */
function assertUsableWinnerCount(winnerCount: number, available: number): void {
  if (!Number.isSafeInteger(winnerCount) || winnerCount < 1) {
    throw new Error(`Refusing to draw a winner count that is not a positive integer: ${winnerCount}`)
  }
  if (winnerCount > available) {
    throw new Error(`Refusing to draw ${winnerCount} winners from ${available} entries`)
  }
}

function assertUsableTotal(totalWeight: number): void {
  if (!Number.isSafeInteger(totalWeight) || totalWeight < 1) {
    throw new Error(`Refusing to draw from a total weight that is not a positive integer: ${totalWeight}`)
  }
  if (totalWeight > MAX_TOTAL_ACTIVE_WEIGHT) {
    throw new Error(`Refusing to draw from a total weight beyond the random source's range: ${totalWeight}`)
  }
}

/**
 * Holds the random source to its contract.
 *
 * The production source cannot violate this, which is exactly why it is
 * checked: the interface is injectable, and a source that returned
 * `maxExclusive`, a negative value or a fraction would bias or break the draw
 * in ways no result would reveal.
 */
function assertDrawnInRange(randomValue: number, maxExclusive: number): void {
  if (!Number.isSafeInteger(randomValue) || randomValue < 0 || randomValue >= maxExclusive) {
    throw new Error(
      `Refusing a random value outside [0, ${maxExclusive}): ${randomValue}. ` +
        'The random source is not honouring its contract.',
    )
  }
}
