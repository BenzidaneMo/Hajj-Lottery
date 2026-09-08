import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient, type Application, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import {
  MAX_TOTAL_ACTIVE_WEIGHT,
  weightedSampleWithoutReplacement,
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

const entry = (id: string, weight: number): LotteryEntry => ({ id, weight })

/** Which single entry a given random value selects. */
function drawnWith(entries: readonly LotteryEntry[], randomValue: number): string | undefined {
  return weightedSampleWithoutReplacement(entries, 1, constant(randomValue)).selected[0]?.id
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
      primary: { nationalId: id, fullName: 'Draw Subject', dob: '1980-04-12' },
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
    expect(() => weightedSampleWithoutReplacement(abc, 1, outOfRangeSource)).toThrow(/outside \[0, 10\)/)
  })

  it('refuses a negative or fractional value from the source', () => {
    expect(() => weightedSampleWithoutReplacement(abc, 1, constant(-1))).toThrow(/outside/)
    expect(() => weightedSampleWithoutReplacement(abc, 1, constant(2.5))).toThrow(/outside/)
  })

  it('splits two equal weights down the middle', () => {
    const pair = [entry('A', 1), entry('B', 1)]

    expect(drawnWith(pair, 0)).toBe('A')
    expect(drawnWith(pair, 1)).toBe('B')
    expect(() => weightedSampleWithoutReplacement(pair, 1, constant(2))).toThrow(/outside \[0, 2\)/)
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

    const { selected, events } = weightedSampleWithoutReplacement(entries, 2, source)

    // 6 in play, 0 → A. Then 5 in play (B owns 0-1, C owns 2-4), 2 → C.
    expect(selected.map((e) => e.id)).toEqual(['A', 'C'])
    expect(source.bounds).toEqual([6, 5])
    expect(events.map((e) => e.totalActiveWeight)).toEqual([6, 5])
  })

  it('never selects the same entry twice', () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(`e${i}`, (i % 7) + 1))

    const { selected } = weightedSampleWithoutReplacement(entries, 40, cryptoRandomIntSource)

    expect(new Set(selected.map((e) => e.id)).size).toBe(40)
  })

  it('preserves selection order in the result and its events', () => {
    const entries = [entry('A', 1), entry('B', 1), entry('C', 1)]

    const { selected, events } = weightedSampleWithoutReplacement(entries, 3, scripted(2, 1, 0))

    expect(selected.map((e) => e.id)).toEqual(['C', 'B', 'A'])
    expect(events.map((e) => e.selectedEntryId)).toEqual(['C', 'B', 'A'])
    expect(events.map((e) => e.selectionNumber)).toEqual([1, 2, 3])
  })

  it('records the arithmetic behind every selection', () => {
    const entries = [entry('A', 4), entry('B', 6)]

    const { events, initialTotalWeight } = weightedSampleWithoutReplacement(entries, 2, scripted(5, 0))

    expect(initialTotalWeight).toBe(10)
    expect(events).toEqual([
      { selectionNumber: 1, totalActiveWeight: 10, randomValue: 5, selectedEntryId: 'B', selectedWeight: 6 },
      { selectionNumber: 2, totalActiveWeight: 4, randomValue: 0, selectedEntryId: 'A', selectedWeight: 4 },
    ])
  })

  it('draws a single entry from a single-entry pool', () => {
    const { selected, events } = weightedSampleWithoutReplacement([entry('only', 7)], 1, scripted(6))

    expect(selected.map((e) => e.id)).toEqual(['only'])
    expect(events[0]?.totalActiveWeight).toBe(7)
  })

  it('can draw the whole pool when the allocation equals its size', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('C', 3)]

    const { selected } = weightedSampleWithoutReplacement(entries, 3, cryptoRandomIntSource)

    expect(new Set(selected.map((e) => e.id))).toEqual(new Set(['A', 'B', 'C']))
  })

  it('leaves the entries it was given untouched', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('C', 3)]
    const before = structuredClone(entries)

    weightedSampleWithoutReplacement(entries, 2, cryptoRandomIntSource)

    expect(entries).toEqual(before)
  })
})

describe('the engine refuses input it cannot draw fairly', () => {
  it('refuses an empty pool', () => {
    const empty: LotteryEntry[] = []

    expect(() => weightedSampleWithoutReplacement(empty, 1, cryptoRandomIntSource)).toThrow(/empty pool/)
  })

  it('refuses more winners than entries rather than truncating', () => {
    const entries = [entry('A', 1), entry('B', 1)]

    // Silently returning both would answer a policy question — see the service,
    // which turns this into INSUFFICIENT_DRAW_ENTRIES.
    expect(() => weightedSampleWithoutReplacement(entries, 3, cryptoRandomIntSource)).toThrow(
      /Refusing to draw 3 winners from 2 entries/,
    )
  })

  it('refuses a winner count that is not a positive integer', () => {
    const entries = [entry('A', 1)]

    for (const count of [0, -1, 1.5, Number.NaN]) {
      expect(() => weightedSampleWithoutReplacement(entries, count, cryptoRandomIntSource)).toThrow(
        /positive integer/,
      )
    }
  })

  it('refuses a zero, negative or fractional weight', () => {
    for (const weight of [0, -3, 1.5]) {
      expect(() =>
        weightedSampleWithoutReplacement([entry('A', 1), entry('B', weight)], 1, cryptoRandomIntSource),
      ).toThrow(/not a positive integer/)
    }
  })

  it('refuses a duplicated entry', () => {
    const entries = [entry('A', 1), entry('B', 2), entry('A', 3)]

    expect(() => weightedSampleWithoutReplacement(entries, 1, cryptoRandomIntSource)).toThrow(
      /same entry twice: A/,
    )
  })

  it('refuses an entry with no identifier', () => {
    expect(() => weightedSampleWithoutReplacement([entry('', 1)], 1, cryptoRandomIntSource)).toThrow(
      /no identifier/,
    )
  })

  it('accepts a total exactly at the random source’s ceiling', () => {
    const entries = [entry('A', MAX_TOTAL_ACTIVE_WEIGHT - 1), entry('B', 1)]

    const { selected, initialTotalWeight } = weightedSampleWithoutReplacement(
      entries,
      1,
      scripted(MAX_TOTAL_ACTIVE_WEIGHT - 1),
    )

    expect(initialTotalWeight).toBe(MAX_TOTAL_ACTIVE_WEIGHT)
    expect(selected.map((e) => e.id)).toEqual(['B'])
  })

  it('refuses a total beyond it rather than losing precision', () => {
    const entries = [entry('A', MAX_TOTAL_ACTIVE_WEIGHT), entry('B', 1)]

    expect(() => weightedSampleWithoutReplacement(entries, 1, cryptoRandomIntSource)).toThrow(
      /beyond the random source's range/,
    )
  })

  it('refuses a weight outside safe integer arithmetic', () => {
    expect(() => weightedSampleWithoutReplacement([entry('A', 2 ** 53)], 1, cryptoRandomIntSource)).toThrow(
      /not a positive integer/,
    )
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
    // value v selects the entry at index v in application-id order.
    const first = await lotteryWith(scripted(0, 2)).selectFromPool(communeDraw.id)
    const again = await lotteryWith(scripted(0, 2)).selectFromPool(communeDraw.id)

    expect(first.selected.map((s) => s.drawPoolEntryId)).toEqual([entries[0]?.id, entries[3]?.id])
    expect(again.selected.map((s) => s.drawPoolEntryId)).toEqual(first.selected.map((s) => s.drawPoolEntryId))
    expect(first.events.map((e) => e.totalActiveWeight)).toEqual([4, 3])
  })

  it('weights the draw by the frozen entry weights', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 4], 1)
    const entries = await poolEntries(poolId)
    const heavy = entries.find((e) => e.weight === 5)

    // Weights 1 and 5, total 6. Only the value 0 or the light entry's slice can
    // select it; everything from its cumulative bound on belongs to the other.
    const source = scripted(entries[0]?.weight === 1 ? 1 : 0)
    const selection = await lotteryWith(source).selectFromPool(communeDraw.id)

    expect(selection.totalWeight).toBe(6)
    expect(source.bounds).toEqual([6])
    expect(selection.selected[0]?.drawPoolEntryId).toBe(heavy?.id)
    expect(selection.selected[0]?.weight).toBe(5)
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

    const source = scripted(0)
    const selection = await lotteryWith(source).selectFromPool(communeDraw.id)

    expect(source.bounds).toEqual([2])
    expect(selection.totalWeight).toBe(2)
    expect(selection.selected[0]?.weight).toBe(1)
  })

  it('takes the winner count from the frozen allocation, not from a caller', async () => {
    const { communeDraw } = await lockedPool([0, 0, 0], 3)

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    // The signature has nowhere to pass a count: the configuration decides.
    expect(selection.selected).toHaveLength(3)
    expect(selection.entryCount).toBe(3)
  })

  it('can draw the entire pool when the allocation matches it exactly', async () => {
    const { communeDraw, poolId } = await lockedPool([0, 1, 2], 3)

    const selection = await lotteryWith(cryptoRandomIntSource).selectFromPool(communeDraw.id)

    const entries = await poolEntries(poolId)
    expect(new Set(selection.selected.map((s) => s.drawPoolEntryId))).toEqual(
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

  it('exposes the random value behind every selection', async () => {
    const { communeDraw } = await lockedPool([0, 0, 0], 2)

    const selection = await lotteryWith(scripted(1, 0)).selectFromPool(communeDraw.id)

    expect(selection.events).toHaveLength(2)
    expect(selection.events.map((e) => e.randomValue)).toEqual([1, 0])
    expect(selection.events.map((e) => e.totalActiveWeight)).toEqual([3, 2])
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
    const { communeDraw, poolId } = await lockedPool([0, 2, 4], 2)

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
    const { communeDraw } = await lockedPool([0, 0], 2)

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

    // A fabricated result row would be worse than none, so the tables that will
    // eventually hold one do not exist yet.
    const tables = await prisma.$queryRaw<Array<{ name: string | null }>>`
      SELECT to_regclass(t)::text AS name
      FROM (VALUES ('winners_archive'), ('draw_results'), ('draw_winners'), ('audit_logs')) AS v(t)
    `
    expect(tables.map((row) => row.name)).toEqual([null, null, null, null])
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
