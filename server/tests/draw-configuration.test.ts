import { PrismaClient, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import {
  canTransitionCommuneDraw,
  canTransitionDrawYear,
  isAdministrativelySettable,
} from '../src/lib/draw-lifecycle.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography

/**
 * Years chosen well away from the calendar year so nothing here collides with
 * the fixture year other suites open for registration.
 */
const YEAR = 2150
const OTHER_YEAR = 2151

const NATIONAL_ID = '611111111111111111'

function applicant(overrides: Record<string, unknown> = {}) {
  return { nationalId: NATIONAL_ID, fullName: 'Draw Subject', dob: '1980-04-12', ...overrides }
}

const submit = (body: Record<string, unknown>) => request(app).post('/api/applications').send(body)

function singleBody(overrides: Record<string, unknown> = {}) {
  return {
    entryType: 'SINGLE',
    wilayaId: geo.wilayaA.id,
    communeId: geo.communeA1.id,
    primary: applicant(),
    ...overrides,
  }
}

/** A draft year, created through the service the API uses. */
async function draftYear(year = YEAR): Promise<DrawYear> {
  return drawConfigurationService.createDrawYear(year)
}

async function openYear(year = YEAR): Promise<DrawYear> {
  const created = await draftYear(year)
  return drawConfigurationService.updateDrawYearStatus(created.id, 'REGISTRATION_OPEN')
}

async function configureCommune(drawYearId: string, communeId: string, allocatedSpots = 12) {
  return drawConfigurationService.createCommuneDraw({ drawYearId, communeId, allocatedSpots })
}

const asAdmin = (cookie: string) => ({ cookie })

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

describe('the lifecycle rules, in isolation', () => {
  it('walks a draw year forward and never back', () => {
    expect(canTransitionDrawYear('DRAFT', 'REGISTRATION_OPEN')).toBe(true)
    expect(canTransitionDrawYear('REGISTRATION_OPEN', 'REGISTRATION_CLOSED')).toBe(true)
    expect(canTransitionDrawYear('REGISTRATION_CLOSED', 'ARCHIVED')).toBe(true)

    // Reopening intake after telling everyone the year is settled is a policy
    // decision nobody has made, so the system cannot do it.
    expect(canTransitionDrawYear('REGISTRATION_CLOSED', 'REGISTRATION_OPEN')).toBe(false)
    expect(canTransitionDrawYear('ARCHIVED', 'DRAFT')).toBe(false)
    expect(canTransitionDrawYear('DRAFT', 'REGISTRATION_CLOSED')).toBe(false)
  })

  it('lets a commune draw be reconsidered before it locks, never after', () => {
    expect(canTransitionCommuneDraw('DRAFT', 'READY')).toBe(true)
    expect(canTransitionCommuneDraw('READY', 'DRAFT')).toBe(true)
    expect(canTransitionCommuneDraw('READY', 'LOCKED')).toBe(true)

    expect(canTransitionCommuneDraw('LOCKED', 'READY')).toBe(false)
    expect(canTransitionCommuneDraw('LOCKED', 'DRAFT')).toBe(false)
    expect(canTransitionCommuneDraw('CANCELLED', 'DRAFT')).toBe(false)

    // Executing the draw is the one way out of LOCKED, and there is no way out
    // of COMPLETED at all: a concluded lottery has told people they won.
    expect(canTransitionCommuneDraw('LOCKED', 'COMPLETED')).toBe(true)
    expect(canTransitionCommuneDraw('COMPLETED', 'LOCKED')).toBe(false)
    expect(canTransitionCommuneDraw('COMPLETED', 'CANCELLED')).toBe(false)
  })

  it('keeps COMPLETED out of an administrator’s hands', () => {
    for (const status of ['DRAFT', 'READY', 'LOCKED', 'CANCELLED'] as const) {
      expect(isAdministrativelySettable(status)).toBe(true)
    }

    // Legal as a transition, but only winner processing may perform it — a
    // commune draw marked complete by hand would claim a lottery that never ran.
    expect(isAdministrativelySettable('COMPLETED')).toBe(false)
  })
})

describe('draw years', () => {
  it('creates a year as a draft', async () => {
    const created = await draftYear()

    expect(created).toMatchObject({ year: YEAR, status: 'DRAFT' })
  })

  it('refuses a second cycle for the same year', async () => {
    await draftYear()

    await expect(draftYear()).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_DRAW_YEAR' })
    expect(await prisma.drawYear.count({ where: { year: YEAR } })).toBe(1)
  })

  it('lets exactly one of several concurrent creations win', async () => {
    const attempts = [draftYear(), draftYear(), draftYear()].map((p) =>
      p.then(() => 'created' as const).catch(() => 'refused' as const),
    )

    const results = await Promise.all(attempts)

    expect(results.filter((r) => r === 'created')).toHaveLength(1)
    expect(await prisma.drawYear.count({ where: { year: YEAR } })).toBe(1)
  })

  it('refuses a year outside the calendar range the database allows', async () => {
    await expect(draftYear(1999)).rejects.toThrow()
    await expect(draftYear(2201)).rejects.toThrow()
  })

  it('opens registration, then closes it, and refuses to reopen', async () => {
    const year = await draftYear()

    const opened = await drawConfigurationService.updateDrawYearStatus(year.id, 'REGISTRATION_OPEN')
    expect(opened.status).toBe('REGISTRATION_OPEN')

    const closed = await drawConfigurationService.updateDrawYearStatus(year.id, 'REGISTRATION_CLOSED')
    expect(closed.status).toBe('REGISTRATION_CLOSED')

    await expect(
      drawConfigurationService.updateDrawYearStatus(year.id, 'REGISTRATION_OPEN'),
    ).rejects.toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' })
  })

  it('permits only one year open for registration at a time', async () => {
    await openYear(YEAR)
    const second = await draftYear(OTHER_YEAR)

    // The partial unique index decides, so this holds under concurrency too.
    await expect(
      drawConfigurationService.updateDrawYearStatus(second.id, 'REGISTRATION_OPEN'),
    ).rejects.toMatchObject({ status: 409, code: 'REGISTRATION_ALREADY_OPEN' })
  })

  it('reports the open year as the active one, and nothing when none is', async () => {
    expect(await drawConfigurationService.activeDrawYear()).toBeNull()

    const opened = await openYear()
    expect((await drawConfigurationService.activeDrawYear())?.id).toBe(opened.id)

    await drawConfigurationService.updateDrawYearStatus(opened.id, 'REGISTRATION_CLOSED')
    expect(await drawConfigurationService.activeDrawYear()).toBeNull()
  })

  it('archives rather than deleting', async () => {
    const year = await openYear()
    await drawConfigurationService.updateDrawYearStatus(year.id, 'REGISTRATION_CLOSED')

    const archived = await drawConfigurationService.updateDrawYearStatus(year.id, 'ARCHIVED')

    expect(archived.status).toBe('ARCHIVED')
    // Still on record: a draw year is the history of who ran which lottery.
    expect(await prisma.drawYear.count({ where: { id: year.id } })).toBe(1)
  })
})

describe('commune draws', () => {
  it('configures a commune with an explicit allocation', async () => {
    const year = await draftYear()

    const draw = await configureCommune(year.id, geo.communeA1.id, 12)

    expect(draw).toMatchObject({ allocatedSpots: 12, status: 'DRAFT' })
    expect(draw.commune.id).toBe(geo.communeA1.id)
    expect(draw.drawYear.year).toBe(YEAR)
  })

  it('refuses a second configuration for the same commune and year', async () => {
    const year = await draftYear()
    await configureCommune(year.id, geo.communeA1.id)

    await expect(configureCommune(year.id, geo.communeA1.id, 20)).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_COMMUNE_DRAW',
    })
    expect(await prisma.communeDraw.count()).toBe(1)
  })

  it('lets exactly one of several concurrent configurations win', async () => {
    const year = await draftYear()

    const attempts = [
      configureCommune(year.id, geo.communeA1.id, 5),
      configureCommune(year.id, geo.communeA1.id, 10),
      configureCommune(year.id, geo.communeA1.id, 15),
    ].map((p) => p.then(() => 'created' as const).catch(() => 'refused' as const))

    const results = await Promise.all(attempts)

    expect(results.filter((r) => r === 'created')).toHaveLength(1)
    expect(await prisma.communeDraw.count()).toBe(1)
  })

  it('lets one commune have draws in different years', async () => {
    const first = await draftYear(YEAR)
    const second = await draftYear(OTHER_YEAR)

    await configureCommune(first.id, geo.communeA1.id, 12)
    await configureCommune(second.id, geo.communeA1.id, 18)

    expect(await prisma.communeDraw.count({ where: { communeId: geo.communeA1.id } })).toBe(2)
  })

  it('lets different communes have different allocations in one year', async () => {
    const year = await draftYear()

    await configureCommune(year.id, geo.communeA1.id, 12)
    await configureCommune(year.id, geo.communeA2.id, 18)
    await configureCommune(year.id, geo.communeB1.id, 7)

    const draws = await prisma.communeDraw.findMany({ orderBy: { allocatedSpots: 'asc' } })
    // Allocations are configured per commune, never levelled or rebalanced.
    expect(draws.map((d) => d.allocatedSpots)).toEqual([7, 12, 18])
  })

  it('refuses an allocation of zero or fewer', async () => {
    const year = await draftYear()

    await expect(configureCommune(year.id, geo.communeA1.id, 0)).rejects.toThrow()
    await expect(configureCommune(year.id, geo.communeA1.id, -5)).rejects.toThrow()
    expect(await prisma.communeDraw.count()).toBe(0)
  })

  it('refuses an unknown commune or an unknown year', async () => {
    const year = await draftYear()

    await expect(configureCommune(year.id, 'no-such-commune')).rejects.toMatchObject({
      status: 404,
      code: 'COMMUNE_NOT_FOUND',
    })
    await expect(configureCommune('no-such-year', geo.communeA1.id)).rejects.toMatchObject({
      status: 404,
      code: 'DRAW_YEAR_NOT_FOUND',
    })
  })

  it('stores no wilaya of its own', async () => {
    const year = await draftYear()
    await configureCommune(year.id, geo.communeA1.id)

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'commune_draws'
    `

    // The commune already determines the wilaya; a second copy could disagree.
    expect(columns.map((c) => c.column_name)).not.toContain('wilaya_id')
  })

  it('changes an allocation while the draw is still configurable', async () => {
    const year = await draftYear()
    const draw = await configureCommune(year.id, geo.communeA1.id, 12)

    const updated = await drawConfigurationService.updateCommuneDraw(draw.id, { allocatedSpots: 20 })
    expect(updated.allocatedSpots).toBe(20)

    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'READY' })
    const stillEditable = await drawConfigurationService.updateCommuneDraw(draw.id, {
      allocatedSpots: 25,
    })
    expect(stillEditable.allocatedSpots).toBe(25)
  })

  it('refuses to change an allocation once locked', async () => {
    const year = await draftYear()
    const draw = await configureCommune(year.id, geo.communeA1.id, 12)
    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'READY' })
    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'LOCKED' })

    await expect(
      drawConfigurationService.updateCommuneDraw(draw.id, { allocatedSpots: 99 }),
    ).rejects.toMatchObject({ status: 409, code: 'DRAW_CONFIGURATION_LOCKED' })

    const stored = await prisma.communeDraw.findUniqueOrThrow({ where: { id: draw.id } })
    expect(stored.allocatedSpots).toBe(12)
  })

  it('refuses to unlock a locked draw', async () => {
    const year = await draftYear()
    const draw = await configureCommune(year.id, geo.communeA1.id)
    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'READY' })
    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'LOCKED' })

    await expect(
      drawConfigurationService.updateCommuneDraw(draw.id, { status: 'READY' }),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
  })
})

describe('registration depends on the configuration', () => {
  it('refuses an application when no draw year is open', async () => {
    await draftYear() // exists, but never opened

    const response = await submit(singleBody())

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('REGISTRATION_CLOSED')
    expect(await prisma.application.count()).toBe(0)
  })

  it('refuses an application once the year has closed', async () => {
    const year = await openYear()
    await configureCommune(year.id, geo.communeA1.id)
    await drawConfigurationService.updateDrawYearStatus(year.id, 'REGISTRATION_CLOSED')

    const response = await submit(singleBody())

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('REGISTRATION_CLOSED')
  })

  it('refuses a commune with no configured draw', async () => {
    const year = await openYear()
    // Only the neighbouring commune is running a draw this year.
    await configureCommune(year.id, geo.communeA2.id)

    const response = await submit(singleBody())

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('COMMUNE_DRAW_NOT_CONFIGURED')
    expect(await prisma.application.count()).toBe(0)
  })

  it('refuses a commune whose draw has locked', async () => {
    const year = await openYear()
    const draw = await configureCommune(year.id, geo.communeA1.id)
    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'READY' })
    await drawConfigurationService.updateCommuneDraw(draw.id, { status: 'LOCKED' })

    const response = await submit(singleBody())

    expect(response.status).toBe(503)
    expect(response.body.code).toBe('COMMUNE_DRAW_NOT_CONFIGURED')
  })

  it('accepts an application into a configured, open commune draw', async () => {
    const year = await openYear()
    await configureCommune(year.id, geo.communeA1.id)

    const response = await submit(singleBody())

    expect(response.status).toBe(201)
    // The year comes from the configuration, not from the browser.
    expect(response.body.drawYear).toBe(YEAR)
  })

  it('does not let the client choose the year', async () => {
    const year = await openYear()
    await configureCommune(year.id, geo.communeA1.id)

    const rejected = await submit({ ...singleBody(), drawYear: OTHER_YEAR })
    expect(rejected.status).toBe(400)

    const accepted = await submit(singleBody())
    expect(accepted.body.drawYear).toBe(YEAR)
  })

  it('does not let the client smuggle in an allocation or a draw state', async () => {
    const year = await openYear()
    const draw = await configureCommune(year.id, geo.communeA1.id, 12)

    const response = await submit({ ...singleBody(), allocatedSpots: 9999, communeDrawStatus: 'LOCKED' })

    expect(response.status).toBe(400)
    const stored = await prisma.communeDraw.findUniqueOrThrow({ where: { id: draw.id } })
    expect(stored).toMatchObject({ allocatedSpots: 12, status: 'DRAFT' })
  })

  it('does not refuse an application merely because the commune is oversubscribed', async () => {
    const year = await openYear()
    await configureCommune(year.id, geo.communeA1.id, 1)

    // One place, two applicants. Both applications stand; the draw will later
    // choose between them.
    const first = await submit(singleBody())
    const second = await submit(singleBody({ primary: applicant({ nationalId: '622222222222222222' }) }))

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await prisma.application.count()).toBe(2)
  })

  it('reports the open window to the form, and its absence', async () => {
    const closed = await request(app).get('/api/applications/registration-window')
    expect(closed.body).toEqual({ drawYear: null, isOpen: false })

    await openYear()
    const open = await request(app).get('/api/applications/registration-window')
    expect(open.body).toEqual({ drawYear: YEAR, isOpen: true })
  })
})

describe('administrative access', () => {
  const drawYears = (cookie: string) => request(app).get('/api/admin/draw-years').set('Cookie', cookie)
  const communeDraws = (cookie: string) => request(app).get('/api/admin/commune-draws').set('Cookie', cookie)
  const communeDraw = (id: string, cookie: string) =>
    request(app).get(`/api/admin/commune-draws/${id}`).set('Cookie', cookie)

  async function superAdmin() {
    return asAdmin((await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })).cookie)
  }

  async function wilayaAdmin(wilayaId: string) {
    return asAdmin(
      (await createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })).cookie,
    )
  }

  async function communeAdmin(wilayaId: string, communeId: string) {
    return asAdmin(
      (await createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId }))
        .cookie,
    )
  }

  it('lets a SUPER_ADMIN create a draw year', async () => {
    const { cookie } = await superAdmin()

    const response = await request(app)
      .post('/api/admin/draw-years')
      .set('Cookie', cookie)
      .send({ year: YEAR })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ year: YEAR, status: 'DRAFT', communeDrawCount: 0 })
  })

  it('refuses a WILAYA_ADMIN and a COMMUNE_ADMIN creating a draw year', async () => {
    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const { cookie } of [wilaya, commune]) {
      const response = await request(app)
        .post('/api/admin/draw-years')
        .set('Cookie', cookie)
        .send({ year: YEAR })

      // 403, not 404: they are authenticated and the route is no secret —
      // they simply may not do this.
      expect(response.status).toBe(403)
      expect(response.body.code).toBe('FORBIDDEN_ROLE')
    }

    expect(await prisma.drawYear.count()).toBe(0)
  })

  it('lets a SUPER_ADMIN configure and re-allocate a commune draw', async () => {
    const { cookie } = await superAdmin()
    const year = await draftYear()

    const created = await request(app)
      .post('/api/admin/commune-draws')
      .set('Cookie', cookie)
      .send({ drawYearId: year.id, communeId: geo.communeA1.id, allocatedSpots: 12 })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ allocatedSpots: 12, status: 'DRAFT', drawYear: YEAR })

    const updated = await request(app)
      .patch(`/api/admin/commune-draws/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ allocatedSpots: 20 })

    expect(updated.body.allocatedSpots).toBe(20)
  })

  it('refuses a scoped administrator changing an allocation', async () => {
    const year = await draftYear()
    const draw = await configureCommune(year.id, geo.communeA1.id, 12)

    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const { cookie } of [wilaya, commune]) {
      const response = await request(app)
        .patch(`/api/admin/commune-draws/${draw.id}`)
        .set('Cookie', cookie)
        .send({ allocatedSpots: 99 })

      expect(response.status).toBe(403)
    }

    const stored = await prisma.communeDraw.findUniqueOrThrow({ where: { id: draw.id } })
    expect(stored.allocatedSpots).toBe(12)
  })

  it('refuses a scoped administrator creating a commune draw in their own territory', async () => {
    const year = await draftYear()
    const { cookie } = await wilayaAdmin(geo.wilayaA.id)

    const response = await request(app)
      .post('/api/admin/commune-draws')
      .set('Cookie', cookie)
      .send({ drawYearId: year.id, communeId: geo.communeA1.id, allocatedSpots: 12 })

    // Allocation is national work even inside one's own wilaya.
    expect(response.status).toBe(403)
    expect(await prisma.communeDraw.count()).toBe(0)
  })

  it('shows a WILAYA_ADMIN only their own wilaya’s commune draws', async () => {
    const year = await draftYear()
    await configureCommune(year.id, geo.communeA1.id)
    await configureCommune(year.id, geo.communeB1.id)

    const { cookie } = await wilayaAdmin(geo.wilayaA.id)
    const response = await communeDraws(cookie)

    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0].commune.id).toBe(geo.communeA1.id)
    expect(JSON.stringify(response.body)).not.toContain(geo.communeB1.code)
  })

  it('shows a COMMUNE_ADMIN only their own commune draw', async () => {
    const year = await draftYear()
    const own = await configureCommune(year.id, geo.communeA1.id)
    await configureCommune(year.id, geo.communeA2.id)

    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)
    const response = await communeDraws(cookie)

    expect(response.body).toHaveLength(1)
    expect(response.body[0].id).toBe(own.id)
  })

  it('hides another territory’s commune draw exactly as if it did not exist', async () => {
    const year = await draftYear()
    const elsewhere = await configureCommune(year.id, geo.communeB1.id)

    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const { cookie } of [wilaya, commune]) {
      const refused = await communeDraw(elsewhere.id, cookie)
      const missing = await communeDraw('no-such-commune-draw', cookie)

      expect(refused.status).toBe(404)
      expect(refused.body).toEqual(missing.body)
    }
  })

  it('cannot be widened by a query parameter', async () => {
    const year = await draftYear()
    await configureCommune(year.id, geo.communeB1.id)

    const { cookie } = await wilayaAdmin(geo.wilayaA.id)
    const response = await request(app)
      .get('/api/admin/commune-draws')
      .query({ communeId: geo.communeB1.id })
      .set('Cookie', cookie)

    // A requested filter intersects the ceiling; it can only ever narrow.
    expect(response.body).toEqual([])
  })

  it('lets any administrator read the national cycle', async () => {
    await draftYear()
    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const response = await drawYears(cookie)

    // A draw year is national and names no territory, so there is nothing here
    // to scope.
    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
  })

  it('refuses an unauthenticated caller everywhere', async () => {
    const year = await draftYear()
    const draw = await configureCommune(year.id, geo.communeA1.id)

    for (const response of [
      await request(app).get('/api/admin/draw-years'),
      await request(app).get('/api/admin/commune-draws'),
      await request(app).get(`/api/admin/commune-draws/${draw.id}`),
      await request(app).post('/api/admin/draw-years').send({ year: OTHER_YEAR }),
    ]) {
      expect(response.status).toBe(401)
    }
  })

  it('rejects an unknown field rather than ignoring it', async () => {
    const { cookie } = await superAdmin()

    const response = await request(app)
      .post('/api/admin/draw-years')
      .set('Cookie', cookie)
      .send({ year: YEAR, status: 'REGISTRATION_OPEN' })

    // A new cycle is always a draft; opening it is a separate, deliberate act.
    expect(response.status).toBe(400)
    expect(await prisma.drawYear.count()).toBe(0)
  })

  it('counts the communes configured within a year', async () => {
    const year = await draftYear()
    await configureCommune(year.id, geo.communeA1.id)
    await configureCommune(year.id, geo.communeA2.id)

    const { cookie } = await superAdmin()
    const response = await request(app).get(`/api/admin/draw-years/${YEAR}`).set('Cookie', cookie)

    expect(response.body).toMatchObject({ year: YEAR, communeDrawCount: 2 })
  })
})
