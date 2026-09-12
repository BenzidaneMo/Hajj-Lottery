import { PrismaClient, type Application, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { drawExecutionService } from '../src/services/draw-execution.service.js'
import { drawPoolService } from '../src/services/draw-pool.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography

/** Well away from the calendar year and from other suites' fixed years. */
let nextYear = 2170

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `53000000000000${String(nextId).padStart(4, '0')}`
}

/**
 * A fresh open year. At most one `REGISTRATION_OPEN` year may exist at a
 * time (a partial unique index), so a caller opening a second year must
 * close whichever one is open first — `closeRegistration` below.
 */
async function openYear(): Promise<DrawYear> {
  nextYear += 1
  return prisma.drawYear.create({ data: { year: nextYear, status: 'REGISTRATION_OPEN' } })
}

/** Idempotent: a year already closed is left alone. */
async function closeRegistration(drawYear: DrawYear): Promise<void> {
  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
}

async function registerOne(communeId: string, wilayaId: string): Promise<Application> {
  const response = await request(app)
    .post('/api/applications')
    .send({
      entryType: 'SINGLE',
      wilayaId,
      communeId,
      primary: {
        nationalId: nationalId(),
        fullName: 'Batch Test Subject',
        dob: '1980-04-12',
        gender: 'MALE',
      },
    })
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })
  await weightService.freezeApplicationWeight(application.id)
  return application
}

/**
 * A commune draw with `2 * allocatedSpots` registered applicants, moved to
 * READY — everything a pool freeze needs except the year being closed,
 * which is a per-year, not per-commune, precondition. Call this for every
 * commune that needs a pool *before* closing that year's registration, then
 * `freezePool` each one afterwards.
 */
async function registerReady(
  drawYear: DrawYear,
  commune: { id: string; wilayaId: string },
  allocatedSpots: number,
): Promise<CommuneDraw> {
  const communeDraw = await drawConfigurationService.createCommuneDraw({
    drawYearId: drawYear.id,
    communeId: commune.id,
    allocatedSpots,
  })
  for (let i = 0; i < allocatedSpots * 2; i += 1) {
    await registerOne(commune.id, commune.wilayaId)
  }
  await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
  return communeDraw
}

async function freezePool(communeDraw: CommuneDraw): Promise<CommuneDraw> {
  await drawPoolService.freeze(communeDraw.id)
  return prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })
}

/** The common case: one commune, ready and frozen, in its own fresh year. */
async function readyCommune(
  drawYear: DrawYear,
  commune: { id: string; wilayaId: string },
  allocatedSpots: number,
): Promise<CommuneDraw> {
  const communeDraw = await registerReady(drawYear, commune, allocatedSpots)
  await closeRegistration(drawYear)
  return freezePool(communeDraw)
}

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })

const validateVia = (drawYearId: string, cookie: string) =>
  request(app).post('/api/admin/commune-draws/batch/validate').set('Cookie', cookie).send({ drawYearId })

const executeVia = (drawYearId: string, communeDrawIds: string[], cookie: string) =>
  request(app)
    .post('/api/admin/commune-draws/batch/execute')
    .set('Cookie', cookie)
    .send({ drawYearId, communeDrawIds })

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('batch draw execution — authorization', () => {
  it('refuses a non-SUPER_ADMIN on both routes', async () => {
    const drawYear = await openYear()
    const { cookie } = await wilayaAdmin(geo.wilayaA.id)

    const validation = await validateVia(drawYear.id, cookie)
    const execution = await executeVia(drawYear.id, [], cookie)

    expect(validation.status).toBe(403)
    expect(execution.status).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const drawYear = await openYear()

    const validation = await request(app)
      .post('/api/admin/commune-draws/batch/validate')
      .send({ drawYearId: drawYear.id })
    const execution = await request(app)
      .post('/api/admin/commune-draws/batch/execute')
      .send({ drawYearId: drawYear.id, communeDrawIds: [] })

    expect(validation.status).toBe(401)
    expect(execution.status).toBe(401)
  })
})

describe('batch draw execution — readiness', () => {
  it('buckets a ready, a not-yet-locked, and an already-completed commune', async () => {
    const drawYear = await openYear()

    // Both communes needing a pool register while the year is still open;
    // the year closes once, after both, then each pool freezes.
    const readyDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const completedDraw = await registerReady(drawYear, { id: geo.communeB1.id, wilayaId: geo.wilayaB.id }, 2)
    const draft = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA2.id,
      allocatedSpots: 5,
    })

    await closeRegistration(drawYear)
    const ready = await freezePool(readyDraw)
    const completedSeed = await freezePool(completedDraw)
    await drawExecutionService.execute(completedSeed.id)

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(3)
    expect(response.body.ready.map((row: { communeDrawId: string }) => row.communeDrawId)).toEqual([ready.id])
    expect(response.body.notReady).toEqual([
      expect.objectContaining({ communeDrawId: draft.id, reason: 'NOT_LOCKED' }),
    ])
    expect(response.body.alreadyCompleted.map((row: { communeDrawId: string }) => row.communeDrawId)).toEqual(
      [completedSeed.id],
    )
  })

  it('reports a locked commune with no frozen pool as not ready', async () => {
    const drawYear = await openYear()
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 5,
    })
    // Locked directly, bypassing the freeze-pool flow — a real, reachable
    // state since LOCKED is itself an administratively settable status.
    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'LOCKED' })

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.body.notReady).toEqual([
      expect.objectContaining({ communeDrawId: communeDraw.id, reason: 'NO_POOL' }),
    ])
  })

  it('reports a frozen but undersubscribed pool as not ready', async () => {
    const drawYear = await openYear()
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 4,
    })
    // One applicant for four places — fewer than the 2N a draw requires.
    // Freezing permits this deliberately; only execution refuses it.
    await registerOne(geo.communeA1.id, geo.wilayaA.id)
    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    await closeRegistration(drawYear)
    await drawPoolService.freeze(communeDraw.id)

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.body.notReady).toEqual([
      expect.objectContaining({ communeDrawId: communeDraw.id, reason: 'INSUFFICIENT_ENTRIES' }),
    ])
  })

  it('scopes a batch to exactly the requested draw year, no other', async () => {
    const drawYear = await openYear()
    await readyCommune(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)

    const otherYear = await openYear()
    await readyCommune(otherYear, { id: geo.communeA2.id, wilayaId: geo.wilayaA.id }, 2)

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.body.total).toBe(1)
  })
})

describe('batch draw execution — running it', () => {
  it('executes every ready commune independently and reports outcomes', async () => {
    const drawYear = await openYear()
    const firstDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const secondDraw = await registerReady(drawYear, { id: geo.communeA2.id, wilayaId: geo.wilayaA.id }, 3)
    await closeRegistration(drawYear)
    const first = await freezePool(firstDraw)
    const second = await freezePool(secondDraw)

    const { cookie } = await superAdmin()
    const validation = await validateVia(drawYear.id, cookie)
    const readyIds = validation.body.ready.map((row: { communeDrawId: string }) => row.communeDrawId)
    expect(readyIds.slice().sort()).toEqual([first.id, second.id].sort())

    const execution = await executeVia(drawYear.id, readyIds, cookie)

    expect(execution.status).toBe(200)
    expect(execution.body).toMatchObject({ targeted: 2, succeeded: 2, failed: 0 })
    expect(execution.body.outcomes.every((row: { status: string }) => row.status === 'completed')).toBe(true)

    expect(await prisma.drawResult.count({ where: { communeDrawId: { in: [first.id, second.id] } } })).toBe(2)

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'COMMUNE_DRAW_BATCH_EXECUTED', targetId: drawYear.id },
    })
    expect(auditRow.afterData).toBeNull()
    expect(auditRow.metadata).toMatchObject({
      targeted: 2,
      succeeded: 2,
      failed: 0,
      failedCommuneDrawIds: [],
    })
  })

  it('keeps a failing commune from affecting an unrelated one, and reports why', async () => {
    const drawYear = await openYear()
    const goodDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const alreadyRunDraw = await registerReady(
      drawYear,
      { id: geo.communeA2.id, wilayaId: geo.wilayaA.id },
      2,
    )
    await closeRegistration(drawYear)
    const good = await freezePool(goodDraw)
    const alreadyRun = await freezePool(alreadyRunDraw)

    const { cookie } = await superAdmin()

    // Executed directly, out from under the batch — simulating "became
    // not-ready between validate and execute".
    await drawExecutionService.execute(alreadyRun.id)

    const execution = await executeVia(drawYear.id, [good.id, alreadyRun.id], cookie)

    expect(execution.status).toBe(200)
    expect(execution.body.succeeded).toBe(1)
    // Already completed reads as skipped, not failed — nothing went wrong,
    // the work was simply already done by the time the batch reached it.
    expect(execution.body.failed).toBe(0)
    expect(execution.body.skipped).toBe(1)

    const goodOutcome = execution.body.outcomes.find(
      (row: { communeDrawId: string }) => row.communeDrawId === good.id,
    )
    const skippedOutcome = execution.body.outcomes.find(
      (row: { communeDrawId: string }) => row.communeDrawId === alreadyRun.id,
    )
    expect(goodOutcome.status).toBe('completed')
    expect(skippedOutcome).toMatchObject({ status: 'skipped', code: 'DRAW_ALREADY_COMPLETED' })

    // The commune that was skipped here had in fact already completed
    // successfully moments earlier — its own result is untouched, not rolled back.
    expect(await prisma.drawResult.count({ where: { communeDrawId: alreadyRun.id } })).toBe(1)
    expect(await prisma.drawResult.count({ where: { communeDrawId: good.id } })).toBe(1)
  })

  it('lets only one of two concurrent requests for the same commune win', async () => {
    const drawYear = await openYear()
    const communeDraw = await readyCommune(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const { cookie } = await superAdmin()

    const [first, second] = await Promise.all([
      executeVia(drawYear.id, [communeDraw.id], cookie),
      executeVia(drawYear.id, [communeDraw.id], cookie),
    ])

    // The loser is skipped, not failed — its own attempt found the commune
    // already completed, whether by the in-process guard or the database's
    // own LOCKED -> COMPLETED claim, neither of which is an error.
    const statuses = [first.body.outcomes[0].status, second.body.outcomes[0].status].sort()
    expect(statuses).toEqual(['completed', 'skipped'])
    expect(await prisma.drawResult.count({ where: { communeDrawId: communeDraw.id } })).toBe(1)
  })

  it('rejects an id outside the requested draw year rather than reaching across it', async () => {
    const otherYear = await openYear()
    const elsewhere = await readyCommune(otherYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)

    const drawYear = await openYear()

    const { cookie } = await superAdmin()
    const execution = await executeVia(drawYear.id, [elsewhere.id], cookie)

    expect(execution.body).toMatchObject({ targeted: 1, succeeded: 0, failed: 1 })
    expect(execution.body.outcomes[0]).toMatchObject({ status: 'failed', code: 'COMMUNE_DRAW_NOT_FOUND' })
    expect(await prisma.drawResult.count({ where: { communeDrawId: elsewhere.id } })).toBe(0)
  })
})
