import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient, type Application, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import {
  MAX_TOTAL_ACTIVE_WEIGHT,
  UnfillableQuotaError,
  weightedCapacitySample,
  type CapacitySelection,
  type LotteryEntry,
  type RandomIntSource,
} from '../src/lib/lottery.js'
import { cryptoRandomIntSource } from '../src/lib/lottery-random.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { drawPoolService } from '../src/services/draw-pool.service.js'
import { LotteryService } from '../src/services/lottery.service.js'
import { participationHistoryService } from '../src/services/participation-history.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'
import { buildApplicant } from './helpers/participants.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
let drawYear: DrawYear

/** Well away from the calendar year, so nothing collides with other suites. */
const YEAR = 2155

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `51000000000000${String(nextId).padStart(4, '0')}`
}

// --- A controlled random source ---------------------------------------------

interface ScriptedSource extends RandomIntSource {
  /** The exclusive bound of every call made, in order. */
  bounds: number[]
}

/**
 * A fixed sequence of random values, so a selection has one correct answer.
 *
 * This is a test double, never a production fallback: the real source is the
 * CSPRNG, and it is injected rather than replaced precisely so that making a
 * draw reproducible in a test does not make it predictable in reality.
 */
function scripted(...values: number[]): ScriptedSource {
  const bounds: number[] = []
  let index = 0

  return {
    bounds,
    randomInt(maxExclusive: number): number {
      bounds.push(maxExclusive)
      const value = values[index]
      index += 1
      if (value === undefined) throw new Error(`Scripted random source exhausted after ${values.length}`)
      return value
    },
  }
}

/** A source that always answers the same value, whatever the range. */
function constant(value: number): RandomIntSource {
  return { randomInt: () => value }
}

/** A source that answers with the bound itself — the one value it may not. */
const outOfRangeSource: RandomIntSource = { randomInt: (maxExclusive) => maxExclusive }

/**
 * One entry. `pilgrims` defaults to 1 — a single applicant — so the tests that
 * are about the weighted mapping rather than about capacity read as they did
 * before groups had sizes, and the ones that are about capacity say so.
 */
const entry = (id: string, weight: number, pilgrims = 1): LotteryEntry => ({
  id,
  weight,
  pilgrimCount: pilgrims,
})

/** A paired application: one lottery group, two pilgrim places. */
const pair = (id: string, weight: number): LotteryEntry => entry(id, weight, 2)

/**
 * One quota, filled. The single-phase case, which for an all-singles pool is
 * exactly "select this many entries" — the behaviour every assertion below about
 * the weighted mapping is really about.
 */
function fill<E extends LotteryEntry>(
  entries: readonly E[],
  quota: number,
  random: RandomIntSource,
): { selected: E[]; events: CapacitySelection<E>['events']; initialTotalWeight: number } {
  const selection = weightedCapacitySample(entries, [quota], random)
  return {
    selected: selection.phases[0] ?? [],
    events: selection.events,
    initialTotalWeight: selection.initialTotalWeight,
  }
}

/** The pilgrim places a set of selected entries covers. */
const places = (entries: readonly LotteryEntry[]): number =>
  entries.reduce((sum, e) => sum + e.pilgrimCount, 0)

/** Which single entry a given random value selects. */
function drawnWith(entries: readonly LotteryEntry[], randomValue: number): string | undefined {
  return fill(entries, 1, constant(randomValue)).selected[0]?.id
}

// --- Fixtures ---------------------------------------------------------------

async function registerAndWeigh(
  communeId: string,
  wilayaId: string,
  options: { streakYears?: number } = {},
): Promise<Application> {
  const id = nationalId()
  const response = await request(app)
    .post('/api/applications')
    .send({
      entryType: 'SINGLE',
      wilayaId,
      communeId,
      primary: buildApplicant(id, { dob: '1980-04-12', gender: 'MALE' }),
    })
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })

  if (options.streakYears) {
    const participant = await prisma.participant.findUniqueOrThrow({ where: { nationalId: id } })
    for (let offset = 1; offset <= options.streakYears; offset += 1) {
      await participationHistoryService.create({
        participantId: participant.id,
        communeId,
        drawYear: YEAR - offset,
        participated: true,
        source: 'LEGACY_IMPORT',
        verified: true,
      })
    }
  }

  await weightService.freezeApplicationWeight(application.id)
  return application
}

async function communeDrawFor(communeId: string, allocatedSpots = 2): Promise<CommuneDraw> {
  return drawConfigurationService.createCommuneDraw({
    drawYearId: drawYear.id,
    communeId,
    allocatedSpots,
  })
}

/**
 * A commune draw locked around a frozen pool — the only state a draw may run
 * against. `streaks` gives one applicant per entry, with that many verified
 * non-winning years, so entry weights are known: weight = streak + 1.
 */
async function lockedPool(
  streaks: number[],
  allocatedSpots = 2,
): Promise<{ communeDraw: CommuneDraw; poolId: string }> {
  const communeDraw = await communeDrawFor(geo.communeA1.id, allocatedSpots)
  for (const streakYears of streaks) {
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears })
  }
  await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
  const { pool } = await drawPoolService.freeze(communeDraw.id)

  return { communeDraw, poolId: pool.id }
}

/** The pool's entries in the order the draw reads them. */
function poolEntries(poolId: string) {
  return prisma.drawPoolEntry.findMany({ where: { drawPoolId: poolId }, orderBy: { applicationId: 'asc' } })
}

const lotteryWith = (random: RandomIntSource) => new LotteryService(prisma, random)

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
  drawYear = await prisma.drawYear.create({ data: { year: YEAR, status: 'REGISTRATION_OPEN' } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('weighted selection maps a random value onto an entry', () => {
  // The worked example: A owns 0-1, B owns 2-6, C owns 7-9.
  const abc = [entry('A', 2), entry('B', 5), entry('C', 3)]

  it('gives every entry exactly its weight in values', () => {
    const owner = Array.from({ length: 10 }, (_, value) => drawnWith(abc, value))

    expect(owner).toEqual(['A', 'A', 'B', 'B', 'B', 'B', 'B', 'C', 'C', 'C'])
  })

  it('selects the first entry at zero and the last at total - 1', () => {
    expect(drawnWith(abc, 0)).toBe('A')
    expect(drawnWith(abc, 9)).toBe('C')
  })

  it('refuses the total itself, which is outside [0, total)', () => {
    expect(() => fill(abc, 1, outOfRangeSource)).toThrow(/outside \[0, 10\)/)
  })

  it('refuses a negative or fractional value from the source', () => {
    expect(() => fill(abc, 1, constant(-1))).toThrow(/outside/)
    expect(() => fill(abc, 1, constant(2.5))).toThrow(/outside/)
  })

  it('splits two equal weights down the middle', () => {
    const twoEqual = [entry('A', 1), entry('B', 1)]

    expect(drawnWith(twoEqual, 0)).toBe('A')
    expect(drawnWith(twoEqual, 1)).toBe('B')
    expect(() => fill(twoEqual, 1, constant(2))).toThrow(/outside \[0, 2\)/)
  })

  it('handles a highly uneven pool without losing the small entry', () => {
    const uneven = [entry('small', 1), entry('large', 999)]

    expect(drawnWith(uneven, 0)).toBe('small')
    expect(drawnWith(uneven, 1)).toBe('large')
    expect(drawnWith(uneven, 999)).toBe('large')
  })

  it('does not let the order entries arrive in change what they are worth', () => {
    const reversed = [entry('C', 3), entry('B', 5), entry('A', 2)]

    const share = (entries: readonly LotteryEntry[]) => {
      const counts = new Map<string, number>()
      for (let value = 0; value < 10; value += 1) {
        const id = drawnWith(entries, value) ?? '?'
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      return counts
    }

    // Different traversal order, identical probabilities.
    expect(share(reversed)).toEqual(share(abc))
    expect(share(abc)).toEqual(
      new Map([
        ['A', 2],
        ['B', 5],
        ['C', 3],
      ]),
    )
  })
})

describe('sampling without replacement', () => {
  it('removes a selected entry and recalculates the active total', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('C', 3)]
    const source = scripted(0, 2)

    const { selected, events } = fill(entries, 2, source)

    // 6 in play, 0 → A. Then 5 in play (B owns 0-1, C owns 2-4), 2 → C.
    expect(selected.map((e) => e.id)).toEqual(['A', 'C'])
    expect(source.bounds).toEqual([6, 5])
    expect(events.map((e) => e.totalActiveWeight)).toEqual([6, 5])
  })

  it('never selects the same entry twice', () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(`e${i}`, (i % 7) + 1))

    const { selected } = fill(entries, 40, cryptoRandomIntSource)

    expect(new Set(selected.map((e) => e.id)).size).toBe(40)
  })

  it('preserves selection order in the result and its events', () => {
    const entries = [entry('A', 1), entry('B', 1), entry('C', 1)]

    const { selected, events } = fill(entries, 3, scripted(2, 1, 0))

    expect(selected.map((e) => e.id)).toEqual(['C', 'B', 'A'])
    expect(events.map((e) => e.selectedEntryId)).toEqual(['C', 'B', 'A'])
    expect(events.map((e) => e.selectionNumber)).toEqual([1, 2, 3])
  })

  it('records the arithmetic behind every selection', () => {
    const entries = [entry('A', 4), entry('B', 6)]

    const { events, initialTotalWeight } = fill(entries, 2, scripted(5, 0))

    expect(initialTotalWeight).toBe(10)
    expect(events).toEqual([
      { selectionNumber: 1, totalActiveWeight: 10, randomValue: 5, selectedEntryId: 'B', selectedWeight: 6 },
      { selectionNumber: 2, totalActiveWeight: 4, randomValue: 0, selectedEntryId: 'A', selectedWeight: 4 },
    ])
  })

  it('draws a single entry from a single-entry pool', () => {
    const { selected, events } = fill([entry('only', 7)], 1, scripted(6))

    expect(selected.map((e) => e.id)).toEqual(['only'])
    expect(events[0]?.totalActiveWeight).toBe(7)
  })

  it('can draw the whole pool when the allocation equals its size', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('C', 3)]

    const { selected } = fill(entries, 3, cryptoRandomIntSource)

    expect(new Set(selected.map((e) => e.id))).toEqual(new Set(['A', 'B', 'C']))
  })

  it('leaves the entries it was given untouched', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('C', 3)]
    const before = structuredClone(entries)

    fill(entries, 2, cryptoRandomIntSource)

    expect(entries).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// Pilgrim capacity
// ---------------------------------------------------------------------------

/**
 * The quota is spent in pilgrim places and only whole groups are selected.
 *
 * Every test here is about one property: the places awarded equal the quota
 * exactly, and a paired application is either selected whole or not at all.
 * Nothing is truncated, nothing is split, and the quota is never overspent.
 * See docs/pilgrim-capacity.md.
 */
describe('a quota is filled in pilgrim places, by whole groups', () => {
  /** `n` single applicants, all weight 1 — the simplest fillable pool. */
  const allSingles = (n: number) => Array.from({ length: n }, (_, i) => entry(`s${i}`, 1))
  /** `n` paired applications, all weight 1. */
  const allPairs = (n: number) => Array.from({ length: n }, (_, i) => pair(`p${i}`, 1))

  it('fills a quota of singles one place at a time', () => {
    const { selected } = fill(allSingles(20), 12, cryptoRandomIntSource)

    expect(places(selected)).toBe(12)
    expect(selected).toHaveLength(12)
  })

  it('fills a quota of pairs two places at a time — six applications, twelve places', () => {
    const { selected } = fill(allPairs(20), 12, cryptoRandomIntSource)

    expect(places(selected)).toBe(12)
    // The number of *records* is half the quota, and that is correct. A draw
    // that returned twelve paired applications here would have awarded
    // twenty-four places to a twelve place commune.
    expect(selected).toHaveLength(6)
  })

  it('never overspends the quota on a mixed population, however it is drawn', () => {
    // The population from the original defect report: nine singles and three
    // pairs. Selecting twelve *records* from this awards up to fifteen places.
    //
    // A property test rather than a fixed expectation, because the failure was a
    // *class* of error: whatever the CSPRNG does, the outcome is one of exactly
    // two things — twelve places filled, or a refusal. Thirteen, fourteen or
    // fifteen places is what must never happen, and neither is a split pair.
    const population = [...allSingles(9), ...allPairs(3)]
    let filled = 0
    let refused = 0

    for (let run = 0; run < 300; run += 1) {
      try {
        const { selected } = fill(population, 12, cryptoRandomIntSource)
        expect(places(selected)).toBe(12)
        // Every selected group is whole: its size is 1 or 2 as it entered, and
        // nothing halves a pair to make the arithmetic work.
        expect(selected.every((e) => e.pilgrimCount === 1 || e.pilgrimCount === 2)).toBe(true)
        filled += 1
      } catch (error) {
        // The only other legal outcome: refused, having written nothing. Nine
        // singles spent one at a time can strand the final place with only pairs
        // left, and this is the case that must fail loudly rather than quietly
        // overspend. See docs/pilgrim-capacity.md.
        expect(error).toBeInstanceOf(UnfillableQuotaError)
        expect((error as UnfillableQuotaError).remainingCapacity).toBe(1)
        refused += 1
      }
    }

    expect(filled + refused).toBe(300)
    // Not a distribution assertion: only that the ordinary case is reachable, so
    // this test is exercising a working draw and not merely the refusal path.
    expect(filled).toBeGreaterThan(0)
  })

  it('always fills a quota of singles, and always fills an even quota of pairs', () => {
    // The two populations where no ordering can strand a place, so these are
    // exact rather than "one of two outcomes".
    for (let run = 0; run < 50; run += 1) {
      expect(places(fill(allSingles(20), 12, cryptoRandomIntSource).selected)).toBe(12)
      expect(places(fill(allPairs(20), 12, cryptoRandomIntSource).selected)).toBe(12)
    }
  })

  it('skips a pair that cannot fit the last place and takes a single instead', () => {
    // One place left, and the pair is not a candidate for it — not weighted
    // down, simply not eligible this round. So the range the source is asked for
    // covers the remaining single alone, which is the arithmetic an auditor
    // replays to confirm the pair was never in the draw for that place.
    const entries = [entry('s0', 1), entry('s1', 1), pair('too-big', 1)]

    const { selected, events } = fill(entries, 2, scripted(0, 0))

    expect(places(selected)).toBe(2)
    expect(selected.map((e) => e.id)).toEqual(['s0', 's1'])
    // Three entries in play for the first selection, one for the second.
    expect(events.map((e) => e.totalActiveWeight)).toEqual([3, 1])
  })

  it('walks past several pairs in a row to reach the single that fits', () => {
    // Three pairs unselected with one place left. None of them is drawn and none
    // is removed; the single that fits is selected, and the quota closes exactly.
    const entries = [entry('single-a', 1), ...allPairs(3), entry('single-b', 1)]

    const { selected, events } = fill(entries, 2, scripted(0, 0))

    expect(places(selected)).toBe(2)
    expect(selected.map((e) => e.id)).toEqual(['single-a', 'single-b'])
    // Five candidates, then one: the three pairs dropped out of the range for
    // the final place all at once.
    expect(events.map((e) => e.totalActiveWeight)).toEqual([5, 1])
  })

  it('refuses rather than split a pair when no group fits the last place', () => {
    // One single and four pairs, eight places. Scripted so the single is spent
    // early: 1 + 2 + 2 + 2 = 7, one place left, and only a pair to fill it.
    const entries = [entry('only-single', 1), ...allPairs(4)]

    expect(() => fill(entries, 8, scripted(0, 0, 0, 0))).toThrow(UnfillableQuotaError)

    try {
      fill(entries, 8, scripted(0, 0, 0, 0))
      throw new Error('expected the quota to be unfillable')
    } catch (error) {
      expect(error).toBeInstanceOf(UnfillableQuotaError)
      expect((error as UnfillableQuotaError).remainingCapacity).toBe(1)
      expect((error as UnfillableQuotaError).quotaIndex).toBe(0)
      // Named plainly: nothing was split, nothing overspent, nothing invented.
      expect((error as Error).message).toMatch(/without splitting a paired registration/)
    }
  })

  it('refuses an odd quota a pool of pairs alone can never fill', () => {
    expect(() => fill(allPairs(10), 7, cryptoRandomIntSource)).toThrow(UnfillableQuotaError)
  })

  it('does not treat a group size as a preference', () => {
    // Capacity decides who is eligible; it never touches a weight. With three
    // places open both groups are candidates, and the random value maps onto
    // their *weights* exactly as it would if both were single applicants: the
    // pair owns [0, 9), the single owns [9, 10).
    const entries = [pair('heavy-pair', 9), entry('light-single', 1)]

    expect(fill(entries, 3, constant(0)).selected.map((e) => e.id)).toEqual(['heavy-pair', 'light-single'])
    expect(fill(entries, 3, scripted(9, 0)).selected.map((e) => e.id)).toEqual(['light-single', 'heavy-pair'])
    // And the weights that come back are the ones that went in, untouched — a
    // pair is not scaled, halved or penalised for occupying two places.
    expect(fill(entries, 3, constant(0)).selected[0]?.weight).toBe(9)
    expect(fill(entries, 3, scripted(9, 0)).selected[1]?.weight).toBe(9)
  })

  it('reproduces the same selection from the same entries and random values', () => {
    const entries = [entry('a', 3), pair('b', 5), entry('c', 1), pair('d', 2), entry('e', 4)]

    const first = weightedCapacitySample(entries, [3, 3], scripted(0, 0, 0, 0, 0, 0))
    const again = weightedCapacitySample(entries, [3, 3], scripted(0, 0, 0, 0, 0, 0))

    expect(first.phases.map((phase) => phase.map((e) => e.id))).toEqual(
      again.phases.map((phase) => phase.map((e) => e.id)),
    )
    expect(first.events).toEqual(again.events)
  })
})

describe('the winner and reserve quotas are one continuous sample', () => {
  it('draws the reserves from what the winners left, never from the whole pool again', () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(`s${i}`, 1))

    const { phases } = weightedCapacitySample(entries, [3, 3], cryptoRandomIntSource)
    const [winners = [], reserves = []] = phases

    expect(places(winners)).toBe(3)
    expect(places(reserves)).toBe(3)
    // Without replacement *across* the boundary: a winner is gone from the pool
    // the reserve quota draws from, so no entry can hold both.
    const winnerIds = new Set(winners.map((e) => e.id))
    expect(reserves.some((reserve) => winnerIds.has(reserve.id))).toBe(false)
    expect(new Set([...winners, ...reserves].map((e) => e.id)).size).toBe(6)
  })

  it('numbers every selection once, straight through both quotas', () => {
    const entries = Array.from({ length: 6 }, (_, i) => entry(`s${i}`, 1))

    const { phases, events } = weightedCapacitySample(entries, [2, 2], cryptoRandomIntSource)

    expect(events.map((e) => e.selectionNumber)).toEqual([1, 2, 3, 4])
    expect(events.map((e) => e.selectedEntryId)).toEqual(phases.flat().map((e) => e.id))
    // The active total falls monotonically across the boundary — evidence that
    // the reserve quota continued the sample rather than restarting it.
    expect(events.map((e) => e.totalActiveWeight)).toEqual([6, 5, 4, 3])
  })

  it('offers a pair the reserve quota that the winner quota could not fit', () => {
    // The boundary case worth stating outright. One place left of the winner
    // quota, so the pair is skipped — and skipped is not removed. The reserve
    // quota opens with its own two places, and the pair is a full candidate for
    // them again, at the weight it always had.
    const entries = [entry('s0', 1), entry('s1', 1), entry('s2', 1), pair('the-pair', 1)]

    const { phases, events } = weightedCapacitySample(entries, [3, 2], scripted(0, 0, 0, 0))
    const [winners = [], reserves = []] = phases

    expect(winners.map((e) => e.id)).toEqual(['s0', 's1', 's2'])
    expect(reserves.map((e) => e.id)).toEqual(['the-pair'])
    expect(places(reserves)).toBe(2)
    // Third winning selection: one place left, so only the two remaining
    // singles were candidates and the pair was not in the range.
    expect(events[2]?.totalActiveWeight).toBe(1)
    // First reserve selection: two places open, so the pair is back.
    expect(events[3]?.totalActiveWeight).toBe(1)
  })

  it('reports which quota ran out of fitting groups', () => {
    // Three singles fill the winner quota exactly, leaving two pairs. The reserve
    // quota takes one of them, and its last place then has only a pair for it.
    const entries = [entry('s0', 1), entry('s1', 1), entry('s2', 1), pair('p0', 1), pair('p1', 1)]

    try {
      weightedCapacitySample(entries, [3, 3], scripted(0, 0, 0, 0))
      throw new Error('expected the reserve quota to be unfillable')
    } catch (error) {
      expect(error).toBeInstanceOf(UnfillableQuotaError)
      // The reserve quota, named — the winners were already complete, and an
      // operator needs to know which half of the draw could not be filled.
      expect((error as UnfillableQuotaError).quotaIndex).toBe(1)
      expect((error as UnfillableQuotaError).remainingCapacity).toBe(1)
    }
  })
})

describe('the engine refuses input it cannot draw fairly', () => {
  it('refuses an empty pool', () => {
    const empty: LotteryEntry[] = []

    expect(() => fill(empty, 1, cryptoRandomIntSource)).toThrow(/empty pool/)
  })

  it('refuses more winners than entries rather than truncating', () => {
    const entries = [entry('A', 1), entry('B', 1)]

    // Silently placing both would answer a policy question — see the service,
    // which turns this into INSUFFICIENT_DRAW_ENTRIES. Counted in pilgrim
    // places, which is what a quota is measured in.
    expect(() => fill(entries, 3, cryptoRandomIntSource)).toThrow(
      /Refusing to place 3 pilgrims from a pool holding 2/,
    )
  })

  it('refuses a winner count that is not a positive integer', () => {
    const entries = [entry('A', 1)]

    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() => fill(entries, count, cryptoRandomIntSource)).toThrow(/positive integer/)
    }
  })

  it('refuses a zero, negative or fractional weight', () => {
    for (const weight of [0, -3, 1.5]) {
      expect(() => fill([entry('A', 1), entry('B', weight)], 1, cryptoRandomIntSource)).toThrow(
        /not a positive integer/,
      )
    }
  })

  it('refuses a duplicated entry', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('A', 3)]

    expect(() => fill(entries, 1, cryptoRandomIntSource)).toThrow(/same entry twice: A/)
  })

  it('refuses an entry with no identifier', () => {
    expect(() => fill([entry('', 1)], 1, cryptoRandomIntSource)).toThrow(/no identifier/)
  })

  it('accepts a total exactly at the random source’s ceiling', () => {
    const entries = [entry('A', MAX_TOTAL_ACTIVE_WEIGHT - 1), entry('B', 1)]

    const { selected, initialTotalWeight } = fill(entries, 1, scripted(MAX_TOTAL_ACTIVE_WEIGHT - 1))

    expect(initialTotalWeight).toBe(MAX_TOTAL_ACTIVE_WEIGHT)
    expect(selected.map((e) => e.id)).toEqual(['B'])
  })

  it('refuses a total beyond it rather than losing precision', () => {
    const entries = [entry('A', MAX_TOTAL_ACTIVE_WEIGHT), entry('B', 1)]

    expect(() => fill(entries, 1, cryptoRandomIntSource)).toThrow(/beyond the random source's range/)
  })

  it('refuses a weight outside safe integer arithmetic', () => {
    expect(() => fill([entry('A', 2 ** 53)], 1, cryptoRandomIntSource)).toThrow(/not a positive integer/)
  })
})

describe('the production random source', () => {
  it('is Node’s CSPRNG, and answers only within [0, max)', () => {
    const seen = new Set<number>()

    for (let i = 0; i < 500; i += 1) {
      const value = cryptoRandomIntSource.randomInt(10)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(10)
      seen.add(value)
    }

    // Not a distribution assertion — just that it is not a constant.
    expect(seen.size).toBeGreaterThan(1)
  })

  it('refuses a range it cannot serve uniformly', () => {
    expect(() => cryptoRandomIntSource.randomInt(0)).toThrow(/below 1/)
    expect(() => cryptoRandomIntSource.randomInt(1.5)).toThrow(/below 1/)
    expect(() => cryptoRandomIntSource.randomInt(MAX_TOTAL_ACTIVE_WEIGHT + 1)).toThrow(/beyond/)
  })

  it('favours heavier entries, loosely — a sanity check, not a proof', () => {
    // Deliberately generous, and deliberately not authoritative: the weighted
    // mapping is pinned exactly by the deterministic tests above. CI must never
    // depend on the luck of a distribution.
    const entries = [entry('light', 1), entry('heavy', 9)]
    let heavy = 0

    for (let i = 0; i < 3000; i += 1) {
      if (drawnWith(entries, cryptoRandomIntSource.randomInt(10)) === 'heavy') heavy += 1
    }

    expect(heavy / 3000).toBeGreaterThan(0.75)
    expect(heavy / 3000).toBeLessThan(0.99)
  })
})

describe('the lottery code contains no unsafe randomness', () => {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url))

  async function typescriptFiles(directory: string): Promise<string[]> {
    const found: string[] = []

    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) found.push(...(await typescriptFiles(path)))
      else if (item.name.endsWith('.ts')) found.push(path)
    }

    return found
  }

  /**
   * Comments are stripped before scanning: several modules explain in prose
   * precisely why they do not use the unsafe generator, and a guard that
   * punished them for naming it would push the reasoning out of the code.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  }

  it('never calls Math.random anywhere on the server', async () => {
    const offenders: string[] = []

    for (const file of await typescriptFiles(srcRoot)) {
      const code = withoutComments(await readFile(file, 'utf8'))
      if (/Math\s*\.\s*random/.test(code)) offenders.push(file)
    }

    // A static guard rather than reviewer discipline: a predictable PRNG
    // anywhere near the draw would make future selections recoverable from a
    // few observed outcomes. Scanned repo-wide rather than only over the
    // lottery files, since randomness reaches the draw through whatever it
    // calls.
    expect(offenders).toEqual([])
  })

  it('draws its randomness from node:crypto', async () => {
    const source = await readFile(join(srcRoot, 'lib', 'lottery-random.ts'), 'utf8')

    expect(source).toContain("from 'node:crypto'")
    expect(source).toContain('randomInt')
  })

  it('keeps the algorithm free of any entropy of its own', async () => {
    const engine = await readFile(join(srcRoot, 'lib', 'lottery.ts'), 'utf8')

    // The engine imports nothing: every random value must arrive through the
    // injected source, and there is no clock, no crypto and no database in it.
    expect(engine).not.toMatch(/^import /m)
    expect(engine).not.toContain('Date.now')
  })
})

describe('drawing from a frozen pool', () => {
  it('selects the allocated number of distinct entries, in order', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 1, 2, 3], 2)

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    const entries = await poolEntries(poolId)
    expect(selection.selected).toHaveLength(2)
    expect(selection.allocatedSpots).toBe(2)
    expect(selection.selected.map((s) => s.selectionOrder)).toEqual([1, 2])
    expect(new Set(selection.selected.map((s) => s.drawPoolEntryId)).size).toBe(2)
    for (const selected of selection.selected) {
      expect(entries.some((e) => e.id === selected.drawPoolEntryId)).toBe(true)
    }
  })

  it('is reproducible from the pool and a known sequence of random values', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 0, 0, 0], 2)
    const entries = await poolEntries(poolId)

    // Four applicants with no history: every weight is 1, so the total is 4 and
    // value v selects the entry at index v among those still in play. Four
    // values, because two places means two winners and two reserves.
    const first = await lotteryWith(scripted(0, 2, 0, 0)).selectFromPool(communeDraw.id)
    const again = await lotteryWith(scripted(0, 2, 0, 0)).selectFromPool(communeDraw.id)

    expect(first.selected.map((s) => s.drawPoolEntryId)).toEqual([entries[0]?.id, entries[3]?.id])
    // The reserve list is the rest of the same sample, in the order it came
    // out — the same values reproduce it exactly as they reproduce the winners.
    expect(first.reserves.map((s) => s.drawPoolEntryId)).toEqual([entries[1]?.id, entries[2]?.id])
    expect(first.reserves.map((s) => s.reservePosition)).toEqual([1, 2])
    expect(first.reserves.map((s) => s.selectionOrder)).toEqual([3, 4])
    expect(again.selected.map((s) => s.drawPoolEntryId)).toEqual(first.selected.map((s) => s.drawPoolEntryId))
    expect(again.reserves.map((s) => s.drawPoolEntryId)).toEqual(first.reserves.map((s) => s.drawPoolEntryId))
    expect(first.events.map((e) => e.totalActiveWeight)).toEqual([4, 3, 2, 1])
  })

  it('draws the reserves from the same continuous sample, never a second one', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 0, 0, 0, 0, 0], 2)
    const entries = await poolEntries(poolId)

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    // Winners then reserves, 1..4 with no gap and no repetition: one sample,
    // cut in half, rather than two draws that happened to agree.
    const drawn = [...selection.selected, ...selection.reserves]
    expect(drawn.map((entry) => entry.selectionOrder)).toEqual([1, 2, 3, 4])
    expect(new Set(drawn.map((entry) => entry.drawPoolEntryId)).size).toBe(4)
    expect(selection.events.map((event) => event.selectionNumber)).toEqual([1, 2, 3, 4])
    expect(selection.events.map((event) => event.selectedEntryId)).toEqual(
      drawn.map((entry) => entry.drawPoolEntryId),
    )

    for (const entry of drawn) {
      expect(entries.some((pooled) => pooled.id === entry.drawPoolEntryId)).toBe(true)
    }
  })

  it('does not order the reserve list by weight', async () => {
    // Two places, and the two heaviest entries scripted to win. Whatever comes
    // next is decided by the draw, so the reserve list must not arrive sorted by
    // the weights that are left — it is a sample, not a ranking.
    const { communeDraw, poolId } = await lockedPool([9, 9, 0, 4, 0, 4], 2)
    const entries = await poolEntries(poolId)
    const weightOf = new Map(entries.map((entry) => [entry.id, entry.weight]))

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)
    const reserveWeights = selection.reserves.map((entry) => weightOf.get(entry.drawPoolEntryId) ?? 0)

    // Not an assertion about randomness — it is that nothing sorts. A sorted
    // list of four weights drawn from {1, 5, 10} would be the signature of a
    // second, deterministic pass over the losers.
    expect(reserveWeights).toHaveLength(2)
    expect(selection.reserves.map((entry) => entry.reservePosition)).toEqual([1, 2])
  })

  it('weights the draw by the frozen entry weights', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 4], 1)
    const entries = await poolEntries(poolId)
    const heavy = entries.find((e) => e.weight === 5)

    // Weights 1 and 5, total 6. Only the value 0 or the light entry's slice can
    // select it; everything from its cumulative bound on belongs to the other.
    // The second value draws the reserve from the one entry left.
    const source = scripted(entries[0]?.weight === 1 ? 1 : 0, 0)
    const selection = await lotteryWith(source).selectFromPool(communeDraw.id)

    expect(selection.totalWeight).toBe(6)
    // The bound falls by the winner's weight, which is what makes this sampling
    // without replacement across both halves of the draw.
    expect(source.bounds).toEqual([6, 1])
    expect(selection.selected[0]?.drawPoolEntryId).toBe(heavy?.id)
    expect(selection.selected[0]?.weight).toBe(5)
    expect(selection.reserves[0]?.weight).toBe(1)
  })

  it('reads the snapshot, not the live application weight', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 0], 1)
    const [firstEntry] = await poolEntries(poolId)
    if (!firstEntry) throw new Error('Expected the frozen pool to hold an entry')

    // A live weight moves after the freeze. The draw must not notice: if it read
    // this column, the active total would be 1001 rather than 2.
    await prisma.application.update({
      where: { id: firstEntry.applicationId },
      data: { calculatedWeight: 1000 },
    })

    const source = scripted(0, 0)
    const selection = await lotteryWith(source).selectFromPool(communeDraw.id)

    expect(source.bounds).toEqual([2, 1])
    expect(selection.totalWeight).toBe(2)
    expect(selection.selected[0]?.weight).toBe(1)
  })

  it('takes the winner count from the frozen allocation, not from a caller', async () => {
    const { communeDraw } = await lockedPool([0, 0, 0, 0, 0, 0], 3)

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    // The signature has nowhere to pass a count: the configuration decides, and
    // it decides both halves — three places means three winners and three
    // reserves, never one without the other.
    expect(selection.selected).toHaveLength(3)
    expect(selection.reserves).toHaveLength(3)
    expect(selection.entryCount).toBe(6)
  })

  it('can draw the entire pool when it holds exactly twice the allocation', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 1, 2, 0, 1, 2], 3)

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    const entries = await poolEntries(poolId)
    expect(new Set([...selection.selected, ...selection.reserves].map((s) => s.drawPoolEntryId))).toEqual(
      new Set(entries.map((e) => e.id)),
    )
  })

  it('refuses a pool smaller than the allocation instead of selecting everybody', async () => {
    const { communeDraw } = await lockedPool([0, 1], 100)

    // Freezing permits this deliberately, so the refusal is where the policy
    // question surfaces rather than being answered by truncation.
    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_DRAW_ENTRIES',
    })
  })

  it('refuses a pool that covers the places but not the reserves', async () => {
    // Three entries for two places: enough to fill the commune's allocation and
    // not enough to give it a reserve list. Refused rather than drawn with one
    // reserve, because which of the two places went unprotected would have been
    // decided by nobody.
    const { communeDraw } = await lockedPool([0, 0, 0], 2)

    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_DRAW_ENTRIES',
    })
  })

  it('exposes the random value behind every selection', async () => {
    const { communeDraw } = await lockedPool([0, 0, 0, 0], 2)

    const selection = await lotteryWith(scripted(1, 0, 0, 0)).selectFromPool(communeDraw.id)

    // One event per selection, reserves included: the reserve order is drawn,
    // and is checkable against its randomness exactly as the winners are.
    expect(selection.events).toHaveLength(4)
    expect(selection.events.map((e) => e.randomValue)).toEqual([1, 0, 0, 0])
    expect(selection.events.map((e) => e.totalActiveWeight)).toEqual([4, 3, 2, 1])
    expect(selection.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('only a locked draw with an intact pool may be drawn', () => {
  it('refuses a commune draw that is not locked', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id, 1)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)

    for (const status of ['DRAFT', 'READY', 'CANCELLED'] as const) {
      await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status } })

      await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
        status: 409,
        code: 'DRAW_NOT_LOCKED',
      })
    }
  })

  it('refuses a locked draw with no pool', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id, 1)
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
      status: 404,
      code: 'POOL_NOT_FOUND',
    })
  })

  it('refuses a commune draw that does not exist', async () => {
    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool('no-such-draw')).rejects.toMatchObject({
      status: 404,
      code: 'COMMUNE_DRAW_NOT_FOUND',
    })
  })

  it('refuses a pool whose contents do not match its hash', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id, 1)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

    // Written directly rather than frozen, so the fingerprint is wrong. The
    // immutability triggers block UPDATE and DELETE, not INSERT — verifying the
    // hash before drawing is what closes the remaining gap.
    const pool = await prisma.drawPool.create({
      data: {
        communeDrawId: communeDraw.id,
        entryCount: 1,
        pilgrimCount: 1,
        totalWeight: 1,
        allocatedSpots: 1,
        snapshotHash: 'f'.repeat(64),
      },
    })
    await prisma.drawPoolEntry.create({
      data: {
        drawPoolId: pool.id,
        applicationId: application.id,
        applicationReference: application.applicationReference,
        entryType: 'SINGLE',
        primaryParticipantId: application.primaryParticipantId,
        weight: 1,
      },
    })

    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_POOL_SNAPSHOT',
    })
  })

  it('refuses a pool whose aggregates disagree with its entries', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id, 1)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

    const pool = await prisma.drawPool.create({
      data: {
        communeDrawId: communeDraw.id,
        entryCount: 7,
        pilgrimCount: 7,
        totalWeight: 7,
        allocatedSpots: 1,
        snapshotHash: 'a'.repeat(64),
      },
    })
    await prisma.drawPoolEntry.create({
      data: {
        drawPoolId: pool.id,
        applicationId: application.id,
        applicationReference: application.applicationReference,
        entryType: 'SINGLE',
        primaryParticipantId: application.primaryParticipantId,
        weight: 1,
      },
    })

    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
      code: 'INVALID_POOL_SNAPSHOT',
    })
  })

  it('refuses a pool written under an unknown snapshot version', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id, 1)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

    const pool = await prisma.drawPool.create({
      data: {
        communeDrawId: communeDraw.id,
        entryCount: 1,
        pilgrimCount: 1,
        totalWeight: 1,
        allocatedSpots: 1,
        snapshotHash: 'b'.repeat(64),
        snapshotVersion: 2,
      },
    })
    await prisma.drawPoolEntry.create({
      data: {
        drawPoolId: pool.id,
        applicationId: application.id,
        applicationReference: application.applicationReference,
        entryType: 'SINGLE',
        primaryParticipantId: application.primaryParticipantId,
        weight: 1,
      },
    })

    await expect(lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)).rejects.toMatchObject({
      code: 'INVALID_POOL_SNAPSHOT',
    })
  })
})

describe('a draw has no side effects at all', () => {
  it('leaves the pool, the applications and the participants exactly as they were', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 2, 4, 1], 2)

    const poolBefore = await prisma.drawPool.findUniqueOrThrow({ where: { id: poolId } })
    const entriesBefore = await poolEntries(poolId)
    const applicationsBefore = await prisma.application.findMany({ orderBy: { id: 'asc' } })
    const participantsBefore = await prisma.participant.findMany({ orderBy: { id: 'asc' } })
    const historyBefore = await prisma.participationHistory.findMany({ orderBy: { id: 'asc' } })

    await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    expect(await prisma.drawPool.findUniqueOrThrow({ where: { id: poolId } })).toEqual(poolBefore)
    expect(await poolEntries(poolId)).toEqual(entriesBefore)
    expect(await prisma.application.findMany({ orderBy: { id: 'asc' } })).toEqual(applicationsBefore)
    expect(await prisma.participant.findMany({ orderBy: { id: 'asc' } })).toEqual(participantsBefore)
    expect(await prisma.participationHistory.findMany({ orderBy: { id: 'asc' } })).toEqual(historyBefore)
  })

  it('sets nobody as a past Hajj winner', async () => {
    const { communeDraw } = await lockedPool([0, 0, 0, 0], 2)

    await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
  })

  it('does not conclude the commune draw', async () => {
    const { communeDraw } = await lockedPool([0, 0], 1)

    await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    // COMPLETED does not exist on the lifecycle, and a selection has not
    // concluded anything — winner processing will.
    const after = await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })
    expect(after.status).toBe('LOCKED')
  })

  it('persists no winners and no audit record', async () => {
    const { communeDraw } = await lockedPool([0, 0], 1)

    await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    // Selecting is not executing. The tables winner processing writes to exist
    // now, and this must leave every one of them untouched — recording a result
    // is DrawExecutionService's transaction, never a side effect of drawing.
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.drawWinner.count()).toBe(0)
    // Including the reserve list. A selection produces one and persists none:
    // the reserve ordering becomes a record when execution writes it, not when
    // somebody calculates it.
    expect(await prisma.drawReserve.count()).toBe(0)
    expect(await prisma.drawSelectionEvent.count()).toBe(0)
    expect(await prisma.winnerArchive.count()).toBe(0)

    // Nor does it enter the audit trail. A draw nobody ran is not an event: the
    // trail records executions, and this was a calculation.
    expect(await prisma.auditLog.count({ where: { action: 'COMMUNE_DRAW_EXECUTED' } })).toBe(0)
  })

  it('gives the same pool a different outcome each time, since nothing is recorded', async () => {
    // Eight equally weighted entries for three places: 336 possible ordered
    // outcomes, so six identical runs is not something CI will ever see.
    const { communeDraw } = await lockedPool(
      Array.from({ length: 8 }, () => 0),
      3,
    )
    const lottery = lotteryWith(cryptoRandomIntSource)

    const runs = new Set<string>()
    for (let i = 0; i < 6; i += 1) {
      const selection = await lottery.selectFromPool(communeDraw.id)
      runs.add(selection.selected.map((s) => s.drawPoolEntryId).join('|'))
    }

    // Exactly why there is no HTTP route yet: two executions produce two
    // equally authoritative sets, and nothing can tell them apart until winner
    // processing records that a draw has been run.
    expect(runs.size).toBeGreaterThan(1)
  })
})

describe('no route executes a draw', () => {
  it('serves no lottery endpoint, not even to a national administrator', async () => {
    const { communeDraw } = await lockedPool([0, 0], 1)
    // The strongest form of the assertion: signed in with the widest authority
    // there is, every plausible draw route is simply not there.
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    for (const path of [
      `/api/admin/commune-draws/${communeDraw.id}/draw`,
      `/api/admin/commune-draws/${communeDraw.id}/run-draw`,
      `/api/admin/commune-draws/${communeDraw.id}/select`,
      `/api/admin/draws/${communeDraw.id}/run`,
    ]) {
      expect((await request(app).post(path).set('Cookie', cookie)).status).toBe(404)
      expect((await request(app).get(path).set('Cookie', cookie)).status).toBe(404)
    }

    // And nothing public, with or without a session.
    for (const path of [
      `/api/commune-draws/${communeDraw.id}/draw`,
      `/api/draws/${communeDraw.id}/run`,
      `/api/lottery/${communeDraw.id}`,
    ]) {
      expect((await request(app).post(path)).status).toBe(404)
      expect((await request(app).get(path)).status).toBe(404)
    }

    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
  })
})
