import { PrismaClient, type Application, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { drawPoolService } from '../src/services/draw-pool.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'
import { buildApplicant } from './helpers/participants.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography

/** Well away from the calendar year and from other suites' fixed years. */
let nextYear = 2180

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `54000000000000${String(nextId).padStart(4, '0')}`
}

async function openYear(): Promise<DrawYear> {
  nextYear += 1
  return prisma.drawYear.create({ data: { year: nextYear, status: 'REGISTRATION_OPEN' } })
}

async function closeRegistration(drawYear: DrawYear): Promise<void> {
  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
}

async function registerOne(
  communeId: string,
  wilayaId: string,
  { freezeWeight = true }: { freezeWeight?: boolean } = {},
): Promise<Application> {
  const response = await request(app)
    .post('/api/applications')
    .send({
      entryType: 'SINGLE',
      wilayaId,
      communeId,
      primary: buildApplicant(nationalId(), { dob: '1980-04-12', gender: 'MALE' }),
    })
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })
  if (freezeWeight) await weightService.freezeApplicationWeight(application.id)
  return application
}

/**
 * A commune draw with `2 * allocatedSpots` registered, weighted applicants,
 * moved to READY — everything a freeze needs except the year being closed,
 * which is a per-year precondition. Call this for every commune that needs a
 * pool *before* closing that year's registration.
 */
async function registerReady(
  drawYear: DrawYear,
  commune: { id: string; wilayaId: string },
  allocatedSpots: number,
  options: { freezeWeight?: boolean } = {},
): Promise<CommuneDraw> {
  const communeDraw = await drawConfigurationService.createCommuneDraw({
    drawYearId: drawYear.id,
    communeId: commune.id,
    allocatedSpots,
  })
  for (let i = 0; i < allocatedSpots * 2; i += 1) {
    await registerOne(commune.id, commune.wilayaId, options)
  }
  await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
  return communeDraw
}

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })

const validateVia = (drawYearId: string, cookie: string) =>
  request(app)
    .post('/api/admin/commune-draws/batch/freeze/validate')
    .set('Cookie', cookie)
    .send({ drawYearId })

const freezeVia = (drawYearId: string, communeDrawIds: string[], cookie: string) =>
  request(app)
    .post('/api/admin/commune-draws/batch/freeze/execute')
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

describe('batch pool freeze — authorization', () => {
  it('refuses a non-SUPER_ADMIN on both routes', async () => {
    const drawYear = await openYear()
    const { cookie } = await wilayaAdmin(geo.wilayaA.id)

    const validation = await validateVia(drawYear.id, cookie)
    const freezing = await freezeVia(drawYear.id, [], cookie)

    expect(validation.status).toBe(403)
    expect(freezing.status).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const drawYear = await openYear()

    const validation = await request(app)
      .post('/api/admin/commune-draws/batch/freeze/validate')
      .send({ drawYearId: drawYear.id })
    const freezing = await request(app)
      .post('/api/admin/commune-draws/batch/freeze/execute')
      .send({ drawYearId: drawYear.id, communeDrawIds: [] })

    expect(validation.status).toBe(401)
    expect(freezing.status).toBe(401)
  })
})

describe('batch pool freeze — readiness', () => {
  it('buckets a ready, a blocked, and an already-frozen commune', async () => {
    const drawYear = await openYear()

    const readyDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const frozenDraw = await registerReady(drawYear, { id: geo.communeB1.id, wilayaId: geo.wilayaB.id }, 2)
    // Configured but nobody applied — READY, no candidates: NO_ELIGIBLE_APPLICATIONS.
    const empty = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA2.id,
      allocatedSpots: 5,
    })
    await drawConfigurationService.updateCommuneDraw(empty.id, { status: 'READY' })

    await closeRegistration(drawYear)
    await drawPoolService.freeze(frozenDraw.id)

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(3)
    expect(response.body.ready.map((row: { communeDrawId: string }) => row.communeDrawId)).toEqual([
      readyDraw.id,
    ])
    expect(response.body.notReady).toEqual([
      expect.objectContaining({ communeDrawId: empty.id, blockers: ['NO_ELIGIBLE_APPLICATIONS'] }),
    ])
    expect(response.body.alreadyFrozen.map((row: { communeDrawId: string }) => row.communeDrawId)).toEqual([
      frozenDraw.id,
    ])
  })

  it('reports a commune blocked only by a missing weight as ready — freeze() resolves it itself', async () => {
    const drawYear = await openYear()
    const communeDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2, {
      freezeWeight: false,
    })
    await closeRegistration(drawYear)

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.body.ready.map((row: { communeDrawId: string }) => row.communeDrawId)).toEqual([
      communeDraw.id,
    ])
    expect(response.body.notReady).toEqual([])
  })

  it('reports registration still being open as a real blocker, not silently ready', async () => {
    const drawYear = await openYear()
    const communeDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    // Registration deliberately left open — freezing must wait for intake to end.

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.body.notReady).toEqual([
      expect.objectContaining({ communeDrawId: communeDraw.id, blockers: ['REGISTRATION_STILL_OPEN'] }),
    ])
  })

  it('scopes a batch to exactly the requested draw year, no other', async () => {
    const drawYear = await openYear()
    await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    await closeRegistration(drawYear)

    const otherYear = await openYear()
    await registerReady(otherYear, { id: geo.communeA2.id, wilayaId: geo.wilayaA.id }, 2)
    await closeRegistration(otherYear)

    const { cookie } = await superAdmin()
    const response = await validateVia(drawYear.id, cookie)

    expect(response.body.total).toBe(1)
  })
})

describe('batch pool freeze — freezing it', () => {
  it('freezes every ready commune independently and reports outcomes', async () => {
    const drawYear = await openYear()
    const first = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const second = await registerReady(drawYear, { id: geo.communeA2.id, wilayaId: geo.wilayaA.id }, 3)
    await closeRegistration(drawYear)

    const { cookie } = await superAdmin()
    const validation = await validateVia(drawYear.id, cookie)
    const readyIds = validation.body.ready.map((row: { communeDrawId: string }) => row.communeDrawId)
    expect(readyIds.slice().sort()).toEqual([first.id, second.id].sort())

    const freezing = await freezeVia(drawYear.id, readyIds, cookie)

    expect(freezing.status).toBe(200)
    expect(freezing.body).toMatchObject({ targeted: 2, succeeded: 2, failed: 0 })
    expect(freezing.body.outcomes.every((row: { status: string }) => row.status === 'completed')).toBe(true)

    expect(await prisma.drawPool.count({ where: { communeDrawId: { in: [first.id, second.id] } } })).toBe(2)

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'COMMUNE_DRAW_BATCH_POOL_FROZEN', targetId: drawYear.id },
    })
    expect(auditRow.metadata).toMatchObject({
      targeted: 2,
      succeeded: 2,
      failed: 0,
      failedCommuneDrawIds: [],
    })
  })

  it('freezes a commune whose only blocker was a missing weight', async () => {
    const drawYear = await openYear()
    const communeDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2, {
      freezeWeight: false,
    })
    await closeRegistration(drawYear)

    const { cookie } = await superAdmin()
    const freezing = await freezeVia(drawYear.id, [communeDraw.id], cookie)

    expect(freezing.body).toMatchObject({ targeted: 1, succeeded: 1, failed: 0 })
    expect(await prisma.drawPool.count({ where: { communeDrawId: communeDraw.id } })).toBe(1)
  })

  it('treats an already-frozen commune as skipped, not failed', async () => {
    const drawYear = await openYear()
    const good = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    const alreadyFrozenDraw = await registerReady(
      drawYear,
      { id: geo.communeA2.id, wilayaId: geo.wilayaA.id },
      2,
    )
    await closeRegistration(drawYear)

    // Frozen directly, out from under the batch — simulating "became
    // already-frozen between validate and freeze".
    await drawPoolService.freeze(alreadyFrozenDraw.id)

    const { cookie } = await superAdmin()
    const freezing = await freezeVia(drawYear.id, [good.id, alreadyFrozenDraw.id], cookie)

    expect(freezing.status).toBe(200)
    expect(freezing.body.succeeded).toBe(1)
    expect(freezing.body.failed).toBe(0)
    expect(freezing.body.skipped).toBe(1)

    const goodOutcome = freezing.body.outcomes.find(
      (row: { communeDrawId: string }) => row.communeDrawId === good.id,
    )
    const skippedOutcome = freezing.body.outcomes.find(
      (row: { communeDrawId: string }) => row.communeDrawId === alreadyFrozenDraw.id,
    )
    expect(goodOutcome.status).toBe('completed')
    expect(skippedOutcome).toMatchObject({ status: 'skipped', code: 'POOL_ALREADY_EXISTS' })
  })

  it('fails, rather than freezes, a commune still genuinely blocked', async () => {
    const drawYear = await openYear()
    const communeDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    // Registration left open on purpose — REGISTRATION_STILL_OPEN blocks.

    const { cookie } = await superAdmin()
    const freezing = await freezeVia(drawYear.id, [communeDraw.id], cookie)

    expect(freezing.body).toMatchObject({ targeted: 1, succeeded: 0, failed: 1 })
    expect(freezing.body.outcomes[0]).toMatchObject({ status: 'failed', code: 'POOL_NOT_READY' })
    expect(await prisma.drawPool.count({ where: { communeDrawId: communeDraw.id } })).toBe(0)
  })

  it('lets only one of two concurrent requests for the same commune create the pool', async () => {
    const drawYear = await openYear()
    const communeDraw = await registerReady(drawYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    await closeRegistration(drawYear)
    const { cookie } = await superAdmin()

    const [first, second] = await Promise.all([
      freezeVia(drawYear.id, [communeDraw.id], cookie),
      freezeVia(drawYear.id, [communeDraw.id], cookie),
    ])

    // Neither attempt is an error — the loser is told a pool already exists,
    // which is true, rather than being handed a failure.
    const statuses = [first.body.outcomes[0].status, second.body.outcomes[0].status].sort()
    expect(statuses).toEqual(['completed', 'skipped'])
    expect(await prisma.drawPool.count({ where: { communeDrawId: communeDraw.id } })).toBe(1)
  })

  it('rejects an id outside the requested draw year rather than reaching across it', async () => {
    const otherYear = await openYear()
    const elsewhere = await registerReady(otherYear, { id: geo.communeA1.id, wilayaId: geo.wilayaA.id }, 2)
    await closeRegistration(otherYear)

    const drawYear = await openYear()

    const { cookie } = await superAdmin()
    const freezing = await freezeVia(drawYear.id, [elsewhere.id], cookie)

    expect(freezing.body).toMatchObject({ targeted: 1, succeeded: 0, failed: 1 })
    expect(freezing.body.outcomes[0]).toMatchObject({ status: 'failed', code: 'COMMUNE_DRAW_NOT_FOUND' })
    expect(await prisma.drawPool.count({ where: { communeDrawId: elsewhere.id } })).toBe(0)
  })
})
