/**
 * Weighted random sampling without replacement, under pilgrim capacity — the
 * selection algorithm, as a pure function.
 *
 * No database, no clock, no entropy of its own: every random number arrives
 * through the injected `RandomIntSource`, which is what makes a real draw
 * cryptographically random and a test exactly reproducible without a seeded
 * PRNG ever reaching production. Given the same entries, the same quotas and the
 * same sequence of random values, this always produces the same result.
 *
 * It answers one question and refuses the rest: *given this frozen weighted
 * pool and these pilgrim quotas, which groups are selected, and in what order?*
 * It does not evaluate eligibility, does not compute weights, does not read
 * participation history, and does not know who anybody is — those decisions were
 * made upstream and frozen into the pool it is handed.
 *
 * **Two units, and the whole point of this module.** The unit of *selection* is
 * a group: one application, drawn whole. The unit of *capacity* is a pilgrim: a
 * commune is allocated pilgrimage places, and a paired application occupies two
 * of them. So a quota is spent in pilgrims while entries are drawn as groups,
 * and at every step only the groups that fit entirely inside what is left of the
 * quota may be drawn. A pair is never split into one winner and one
 * non-winner, a quota is never overspent, and nothing is truncated after the
 * fact. See docs/pilgrim-capacity.md.
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
 * anything but their weights and their sizes.
 *
 * `pilgrimCount` is a *size*, not a preference. It never influences which of
 * the fitting entries is chosen — only whether an entry fits at all. The domain
 * supplies 1 or 2; the algorithm only requires a positive integer.
 */
export interface LotteryEntry {
  id: string
  weight: number
  pilgrimCount: number
}

/**
 * One selection, with the random draw that produced it.
 *
 * Recorded because "why was this entry selected?" must have an arithmetic
 * answer: at this point the *fitting* entries summed to `totalActiveWeight`, the
 * random source returned `randomValue`, and that value falls in the selected
 * entry's slice of the cumulative range.
 *
 * `totalActiveWeight` is the total of the entries that could be drawn at that
 * step — not of everything still unselected. When one pilgrim place is left, the
 * paired entries are not in that total, because they were not candidates. An
 * auditor replaying a draw reconstructs the fitting set from the frozen pool,
 * the prior selections and the quotas, and this is the number they must arrive
 * at; a total that included groups too large to be selected would describe a
 * range the draw never drew from.
 */
export interface SelectionEvent {
  /** 1-based: the first selection of the draw is 1, across every quota. */
  selectionNumber: number
  /** The entries that *fitted*, summed, *before* this selection. */
  totalActiveWeight: number
  /** The value drawn, in [0, totalActiveWeight). */
  randomValue: number
  selectedEntryId: string
  selectedWeight: number
}

/** An ordered selection, and the arithmetic that produced it. */
export interface CapacitySelection<E extends LotteryEntry> {
  /**
   * The selected entries, grouped by the quota they were drawn for and in the
   * order they were drawn — `[winners, reserves]` for a commune draw.
   *
   * Each group's `pilgrimCount`s sum to exactly that quota. The number of
   * entries in it is whatever that took.
   */
  phases: E[][]
  /** Every selection, numbered continuously across the quotas. One sample. */
  events: SelectionEvent[]
  /** The whole pool's weight, before anything was removed. */
  initialTotalWeight: number
}

/**
 * A quota that cannot be filled exactly by the groups that are left.
 *
 * Reached in one way only: a single pilgrim place remains and every unselected
 * entry is a pair. Filling it would mean splitting a paired registration,
 * overspending the quota, or leaving a place awarded to nobody — so the draw
 * refuses instead, having written nothing.
 *
 * A distinct class rather than a bare `Error` so the service can turn exactly
 * this into a typed API refusal without matching on a message.
 */
export class UnfillableQuotaError extends Error {
  /** Which quota ran out of fitting groups: 0 is the winners, 1 the reserves. */
  readonly quotaIndex: number
  /** Pilgrim places still unfilled when it did. */
  readonly remainingCapacity: number

  constructor(quotaIndex: number, remainingCapacity: number, unselectedEntries: number) {
    super(
      `Refusing to complete a draw: ${remainingCapacity} pilgrim place(s) remain on quota ` +
        `${quotaIndex + 1} and none of the ${unselectedEntries} remaining applications is small ` +
        'enough to fill them without splitting a paired registration',
    )
    this.name = 'UnfillableQuotaError'
    this.quotaIndex = quotaIndex
    this.remainingCapacity = remainingCapacity
  }
}

/**
 * Fills each pilgrim quota in turn from one continuous weighted sample, without
 * replacement.
 *
 * Each round maps the entries that *fit the remaining capacity* onto one
 * contiguous integer range and draws a single value inside it:
 *
 * ```
 *   A weight 2   B weight 5   C weight 3      total 10
 *   [0 1]        [2 3 4 5 6]  [7 8 9]
 *   r = 0..1 → A   r = 2..6 → B   r = 7..9 → C
 * ```
 *
 * `r` is drawn from **[0, total)** and the winner is the first fitting entry
 * whose cumulative weight *exceeds* it, so every candidate owns exactly
 * `weight` of the `total` values and none owns a value twice: `r = 0` selects
 * the first candidate, `r = total - 1` the last, and `r = total` cannot occur. A
 * source that returned it would silently make the final candidate
 * unselectable, so it is rejected rather than clamped.
 *
 * The selected entry is then removed, its pilgrims are deducted from the
 * quota, and both the candidate set and the total are recomputed. That is what
 * makes this sampling *without* replacement: an entry cannot win twice, and
 * every remaining entry's share of the next round grows accordingly.
 *
 * **The capacity filter is an eligibility rule, not a weighting change.** No
 * weight is scaled, penalised or recomputed anywhere here; a paired entry that
 * cannot fit the last place keeps the exact weight it entered with and is a
 * full candidate again on the next round that has room for it — including the
 * whole of the next quota, where capacity starts over. What changes between
 * rounds is *who is eligible*, which is the same thing removing a selected
 * entry already changed.
 *
 * Nothing is mutated. The array handed in is copied, and the entries in it are
 * returned as they arrived — they are the frozen evidence of what the draw ran
 * against, and this is a reader.
 *
 * The scan is linear per selection, so a draw is O(selections x entries). For a
 * commune — hundreds to thousands of entries and tens of places — that is
 * nothing, and it keeps the algorithm one obviously-correct loop. A faster
 * structure (a cumulative-weight tree) is only worth introducing if a real pool
 * ever makes it necessary; being able to follow the arithmetic by eye matters
 * more here than constant factors.
 */
export function weightedCapacitySample<E extends LotteryEntry>(
  entries: readonly E[],
  quotas: readonly number[],
  random: RandomIntSource,
): CapacitySelection<E> {
  assertUsableEntries(entries)
  assertUsableQuotas(quotas, totalPilgrimCapacity(entries))

  // A working copy: removal happens here, never in the caller's array. Order is
  // preserved on removal (rather than swapping the last entry into the gap) so
  // that the mapping from a random value to an entry stays as legible on the
  // tenth selection as on the first.
  const remaining = [...entries]

  const initialTotalWeight = remaining.reduce((sum, entry) => sum + entry.weight, 0)
  assertUsableTotal(initialTotalWeight)

  const phases: E[][] = []
  const events: SelectionEvent[] = []
  let selectionNumber = 0

  for (const [quotaIndex, quota] of quotas.entries()) {
    const selected: E[] = []
    let capacity = quota

    while (capacity > 0) {
      // The candidates for *this* step. Rebuilt each round because capacity
      // shrinks: a pair is a candidate while two places are open and not while
      // one is, and nothing about the pair itself changed in between.
      const candidates = remaining.filter((entry) => entry.pilgrimCount <= capacity)
      if (candidates.length === 0) {
        throw new UnfillableQuotaError(quotaIndex, capacity, remaining.length)
      }

      const totalActiveWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0)
      // Re-asserted per round rather than once: the candidate total is what the
      // random source is asked for, and it is a different number every round.
      assertUsableTotal(totalActiveWeight)

      const randomValue = random.randomInt(totalActiveWeight)
      assertDrawnInRange(randomValue, totalActiveWeight)

      const winner = candidates[indexAtCumulativeWeight(candidates, randomValue)]
      if (!winner) {
        throw new Error('Refusing to complete a draw: the selected index held no entry')
      }

      remaining.splice(remaining.indexOf(winner), 1)
      selected.push(winner)
      capacity -= winner.pilgrimCount

      selectionNumber += 1
      events.push({
        selectionNumber,
        totalActiveWeight,
        randomValue,
        selectedEntryId: winner.id,
        selectedWeight: winner.weight,
      })
    }

    phases.push(selected)
  }

  return { phases, events, initialTotalWeight }
}

/** The pilgrims a set of entries could place, if every one of them were drawn. */
export function totalPilgrimCapacity(entries: readonly LotteryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.pilgrimCount, 0)
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
 * An empty pool, a zero or negative weight, a fraction, a duplicated entry, a
 * group of no people — each of these is a corrupted input rather than an edge
 * case to accommodate, and each would fail in a way that looks like a valid
 * draw. A zero-weight entry in particular would sit in the pool and be
 * structurally unselectable, which is an eligibility decision made by
 * arithmetic; a zero-pilgrim entry would consume a selection and fill no place.
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
    if (!Number.isSafeInteger(entry.pilgrimCount) || entry.pilgrimCount < 1) {
      throw new Error(
        `Refusing to draw an entry whose pilgrim count is not a positive integer: ${entry.pilgrimCount}`,
      )
    }
  }
}

/**
 * How many pilgrims may be placed.
 *
 * More places than the pool can carry is **refused, not truncated**. The pool
 * is allowed to be smaller than the allocation — freezing accepts that
 * deliberately — so what to do about it is a policy question, and quietly
 * placing everybody would answer it invisibly on the domain's behalf. See
 * docs/lottery-engine.md; the service turns this into a typed
 * `INSUFFICIENT_DRAW_ENTRIES`.
 *
 * Capacity, not row count: a pool of twelve entries holds between twelve and
 * twenty-four pilgrim places, and only the pilgrim figure says whether a
 * twelve place draw and its reserve list can both be filled.
 */
function assertUsableQuotas(quotas: readonly number[], availablePilgrims: number): void {
  if (quotas.length === 0) {
    throw new Error('Refusing to draw with no quota to fill')
  }

  let total = 0
  for (const quota of quotas) {
    if (!Number.isSafeInteger(quota) || quota < 1) {
      throw new Error(`Refusing to draw a pilgrim quota that is not a positive integer: ${quota}`)
    }
    total += quota
  }

  if (total > availablePilgrims) {
    throw new Error(`Refusing to place ${total} pilgrims from a pool holding ${availablePilgrims}`)
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
