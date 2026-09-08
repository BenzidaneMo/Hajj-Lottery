import { PrismaClient, type Application, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { DrawExecutionService, drawExecutionService } from '../src/services/draw-execution.service.js'
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
const YEAR = 2145

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `52000000000000${String(nextId).padStart(4, '0')}`
}

// --- Fixtures ---------------------------------------------------------------

interface RegisterOptions {
  streakYears?: number
  paired?: boolean
}

async function register(
  communeId: string,
  wilayaId: string,
  options: RegisterOptions = {},
): Promise<Application> {
  const primaryId = nationalId()
  const body: Record<string, unknown> = {
    entryType: options.paired ? 'PAIRED' : 'SINGLE',
    wilayaId,
    communeId,
    primary: { nationalId: primaryId, fullName: 'Winner Subject', dob: '1980-04-12' },
  }
  if (options.paired) {
    body.secondary = { nationalId: nationalId(), fullName: 'Winner Partner', dob: '1982-06-30' }
  }

  const response = await request(app).post('/api/applications').send(body)
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })

  if (options.streakYears) {
    const participant = await prisma.participant.findUniqueOrThrow({ where: { nationalId: primaryId } })
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

/**
 * A locked commune draw with a frozen pool — the state a draw may be executed
 * from. One application per entry in `entries`.
 */
async function lockedPool(
  entries: RegisterOptions[],
  allocatedSpots = 2,
  commune: { id: string; wilayaId: string } = { id: geo.communeA1.id, wilayaId: geo.wilayaA.id },
): Promise<{ communeDraw: CommuneDraw; poolId: string; applications: Application[] }> {
  const communeDraw = await drawConfigurationService.createCommuneDraw({
    drawYearId: drawYear.id,
    communeId: commune.id,
    allocatedSpots,
  })

  const applications: Application[] = []
  for (const options of entries) {
    applications.push(await register(commune.id, commune.wilayaId, options))
  }

  await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
  const { pool } = await drawPoolService.freeze(communeDraw.id)

  return { communeDraw, poolId: pool.id, applications }
}

/** `n` single applicants with no history — every weight is 1. */
const singles = (n: number): RegisterOptions[] => Array.from({ length: n }, () => ({}))

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })
const communeAdmin = (wilayaId: string, communeId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId })

const executeVia = (id: string, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${id}/execute`).set('Cookie', cookie)

const resultVia = (id: string, cookie: string) =>
  request(app).get(`/api/admin/commune-draws/${id}/result`).set('Cookie', cookie)

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

describe('executing a draw', () => {
  it('records the result, its winners and their randomness', async () => {
    const { communeDraw, poolId } = await lockedPool(singles(5), 2)

    const execution = await drawExecutionService.execute(communeDraw.id, 'admin-1')

    const result = await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    const pool = await prisma.drawPool.findUniqueOrThrow({ where: { id: poolId } })

    expect(result.winnerCount).toBe(2)
    expect(result.drawPoolId).toBe(poolId)
    expect(result.poolHash).toBe(pool.snapshotHash)
    expect(result.algorithmVersion).toBe('weighted-csprng-v1')
    expect(result.totalWeightAtDraw).toBe(pool.totalWeight)
    expect(await prisma.drawWinner.count({ where: { drawResultId: result.id } })).toBe(2)
    expect(await prisma.drawSelectionEvent.count({ where: { drawResultId: result.id } })).toBe(2)
    expect(execution.drawResultId).toBe(result.id)
  })

  it('draws exactly the allocated number of places', async () => {
    const { communeDraw } = await lockedPool(singles(9), 4)

    await drawExecutionService.execute(communeDraw.id)

    const result = await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    expect(result.winnerCount).toBe(4)
    expect(await prisma.drawWinner.count()).toBe(4)
    expect(await prisma.application.count({ where: { status: 'SELECTED' } })).toBe(4)
  })

  it('preserves selection order as a contiguous 1-based sequence', async () => {
    const { communeDraw } = await lockedPool(singles(6), 4)

    await drawExecutionService.execute(communeDraw.id)

    const winners = await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } })
    expect(winners.map((winner) => winner.selectionOrder)).toEqual([1, 2, 3, 4])
    expect(new Set(winners.map((winner) => winner.drawPoolEntryId)).size).toBe(4)
  })

  it('preserves the random value behind every selection, in range', async () => {
    const { communeDraw } = await lockedPool(singles(5), 3)

    await drawExecutionService.execute(communeDraw.id)

    const events = await prisma.drawSelectionEvent.findMany({ orderBy: { selectionOrder: 'asc' } })
    expect(events.map((event) => event.selectionOrder)).toEqual([1, 2, 3])
    // Five entries of weight 1: the active total falls by one each round.
    expect(events.map((event) => event.activeTotalWeight)).toEqual([5, 4, 3])
    for (const event of events) {
      expect(event.randomValue).toBeGreaterThanOrEqual(0)
      expect(event.randomValue).toBeLessThan(event.activeTotalWeight)
    }
  })

  it('matches every event to the winner it selected', async () => {
    const { communeDraw } = await lockedPool(singles(4), 3)

    await drawExecutionService.execute(communeDraw.id)

    const winners = await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } })
    const events = await prisma.drawSelectionEvent.findMany({ orderBy: { selectionOrder: 'asc' } })

    expect(events.map((event) => event.selectedPoolEntryId)).toEqual(
      winners.map((winner) => winner.drawPoolEntryId),
    )
  })

  it('finalizes the commune draw and nothing else about it', async () => {
    const { communeDraw } = await lockedPool(singles(3), 1)
    const before = await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })

    await drawExecutionService.execute(communeDraw.id)

    const after = await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })
    expect(after.status).toBe('COMPLETED')
    expect(after.allocatedSpots).toBe(before.allocatedSpots)
    expect(after.communeId).toBe(before.communeId)
    expect(after.drawYearId).toBe(before.drawYearId)
  })

  it('leaves the frozen pool exactly as it was', async () => {
    const { communeDraw, poolId } = await lockedPool(singles(4), 2)
    const poolBefore = await prisma.drawPool.findUniqueOrThrow({ where: { id: poolId } })
    const entriesBefore = await prisma.drawPoolEntry.findMany({ orderBy: { id: 'asc' } })

    await drawExecutionService.execute(communeDraw.id)

    // Nothing marks an entry selected. Whether an entry won lives in the result.
    expect(await prisma.drawPool.findUniqueOrThrow({ where: { id: poolId } })).toEqual(poolBefore)
    expect(await prisma.drawPoolEntry.findMany({ orderBy: { id: 'asc' } })).toEqual(entriesBefore)
  })

  it('does not rewrite an application beyond its outcome', async () => {
    const { communeDraw } = await lockedPool(singles(3), 1)
    const before = await prisma.application.findMany({ orderBy: { id: 'asc' } })

    await drawExecutionService.execute(communeDraw.id)

    const after = await prisma.application.findMany({ orderBy: { id: 'asc' } })
    for (const [index, application] of after.entries()) {
      const previous = before[index]
      expect({ ...application, status: null, updatedAt: null }).toEqual({
        ...previous,
        status: null,
        updatedAt: null,
      })
    }
  })
})

describe('application outcomes', () => {
  it('marks drawn applications SELECTED and pooled others NOT_SELECTED', async () => {
    const { communeDraw } = await lockedPool(singles(5), 2)

    await drawExecutionService.execute(communeDraw.id)

    const winners = await prisma.drawWinner.findMany({ select: { applicationId: true } })
    const winnerIds = new Set(winners.map((winner) => winner.applicationId))

    for (const application of await prisma.application.findMany()) {
      expect(application.status).toBe(winnerIds.has(application.id) ? 'SELECTED' : 'NOT_SELECTED')
    }
    expect(await prisma.application.count({ where: { status: 'ELIGIBLE' } })).toBe(0)
  })

  it('leaves an application that never reached the pool alone', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)

    // Another commune's application, in the same year, in its own pool-less draw.
    const outsider = await prisma.application.findFirst({ where: { communeId: geo.communeA2.id } })
    expect(outsider).toBeNull()

    const other = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA2.id,
      allocatedSpots: 1,
    })
    await prisma.drawYear.update({ where: { id: drawYear.id }, data: { status: 'REGISTRATION_OPEN' } })
    const untouched = await register(geo.communeA2.id, geo.wilayaA.id)
    await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')

    await drawExecutionService.execute(communeDraw.id)

    const after = await prisma.application.findUniqueOrThrow({ where: { id: untouched.id } })
    expect(after.status).toBe('ELIGIBLE')
    // The neighbouring commune's own draw is not advanced by somebody else's.
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: other.id } })).status).toBe('DRAFT')
  })
})

describe('lifetime exclusion', () => {
  it('marks the winner of a single application', async () => {
    const { communeDraw } = await lockedPool(singles(4), 1)

    await drawExecutionService.execute(communeDraw.id)

    const winner = await prisma.drawWinner.findFirstOrThrow()
    const participant = await prisma.participant.findUniqueOrThrow({
      where: { id: winner.primaryParticipantId },
    })
    expect(participant.hasWonHajj).toBe(true)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(1)
  })

  it('marks both travellers of a paired application', async () => {
    // One paired entry, and it is the only entry, so it must be the winner.
    const { communeDraw } = await lockedPool([{ paired: true }], 1)

    await drawExecutionService.execute(communeDraw.id)

    const winner = await prisma.drawWinner.findFirstOrThrow()
    expect(winner.secondaryParticipantId).not.toBeNull()

    // Not only the primary: both people are excluded for life.
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(2)
    for (const id of [winner.primaryParticipantId, winner.secondaryParticipantId]) {
      const participant = await prisma.participant.findUniqueOrThrow({ where: { id: id ?? '' } })
      expect(participant.hasWonHajj).toBe(true)
    }
  })

  it('leaves everybody who was not drawn untouched', async () => {
    const { communeDraw } = await lockedPool(singles(5), 2)

    await drawExecutionService.execute(communeDraw.id)

    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(2)
    expect(await prisma.participant.count({ where: { hasWonHajj: false } })).toBe(3)
  })

  it('archives every winning individual exactly once', async () => {
    const { communeDraw } = await lockedPool([{ paired: true }, {}, {}], 2)

    await drawExecutionService.execute(communeDraw.id)

    const result = await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    const archive = await prisma.winnerArchive.findMany()
    const excluded = await prisma.participant.findMany({ where: { hasWonHajj: true } })

    // Every excluded participant is archived, and every archive row is one of
    // them: no completed draw contains an unarchived winner.
    expect(new Set(archive.map((row) => row.participantId))).toEqual(new Set(excluded.map((p) => p.id)))
    expect(archive).toHaveLength(excluded.length)
    for (const row of archive) {
      expect(row.drawResultId).toBe(result.id)
      expect(row.drawYear).toBe(YEAR)
      expect(row.communeId).toBe(geo.communeA1.id)
    }
  })

  it('refuses to archive a second win for the same person, at the database', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)
    await drawExecutionService.execute(communeDraw.id)
    const existing = await prisma.winnerArchive.findFirstOrThrow()

    await expect(
      prisma.winnerArchive.create({
        data: {
          participantId: existing.participantId,
          drawYear: YEAR + 1,
          communeId: existing.communeId,
          drawResultId: existing.drawResultId,
          drawPoolEntryId: existing.drawPoolEntryId,
          drawnAt: new Date(),
        },
      }),
    ).rejects.toThrow()
  })

  it('excludes a winner from applying again', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)
    await drawExecutionService.execute(communeDraw.id)

    const winner = await prisma.drawWinner.findFirstOrThrow()
    const participant = await prisma.participant.findUniqueOrThrow({
      where: { id: winner.primaryParticipantId },
    })

    // A fresh year, open for registration, with this commune configured.
    const nextYear = await prisma.drawYear.create({ data: { year: YEAR + 1, status: 'DRAFT' } })
    await drawConfigurationService.createCommuneDraw({
      drawYearId: nextYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 5,
    })
    await drawConfigurationService.updateDrawYearStatus(nextYear.id, 'REGISTRATION_OPEN')

    const response = await request(app)
      .post('/api/applications')
      .send({
        entryType: 'SINGLE',
        wilayaId: geo.wilayaA.id,
        communeId: geo.communeA1.id,
        primary: { nationalId: participant.nationalId, fullName: participant.fullName, dob: '1980-04-12' },
      })

    expect(response.status).toBe(422)
  })
})

describe('spot semantics: entries, not people', () => {
  it('counts a paired application as one place and two winners', async () => {
    // Every entry paired, so however the draw falls, two places is four people.
    const { communeDraw } = await lockedPool([{ paired: true }, { paired: true }, { paired: true }], 2)

    await drawExecutionService.execute(communeDraw.id)

    const result = await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    expect(result.winnerCount).toBe(2)
    expect(await prisma.drawWinner.count()).toBe(2)
    expect(await prisma.application.count({ where: { status: 'SELECTED' } })).toBe(2)

    // More individuals than places, which is expected and correct.
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(4)
    expect(await prisma.winnerArchive.count()).toBe(4)
  })
})

describe('participation history', () => {
  it('records every pooled participant, with the right outcome', async () => {
    const { communeDraw } = await lockedPool(singles(5), 2)

    await drawExecutionService.execute(communeDraw.id)

    const winners = await prisma.drawWinner.findMany({ select: { primaryParticipantId: true } })
    const winnerIds = new Set(winners.map((winner) => winner.primaryParticipantId))
    const history = await prisma.participationHistory.findMany({ where: { drawYear: YEAR } })

    expect(history).toHaveLength(5)
    for (const record of history) {
      expect(record.participated).toBe(true)
      expect(record.won).toBe(winnerIds.has(record.participantId))
      expect(record.source).toBe('APPLICATION')
      // Verified, or the streak walk would ignore every web-era year and the
      // next draw's weighting would silently reset everybody to zero.
      expect(record.verified).toBe(true)
      expect(record.communeId).toBe(geo.communeA1.id)
    }
  })

  it('records both travellers of a paired entry', async () => {
    const { communeDraw } = await lockedPool([{ paired: true }], 1)

    await drawExecutionService.execute(communeDraw.id)

    const history = await prisma.participationHistory.findMany({ where: { drawYear: YEAR } })
    expect(history).toHaveLength(2)
    expect(history.every((record) => record.won)).toBe(true)
  })

  it('creates nothing for an application that never reached the pool', async () => {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 1,
    })
    const pooled = await register(geo.communeA1.id, geo.wilayaA.id)

    // An ineligible application: refused before the pool, so it took no part.
    const rejected = await register(geo.communeA1.id, geo.wilayaA.id)
    await prisma.application.update({ where: { id: rejected.id }, data: { status: 'INELIGIBLE' } })

    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
    await drawPoolService.freeze(communeDraw.id)
    await drawExecutionService.execute(communeDraw.id)

    const history = await prisma.participationHistory.findMany({ where: { drawYear: YEAR } })
    expect(history).toHaveLength(1)
    expect(history[0]?.participantId).toBe(pooled.primaryParticipantId)

    // A refused applicant must not be credited with a non-winning year, which
    // would grow their priority for a draw they never entered.
    const refusedRecord = await prisma.participationHistory.findFirst({
      where: { participantId: rejected.primaryParticipantId },
    })
    expect(refusedRecord).toBeNull()
    expect((await prisma.application.findUniqueOrThrow({ where: { id: rejected.id } })).status).toBe(
      'INELIGIBLE',
    )
  })

  it('refuses to execute when a pooled participant already has this year on record', async () => {
    const { communeDraw, applications } = await lockedPool(singles(2), 1)
    const first = applications[0]
    if (!first) throw new Error('Expected an application')

    // A conflicting account of the same year — an administrator's import, say.
    await prisma.participationHistory.create({
      data: {
        participantId: first.primaryParticipantId,
        communeId: geo.communeA1.id,
        drawYear: YEAR,
        participated: true,
        source: 'LEGACY_IMPORT',
        verified: false,
      },
    })

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
      code: 'DUPLICATE_HISTORY_YEAR',
    })

    // And nothing was half-done.
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
  })
})

describe('a draw runs once, and only from a locked pool', () => {
  it('refuses a second execution after completion', async () => {
    const { communeDraw } = await lockedPool(singles(4), 2)
    await drawExecutionService.execute(communeDraw.id)
    const winnersBefore = await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } })

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'DRAW_ALREADY_COMPLETED',
    })

    expect(await prisma.drawResult.count()).toBe(1)
    expect(await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } })).toEqual(winnersBefore)
  })

  it('produces exactly one result under concurrent executions', async () => {
    const { communeDraw } = await lockedPool(singles(8), 3)

    const outcomes = await Promise.allSettled([
      drawExecutionService.execute(communeDraw.id),
      drawExecutionService.execute(communeDraw.id),
      drawExecutionService.execute(communeDraw.id),
    ])

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')

    // The conditional claim serializes them at the database, so no second
    // random selection can ever become authoritative.
    expect(fulfilled).toHaveLength(1)
    expect(await prisma.drawResult.count()).toBe(1)
    expect(await prisma.drawWinner.count()).toBe(3)
    expect(await prisma.drawSelectionEvent.count()).toBe(3)
    expect(await prisma.winnerArchive.count()).toBe(3)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(3)
    expect(await prisma.participationHistory.count({ where: { drawYear: YEAR } })).toBe(8)
  })

  it('refuses a commune draw that is not locked', async () => {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 1,
    })
    await register(geo.communeA1.id, geo.wilayaA.id)

    for (const status of ['DRAFT', 'READY', 'CANCELLED'] as const) {
      await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status } })

      await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
        status: 409,
        code: 'DRAW_NOT_LOCKED',
      })
    }

    expect(await prisma.drawResult.count()).toBe(0)
  })

  it('refuses a locked commune draw with no pool', async () => {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 1,
    })
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
      status: 404,
      code: 'POOL_NOT_FOUND',
    })

    // The claim rolled back: still locked, still executable once it has a pool.
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
  })

  it('refuses a pool whose contents no longer match its hash', async () => {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 1,
    })
    const application = await register(geo.communeA1.id, geo.wilayaA.id)
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

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

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
      code: 'INVALID_POOL_SNAPSHOT',
    })
    expect(await prisma.drawResult.count()).toBe(0)
  })

  it('refuses a pool smaller than the allocation, leaving the draw recoverable', async () => {
    const { communeDraw } = await lockedPool(singles(2), 100)

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_DRAW_ENTRIES',
    })

    // No partial result, no completion, and the allocation is untouched: the
    // situation needs an administrator, not a silent smaller draw.
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.drawWinner.count()).toBe(0)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
    expect(await prisma.participationHistory.count({ where: { drawYear: YEAR } })).toBe(0)

    const after = await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })
    expect(after.status).toBe('LOCKED')
    expect(after.allocatedSpots).toBe(100)
  })

  it('cannot be executed for a commune draw that does not exist', async () => {
    await expect(drawExecutionService.execute('no-such-commune-draw')).rejects.toMatchObject({
      status: 404,
      code: 'COMMUNE_DRAW_NOT_FOUND',
    })
  })
})

describe('a failed execution leaves nothing behind', () => {
  /**
   * A lottery service whose selection throws at the last moment — the state of
   * the world at that point is a claimed commune draw and nothing else, which is
   * the hardest moment to roll back cleanly.
   */
  class FailingLottery extends LotteryService {
    override async drawFrom(): Promise<never> {
      throw new Error('selection failed')
    }
  }

  it('rolls back the claim when selection fails', async () => {
    const { communeDraw } = await lockedPool(singles(3), 1)
    const failing = new DrawExecutionService(prisma, new FailingLottery(prisma))

    await expect(failing.execute(communeDraw.id)).rejects.toThrow(/selection failed/)

    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.drawWinner.count()).toBe(0)
    expect(await prisma.winnerArchive.count()).toBe(0)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
    expect(await prisma.participationHistory.count({ where: { drawYear: YEAR } })).toBe(0)
    expect(await prisma.application.count({ where: { status: 'ELIGIBLE' } })).toBe(3)
  })

  it('rolls back winner persistence when a participant vanishes mid-draw', async () => {
    const { communeDraw, poolId } = await lockedPool(singles(3), 1)

    // Deleting the participants is refused by the pool's own foreign keys, so
    // the failure is provoked where it can be: an archive row written for a
    // participant who already holds one. The whole transaction must unwind.
    const entry = await prisma.drawPoolEntry.findFirstOrThrow({ where: { drawPoolId: poolId } })
    const decoyDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeB1.id,
      allocatedSpots: 1,
    })
    await prisma.communeDraw.update({ where: { id: decoyDraw.id }, data: { status: 'LOCKED' } })
    const decoyPool = await prisma.drawPool.create({
      data: {
        communeDrawId: decoyDraw.id,
        entryCount: 1,
        totalWeight: 1,
        allocatedSpots: 1,
        snapshotHash: 'a'.repeat(64),
      },
    })
    const decoyResult = await prisma.drawResult.create({
      data: {
        communeDrawId: decoyDraw.id,
        drawPoolId: decoyPool.id,
        winnerCount: 1,
        totalWeightAtDraw: 1,
        poolHash: 'a'.repeat(64),
        algorithmVersion: 'weighted-csprng-v1',
        startedAt: new Date(),
        completedAt: new Date(),
      },
    })

    // Every pooled participant is already archived as a winner elsewhere, so
    // whichever one the draw picks collides on UNIQUE(participant_id).
    const entries = await prisma.drawPoolEntry.findMany({ where: { drawPoolId: poolId } })
    for (const pooled of entries) {
      await prisma.winnerArchive.create({
        data: {
          participantId: pooled.primaryParticipantId,
          drawYear: YEAR - 1,
          communeId: geo.communeB1.id,
          drawResultId: decoyResult.id,
          drawPoolEntryId: entry.id,
          drawnAt: new Date(),
        },
      })
    }

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toThrow()

    expect(await prisma.drawResult.count({ where: { communeDrawId: communeDraw.id } })).toBe(0)
    expect(await prisma.drawWinner.count()).toBe(0)
    expect(await prisma.participationHistory.count({ where: { drawYear: YEAR } })).toBe(0)
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
    // The pre-existing archive rows are untouched, and nobody gained exclusion.
    expect(await prisma.winnerArchive.count()).toBe(3)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
  })
})

describe('a completed result is immutable', () => {
  async function completed() {
    const { communeDraw, poolId } = await lockedPool(singles(4), 2)
    await drawExecutionService.execute(communeDraw.id)
    const result = await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    return { communeDraw, poolId, result }
  }

  it('refuses an update or a delete of the result, at the database', async () => {
    const { result } = await completed()

    await expect(
      prisma.drawResult.update({ where: { id: result.id }, data: { winnerCount: 99 } }),
    ).rejects.toThrow()
    await expect(prisma.drawResult.delete({ where: { id: result.id } })).rejects.toThrow()

    expect(await prisma.drawResult.count()).toBe(1)
  })

  it('refuses an update or a delete of a winner, an event and an archive row', async () => {
    await completed()
    const winner = await prisma.drawWinner.findFirstOrThrow()
    const event = await prisma.drawSelectionEvent.findFirstOrThrow()
    const archived = await prisma.winnerArchive.findFirstOrThrow()

    await expect(
      prisma.drawWinner.update({ where: { id: winner.id }, data: { selectionOrder: 9 } }),
    ).rejects.toThrow()
    await expect(prisma.drawWinner.delete({ where: { id: winner.id } })).rejects.toThrow()
    await expect(
      prisma.drawSelectionEvent.update({ where: { id: event.id }, data: { randomValue: 0 } }),
    ).rejects.toThrow()
    await expect(prisma.winnerArchive.delete({ where: { id: archived.id } })).rejects.toThrow()

    expect(await prisma.drawWinner.count()).toBe(2)
    expect(await prisma.winnerArchive.count()).toBe(2)
  })

  it('refuses a second result for the same commune draw', async () => {
    const { communeDraw, poolId } = await completed()

    await expect(
      prisma.drawResult.create({
        data: {
          communeDrawId: communeDraw.id,
          drawPoolId: poolId,
          winnerCount: 1,
          totalWeightAtDraw: 1,
          poolHash: 'b'.repeat(64),
          algorithmVersion: 'weighted-csprng-v1',
          startedAt: new Date(),
          completedAt: new Date(),
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses a stored event outside the range it was drawn from', async () => {
    const { result } = await completed()

    await expect(
      prisma.drawSelectionEvent.create({
        data: {
          drawResultId: result.id,
          selectionOrder: 99,
          activeTotalWeight: 4,
          randomValue: 4,
          selectedPoolEntryId: (await prisma.drawPoolEntry.findFirstOrThrow()).id,
        },
      }),
    ).rejects.toThrow()
  })

  it('cannot reopen, redraw or reallocate a completed commune draw', async () => {
    const { communeDraw } = await completed()

    for (const status of ['DRAFT', 'READY', 'LOCKED', 'CANCELLED'] as const) {
      await expect(
        drawConfigurationService.updateCommuneDraw(communeDraw.id, { status }),
      ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
    }

    await expect(
      drawConfigurationService.updateCommuneDraw(communeDraw.id, { allocatedSpots: 99 }),
    ).rejects.toMatchObject({ code: 'DRAW_CONFIGURATION_LOCKED' })

    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'COMPLETED',
    )
  })

  it('carries no personal information in a winner record', async () => {
    await completed()

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name IN ('draw_winners', 'draw_results', 'winner_archive', 'draw_selection_events')
    `
    const names = columns.map((column) => column.column_name)

    for (const leaked of ['full_name', 'national_id', 'dob', 'phone_number']) {
      expect(names).not.toContain(leaked)
    }
  })
})

describe('a commune draw cannot claim to be complete without a result', () => {
  it('is refused by the database, not only by the service', async () => {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 1,
    })
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'LOCKED' } })

    // The deferred constraint trigger fires at commit: no result, no completion.
    await expect(
      prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'COMPLETED' } }),
    ).rejects.toThrow()

    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
  })

  it('is refused by the service with a sentence', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)

    await expect(
      drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'COMPLETED' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
  })
})

describe('executing over HTTP', () => {
  it('lets a SUPER_ADMIN execute and read the result', async () => {
    const { communeDraw } = await lockedPool([{ paired: true }, {}, {}], 2)
    const { cookie } = await superAdmin()

    const executed = await executeVia(communeDraw.id, cookie)

    expect(executed.status).toBe(201)
    expect(executed.body).toMatchObject({
      winnerCount: 2,
      allocatedSpots: 2,
      entryCount: 3,
      algorithmVersion: 'weighted-csprng-v1',
      notSelectedCount: 1,
      historyRecordsCreated: 4,
    })
    expect(executed.body.winners).toHaveLength(2)
    expect(executed.body.events).toHaveLength(2)
    expect(executed.body.poolHash).toMatch(/^[0-9a-f]{64}$/)

    const read = await resultVia(communeDraw.id, cookie)
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({
      id: executed.body.id,
      winnerCount: 2,
      winningParticipantCount: executed.body.winningParticipantCount,
      poolHash: executed.body.poolHash,
    })
  })

  it('ignores anything a client tries to dictate about the draw', async () => {
    const { communeDraw } = await lockedPool(singles(6), 2)
    const { cookie } = await superAdmin()

    const executed = await executeVia(communeDraw.id, cookie).send({
      winnerCount: 6,
      randomSeed: 'abc',
      randomValues: [0, 1],
      algorithmVersion: 'mine',
      allocatedSpots: 6,
    })

    // Every term of the draw comes from the database. The body is not read.
    expect(executed.status).toBe(201)
    expect(executed.body.winnerCount).toBe(2)
    expect(executed.body.algorithmVersion).toBe('weighted-csprng-v1')
    expect(await prisma.drawWinner.count()).toBe(2)
  })

  it('refuses a WILAYA_ADMIN and a COMMUNE_ADMIN executing', async () => {
    const { communeDraw } = await lockedPool(singles(4), 2)
    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const { cookie } of [wilaya, commune]) {
      const response = await executeVia(communeDraw.id, cookie)
      expect(response.status).toBe(403)
      expect(response.body.code).toBe('FORBIDDEN_ROLE')
    }

    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
  })

  it('refuses an unauthenticated caller on both routes', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)

    for (const response of [
      await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/execute`),
      await request(app).get(`/api/admin/commune-draws/${communeDraw.id}/result`),
    ]) {
      expect(response.status).toBe(401)
    }

    expect(await prisma.drawResult.count()).toBe(0)
  })

  it('reports a repeated execution as already completed', async () => {
    const { communeDraw } = await lockedPool(singles(4), 2)
    const { cookie } = await superAdmin()

    expect((await executeVia(communeDraw.id, cookie)).status).toBe(201)
    const again = await executeVia(communeDraw.id, cookie)

    expect(again.status).toBe(409)
    expect(again.body.code).toBe('DRAW_ALREADY_COMPLETED')
    expect(await prisma.drawResult.count()).toBe(1)
  })

  it('reports insufficient entries without completing anything', async () => {
    const { communeDraw } = await lockedPool(singles(2), 100)
    const { cookie } = await superAdmin()

    const response = await executeVia(communeDraw.id, cookie)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('INSUFFICIENT_DRAW_ENTRIES')
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
  })

  it('produces exactly one result under concurrent requests', async () => {
    const { communeDraw } = await lockedPool(singles(7), 3)
    const { cookie } = await superAdmin()

    const responses = await Promise.all([
      executeVia(communeDraw.id, cookie),
      executeVia(communeDraw.id, cookie),
    ])
    const statuses = responses.map((response) => response.status).sort()

    expect(statuses).toEqual([201, 409])
    expect(await prisma.drawResult.count()).toBe(1)
    expect(await prisma.drawWinner.count()).toBe(3)
  })
})

describe('reading a result is scoped', () => {
  it('lets administrators of the territory read it', async () => {
    const { communeDraw } = await lockedPool(singles(4), 2)
    const { cookie: superCookie } = await superAdmin()
    await executeVia(communeDraw.id, superCookie)

    for (const { cookie } of [
      await wilayaAdmin(geo.wilayaA.id),
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
    ]) {
      const response = await resultVia(communeDraw.id, cookie)
      expect(response.status).toBe(200)
      expect(response.body.winners).toHaveLength(2)
    }
  })

  it('hides another territory’s result exactly as if it did not exist', async () => {
    const { communeDraw } = await lockedPool(singles(3), 1, {
      id: geo.communeB1.id,
      wilayaId: geo.wilayaB.id,
    })
    const { cookie: superCookie } = await superAdmin()
    await executeVia(communeDraw.id, superCookie)

    for (const { cookie } of [
      await wilayaAdmin(geo.wilayaA.id),
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
    ]) {
      const refused = await resultVia(communeDraw.id, cookie)
      const missing = await resultVia('no-such-commune-draw', cookie)

      expect(refused.status).toBe(404)
      expect(refused.body).toEqual(missing.body)
      // Nor may they execute it, and the role check must not disclose it either.
      expect((await executeVia(communeDraw.id, cookie)).status).toBe(403)
    }
  })

  it('reports a draw that has not been run as having no result', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)
    const { cookie } = await superAdmin()

    const response = await resultVia(communeDraw.id, cookie)

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('DRAW_RESULT_NOT_FOUND')
  })

  it('exposes no participant identity in a result', async () => {
    const { communeDraw } = await lockedPool([{ paired: true }, {}], 1)
    const { cookie } = await superAdmin()
    await executeVia(communeDraw.id, cookie)

    const body = JSON.stringify((await resultVia(communeDraw.id, cookie)).body)

    for (const forbidden of ['Winner Subject', 'Winner Partner', '1980-04-12', 'participantId']) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('publishes nothing', async () => {
    const { communeDraw } = await lockedPool(singles(2), 1)
    const { cookie } = await superAdmin()
    await executeVia(communeDraw.id, cookie)

    for (const path of [
      `/api/commune-draws/${communeDraw.id}/result`,
      `/api/winners`,
      `/api/draws/${communeDraw.id}/winners`,
    ]) {
      expect((await request(app).get(path)).status).toBe(404)
    }
  })
})

describe('integrity properties hold in the database', () => {
  it('holds every invariant a completed draw is supposed to have', async () => {
    const { communeDraw, poolId } = await lockedPool([{ paired: true }, {}, {}, { streakYears: 3 }], 3)

    await drawExecutionService.execute(communeDraw.id)

    const result = await prisma.drawResult.findUniqueOrThrow({
      where: { communeDrawId: communeDraw.id },
      include: { winners: true, events: true, archivedWinners: true },
    })
    const poolEntries = await prisma.drawPoolEntry.findMany({ where: { drawPoolId: poolId } })
    const poolEntryIds = new Set(poolEntries.map((entry) => entry.id))

    // At most one result per commune draw, and it belongs to that pool.
    expect(await prisma.drawResult.count({ where: { communeDrawId: communeDraw.id } })).toBe(1)
    expect(result.drawPoolId).toBe(poolId)

    // Winner count equals the selected count equals the allocation.
    expect(result.winners).toHaveLength(result.winnerCount)
    expect(result.winnerCount).toBe(3)
    expect(await prisma.application.count({ where: { status: 'SELECTED' } })).toBe(3)

    // Selection order is unique and contiguous from 1.
    const orders = result.winners.map((winner) => winner.selectionOrder).sort((a, b) => a - b)
    expect(orders).toEqual([1, 2, 3])

    // Every winner and every event references an entry of this pool.
    for (const winner of result.winners) expect(poolEntryIds.has(winner.drawPoolEntryId)).toBe(true)
    for (const event of result.events) expect(poolEntryIds.has(event.selectedPoolEntryId)).toBe(true)

    // Every winning individual is archived, and archived exactly once — a paired
    // winner contributing one entry and two people.
    const expectedIndividuals = result.winners.reduce(
      (total, winner) => total + (winner.secondaryParticipantId ? 2 : 1),
      0,
    )
    expect(result.archivedWinners).toHaveLength(expectedIndividuals)
    expect(new Set(result.archivedWinners.map((row) => row.participantId)).size).toBe(expectedIndividuals)

    // Nobody selected is left unexcluded, and nobody unselected is excluded.
    const excluded = await prisma.participant.findMany({ where: { hasWonHajj: true }, select: { id: true } })
    expect(new Set(excluded.map((participant) => participant.id))).toEqual(
      new Set(result.archivedWinners.map((row) => row.participantId)),
    )

    // No archive row without its completed result, and no completed draw
    // without a pool.
    for (const row of result.archivedWinners) expect(row.drawResultId).toBe(result.id)
    expect(await prisma.drawPool.count({ where: { communeDrawId: communeDraw.id } })).toBe(1)

    // Every pooled person has exactly one historical record for the year.
    const pooledPeople = poolEntries.flatMap((entry) =>
      [entry.primaryParticipantId, entry.secondaryParticipantId].filter((id): id is string => id !== null),
    )
    const history = await prisma.participationHistory.findMany({ where: { drawYear: YEAR } })
    expect(history).toHaveLength(pooledPeople.length)
    expect(new Set(history.map((record) => record.participantId))).toEqual(new Set(pooledPeople))
  })
})
