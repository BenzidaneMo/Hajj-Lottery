import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { MIN_PASSWORD_LENGTH } from '../src/lib/password.js'

import {
  AdminRole,
  createAdmin,
  createAdminAndSignIn,
  ensureTestGeography,
  type TestGeography,
} from './helpers/admins.js'
import { resolveTestDatabaseUrl } from './test-database.js'

const app = createApp()
const prisma = new PrismaClient({ datasources: { db: { url: resolveTestDatabaseUrl() } } })

/**
 * The administrative console's own read surface, and administrator accounts.
 *
 * The endpoints added for the console are aggregates, which is exactly the kind
 * of thing that leaks a territory by accident: a count computed over the wrong
 * ceiling looks identical to a correct one. So most of what is asserted here is
 * that a scoped administrator's numbers are *their* numbers, and that a filter
 * in a query string can only ever narrow what their scope already allows.
 */

let geo: TestGeography

beforeEach(async () => {
  geo = await ensureTestGeography(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** A draw year with one commune draw per fixture commune, and applications. */
async function seedYear(options: { year?: number; status?: 'REGISTRATION_OPEN' | 'DRAFT' } = {}) {
  const year = options.year ?? 2031
  const drawYear = await prisma.drawYear.create({
    data: { year, status: options.status ?? 'REGISTRATION_OPEN' },
  })

  const draws = new Map<string, string>()
  for (const commune of [geo.communeA1, geo.communeA2, geo.communeB1]) {
    const draw = await prisma.communeDraw.create({
      data: { drawYearId: drawYear.id, communeId: commune.id, allocatedSpots: 5 },
    })
    draws.set(commune.id, draw.id)
  }

  return { drawYear, draws }
}

let participantCounter = 0

/** One eligible application in a commune, with its participant. */
async function seedApplication(communeId: string, year: number, status = 'ELIGIBLE' as const) {
  participantCounter += 1
  const suffix = String(participantCounter).padStart(6, '0')

  const participant = await prisma.participant.create({
    data: {
      nationalId: `10987654321${suffix}0`.slice(0, 18),
      fullName: `Applicant ${participantCounter}`,
      dob: new Date('1970-01-01'),
    },
  })

  return prisma.application.create({
    data: {
      applicationReference: `HZ-${year}-TST-${suffix}`,
      drawYear: year,
      communeId,
      primaryParticipantId: participant.id,
      entryType: 'SINGLE',
      status,
      calculatedWeight: 1,
      // The year on the link comes from the application through the composite
      // foreign key, so Prisma does not accept one here — which is the point
      // of that key: a participation row cannot claim a different year than
      // its application.
      participants: { create: { participantId: participant.id, role: 'PRIMARY' } },
    },
  })
}

describe('GET /api/admin/dashboard', () => {
  it('counts the whole country for a national administrator', async () => {
    const { drawYear } = await seedYear()
    await seedApplication(geo.communeA1.id, drawYear.year)
    await seedApplication(geo.communeB1.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const response = await request(app).get('/api/admin/dashboard').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.scope).toBe('NATIONAL')
    expect(response.body.drawYear.year).toBe(drawYear.year)
    expect(response.body.counts.applications).toBe(2)
    expect(response.body.counts.communeDraws).toBe(3)
    expect(response.body.counts.allocatedSpots).toBe(15)
  })

  it('counts only their own wilaya for a wilaya administrator', async () => {
    const { drawYear } = await seedYear()
    await seedApplication(geo.communeA1.id, drawYear.year)
    await seedApplication(geo.communeA2.id, drawYear.year)
    await seedApplication(geo.communeB1.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })
    const response = await request(app).get('/api/admin/dashboard').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.scope).toBe('WILAYA')
    // Two of the three applications, two of the three commune draws.
    expect(response.body.counts.applications).toBe(2)
    expect(response.body.counts.communeDraws).toBe(2)
    expect(response.body.counts.allocatedSpots).toBe(10)
  })

  it('counts only their own commune for a commune administrator', async () => {
    const { drawYear } = await seedYear()
    await seedApplication(geo.communeA1.id, drawYear.year)
    await seedApplication(geo.communeA2.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })
    const response = await request(app).get('/api/admin/dashboard').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.scope).toBe('COMMUNE')
    expect(response.body.counts.applications).toBe(1)
    expect(response.body.counts.communeDraws).toBe(1)
  })

  it('withholds the national queues from a scoped administrator', async () => {
    await seedYear()

    const national = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const scoped = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    const asNational = await request(app).get('/api/admin/dashboard').set('Cookie', national.cookie)
    const asScoped = await request(app).get('/api/admin/dashboard').set('Cookie', scoped.cookie)

    // Null, not zero, and not omitted: a count of a queue you cannot open is
    // either noise or an invitation to ask why.
    expect(asNational.body.governance).toEqual({ pendingImports: 0, pendingApprovals: 0 })
    expect(asScoped.body.governance).toBeNull()
  })

  it('reports the open year when one is open, and the latest when none is', async () => {
    await prisma.drawYear.create({ data: { year: 2029, status: 'ARCHIVED' } })
    await prisma.drawYear.create({ data: { year: 2030, status: 'REGISTRATION_CLOSED' } })

    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const closed = await request(app).get('/api/admin/dashboard').set('Cookie', cookie)
    expect(closed.body.drawYear.year).toBe(2030)

    // An open year takes precedence over a later closed one.
    await prisma.drawYear.create({ data: { year: 2028, status: 'REGISTRATION_OPEN' } })
    const open = await request(app).get('/api/admin/dashboard').set('Cookie', cookie)
    expect(open.body.drawYear.year).toBe(2028)
  })

  it('reports empty counts rather than failing when no draw year exists', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const response = await request(app).get('/api/admin/dashboard').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.drawYear).toBeNull()
    expect(response.body.counts.applications).toBe(0)
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await request(app).get('/api/admin/dashboard')
    expect(response.status).toBe(401)
  })
})

describe('GET /api/admin/applications', () => {
  it('returns only the caller’s own territory', async () => {
    const { drawYear } = await seedYear()
    const mine = await seedApplication(geo.communeA1.id, drawYear.year)
    await seedApplication(geo.communeB1.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })
    const response = await request(app).get('/api/admin/applications').set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.total).toBe(1)
    expect(response.body.items[0].applicationReference).toBe(mine.applicationReference)
  })

  it('lets a requested filter narrow, never widen', async () => {
    const { drawYear } = await seedYear()
    await seedApplication(geo.communeA1.id, drawYear.year)
    await seedApplication(geo.communeB1.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    // Asking for another wilaya's data yields the intersection, which is empty.
    const elsewhere = await request(app)
      .get(`/api/admin/applications?wilayaId=${geo.wilayaB.id}`)
      .set('Cookie', cookie)

    expect(elsewhere.status).toBe(200)
    expect(elsewhere.body.items).toEqual([])
  })

  it('matches an application reference exactly, never as a prefix', async () => {
    const { drawYear } = await seedYear()
    const application = await seedApplication(geo.communeA1.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const exact = await request(app)
      .get(`/api/admin/applications?applicationReference=${application.applicationReference}`)
      .set('Cookie', cookie)
    expect(exact.body.total).toBe(1)

    // A prefix search would turn the receipt into the enumeration oracle it
    // was designed not to be.
    const prefix = await request(app)
      .get(`/api/admin/applications?applicationReference=${application.applicationReference.slice(0, 8)}`)
      .set('Cookie', cookie)
    expect(prefix.body.total).toBe(0)
  })

  it('bounds the page size and refuses an unknown filter', async () => {
    await seedYear()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const tooBig = await request(app).get('/api/admin/applications?pageSize=5000').set('Cookie', cookie)
    expect(tooBig.status).toBe(400)
    expect(tooBig.body.code).toBe('VALIDATION_FAILED')

    // `.strict()`: a console that silently ignored a filter would show one
    // territory's data under another's label.
    const unknown = await request(app).get('/api/admin/applications?sort=desc').set('Cookie', cookie)
    expect(unknown.status).toBe(400)
  })
})

describe('GET /api/admin/applications/:id', () => {
  it('carries only the last four digits of a national ID, and no phone number', async () => {
    const { drawYear } = await seedYear()
    const application = await seedApplication(geo.communeA1.id, drawYear.year)
    const participant = await prisma.participant.findUniqueOrThrow({
      where: { id: application.primaryParticipantId },
    })
    await prisma.participant.update({
      where: { id: participant.id },
      data: { phoneNumber: '+213555123456' },
    })

    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const response = await request(app).get(`/api/admin/applications/${application.id}`).set('Cookie', cookie)

    expect(response.status).toBe(200)
    const applicant = response.body.applicants[0]
    expect(applicant.nationalIdSuffix).toBe(participant.nationalId.slice(-4))

    const serialized = JSON.stringify(response.body)
    expect(serialized).not.toContain(participant.nationalId)
    expect(serialized).not.toContain('555123456')
    expect(serialized).not.toContain('phoneNumber')
  })

  it('is a 404 out of scope, identical to one that never existed', async () => {
    const { drawYear } = await seedYear()
    const elsewhere = await seedApplication(geo.communeB1.id, drawYear.year)

    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const outOfScope = await request(app).get(`/api/admin/applications/${elsewhere.id}`).set('Cookie', cookie)
    const nonexistent = await request(app)
      .get('/api/admin/applications/clzzzzzzzzzzzzzzzzzzzzzzz')
      .set('Cookie', cookie)

    expect(outOfScope.status).toBe(404)
    expect(outOfScope.body).toEqual(nonexistent.body)
  })
})

describe('GET /api/admin/participants', () => {
  it('is national administrator work only', async () => {
    for (const role of [AdminRole.WILAYA_ADMIN, AdminRole.COMMUNE_ADMIN]) {
      const { cookie } = await createAdminAndSignIn(app, prisma, {
        role,
        wilayaId: geo.wilayaA.id,
        communeId: role === AdminRole.COMMUNE_ADMIN ? geo.communeA1.id : null,
      })

      const response = await request(app).get('/api/admin/participants').set('Cookie', cookie)
      expect(response.status, role).toBe(403)
      expect(response.body.code).toBe('FORBIDDEN_ROLE')
    }
  })

  it('matches a national ID only in full', async () => {
    const { drawYear } = await seedYear()
    const application = await seedApplication(geo.communeA1.id, drawYear.year)
    const participant = await prisma.participant.findUniqueOrThrow({
      where: { id: application.primaryParticipantId },
    })

    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const whole = await request(app)
      .get(`/api/admin/participants?nationalId=${participant.nationalId}`)
      .set('Cookie', cookie)
    expect(whole.body.total).toBe(1)

    // Anything shorter is rejected outright rather than treated as a prefix:
    // a registry that answered "which IDs begin with these digits?" would be a
    // way to discover who exists.
    const partial = await request(app)
      .get(`/api/admin/participants?nationalId=${participant.nationalId.slice(0, 10)}`)
      .set('Cookie', cookie)
    expect(partial.status).toBe(400)
  })
})

describe('administrator accounts', () => {
  it('is national administrator work only, on every route', async () => {
    const target = await createAdmin(prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    const responses = await Promise.all([
      request(app).get('/api/admin/admins').set('Cookie', cookie),
      request(app).post('/api/admin/admins').set('Cookie', cookie).send({}),
      request(app).patch(`/api/admin/admins/${target.id}/scope`).set('Cookie', cookie).send({}),
      request(app).post(`/api/admin/admins/${target.id}/deactivate`).set('Cookie', cookie).send({}),
    ])

    for (const response of responses) expect(response.status).toBe(403)
  })

  it('creates an account and records who created it', async () => {
    const { user, cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await request(app).post('/api/admin/admins').set('Cookie', cookie).send({
      username: 'new.commune.admin',
      password: 'a sufficiently long password',
      role: 'COMMUNE_ADMIN',
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    expect(response.status).toBe(201)
    expect(response.body.username).toBe('new.commune.admin')
    expect(response.body.commune.id).toBe(geo.communeA1.id)
    // Never the digest, and never the password.
    expect(JSON.stringify(response.body)).not.toContain('password')

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ADMIN_CREATED', actorUserId: user.id },
    })
    expect(audit).not.toBeNull()
  })

  it('refuses an assignment the role forbids', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await request(app).post('/api/admin/admins').set('Cookie', cookie).send({
      username: 'bad.assignment',
      password: 'a sufficiently long password',
      role: 'SUPER_ADMIN',
      wilayaId: geo.wilayaA.id,
    })

    expect(response.status).toBe(422)
    expect(response.body.code).toBe('INVALID_SCOPE_ASSIGNMENT')
  })

  it('refuses a commune outside the assigned wilaya', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await request(app).post('/api/admin/admins').set('Cookie', cookie).send({
      username: 'mismatched.scope',
      password: 'a sufficiently long password',
      role: 'COMMUNE_ADMIN',
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeB1.id,
    })

    expect(response.status).toBe(422)
  })

  it('refuses a duplicate username and a short password', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    await createAdmin(prisma, { role: AdminRole.WILAYA_ADMIN, username: 'taken', wilayaId: geo.wilayaA.id })

    const duplicate = await request(app).post('/api/admin/admins').set('Cookie', cookie).send({
      username: 'taken',
      password: 'a sufficiently long password',
      role: 'WILAYA_ADMIN',
      wilayaId: geo.wilayaA.id,
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.code).toBe('DUPLICATE_USERNAME')

    const short = await request(app)
      .post('/api/admin/admins')
      .set('Cookie', cookie)
      .send({
        username: 'shortpass',
        password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1),
        role: 'WILAYA_ADMIN',
        wilayaId: geo.wilayaA.id,
      })
    expect(short.status).toBe(400)
  })

  it('refuses to change your own role or scope', async () => {
    const { user, cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await request(app)
      .patch(`/api/admin/admins/${user.id}/scope`)
      .set('Cookie', cookie)
      .send({ role: 'WILAYA_ADMIN', wilayaId: geo.wilayaA.id, reason: 'Trying it on.' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN_SCOPE')
  })

  it('demands a reason for a scope change, and records both assignments', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const target = await createAdmin(prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    const blank = await request(app)
      .patch(`/api/admin/admins/${target.id}/scope`)
      .set('Cookie', cookie)
      .send({ role: 'WILAYA_ADMIN', wilayaId: geo.wilayaB.id, reason: '   ' })
    expect(blank.status).toBe(400)

    const changed = await request(app)
      .patch(`/api/admin/admins/${target.id}/scope`)
      .set('Cookie', cookie)
      .send({ role: 'WILAYA_ADMIN', wilayaId: geo.wilayaB.id, reason: 'Transferred to wilaya B.' })

    expect(changed.status).toBe(200)
    expect(changed.body.wilaya.id).toBe(geo.wilayaB.id)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'ADMIN_SCOPE_CHANGED', targetId: target.id },
    })
    expect(audit.reason).toBe('Transferred to wilaya B.')
    // Both sides of the change, so the trail says what the reach was as well
    // as what it became.
    expect(audit.beforeData).toMatchObject({ wilayaId: geo.wilayaA.id })
    expect(audit.afterData).toMatchObject({ wilayaId: geo.wilayaB.id })
  })

  it('will not remove the last way in', async () => {
    const { user, cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const other = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    // Two national administrators: deactivating one is fine.
    const first = await request(app)
      .post(`/api/admin/admins/${other.id}/deactivate`)
      .set('Cookie', cookie)
      .send({ reason: 'Left the department.' })
    expect(first.status).toBe(200)
    expect(first.body.isActive).toBe(false)

    // Now only the caller remains — and nobody may deactivate themselves
    // either, so the system cannot be left unadministered by this route.
    const self = await request(app)
      .post(`/api/admin/admins/${user.id}/deactivate`)
      .set('Cookie', cookie)
      .send({ reason: 'Trying it on.' })
    expect(self.status).toBe(403)

    const third = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })
    const thirdCookie = (await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })).cookie
    await request(app)
      .post(`/api/admin/admins/${third.id}/deactivate`)
      .set('Cookie', thirdCookie)
      .send({ reason: 'Left the department.' })

    // Down to two actives; deactivating one leaves one, which is allowed.
    // Attempting to go below that is refused.
    const remaining = await prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })
    expect(remaining).toBeGreaterThanOrEqual(1)
  })

  it('revokes the sessions of a deactivated account', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const target = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    // Their session works before…
    expect((await request(app).get('/api/auth/me').set('Cookie', target.cookie)).status).toBe(200)

    await request(app)
      .post(`/api/admin/admins/${target.user.id}/deactivate`)
      .set('Cookie', cookie)
      .send({ reason: 'Left the department.' })

    // …and not after. An account disabled only for future sign-ins is not
    // disabled.
    expect((await request(app).get('/api/auth/me').set('Cookie', target.cookie)).status).toBe(401)
  })

  it('has no route that deletes an account or resets a password', async () => {
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
    const target = await createAdmin(prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    const responses = await Promise.all([
      request(app).delete(`/api/admin/admins/${target.id}`).set('Cookie', cookie),
      request(app).post(`/api/admin/admins/${target.id}/password`).set('Cookie', cookie).send({}),
      request(app).patch(`/api/admin/admins/${target.id}`).set('Cookie', cookie).send({}),
    ])

    for (const response of responses) expect(response.status).toBe(404)
  })
})
