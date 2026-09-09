import { PrismaClient, type DrawYear, type User } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { assertSafePayload, diffSnapshots, normalizeAuditReason } from '../src/lib/audit-payload.js'
import { adminAccountService } from '../src/services/admin-account.service.js'
import { auditService } from '../src/services/audit.service.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { participationHistoryService } from '../src/services/participation-history.service.js'
import { weightService } from '../src/services/weight.service.js'
import {
  AdminRole,
  createAdmin,
  createAdminAndSignIn,
  ensureTestGeography,
  TEST_PASSWORD,
  type TestGeography,
} from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
let drawYear: DrawYear

/** Well away from the calendar year, so nothing collides with other suites. */
const YEAR = 2140

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `53000000000000${String(nextId).padStart(4, '0')}`
}

const actorOf = (user: User) => ({
  id: user.id,
  role: user.role,
  wilayaId: user.wilayaId,
  communeId: user.communeId,
})

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })
const communeAdmin = (wilayaId: string, communeId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId })

const auditVia = (cookie: string, query = '') =>
  request(app).get(`/api/admin/audit-logs${query}`).set('Cookie', cookie)

/** One participant with one historical record, in the given commune. */
async function historyRecord(communeId: string, drawYearValue = YEAR - 1) {
  const participant = await prisma.participant.create({
    data: { nationalId: nationalId(), fullName: 'Ledger Subject', dob: new Date('1980-04-12') },
  })

  return participationHistoryService.create({
    participantId: participant.id,
    communeId,
    drawYear: drawYearValue,
    participated: true,
    source: 'LEGACY_IMPORT',
    verified: false,
  })
}

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

describe('what may be written to the trail', () => {
  it('refuses personal data and secrets outright, rather than masking them', () => {
    for (const payload of [
      { nationalId: '123456789012345678' },
      { primary_national_id: '1' },
      { phoneNumber: '+213555000000' },
      { passwordHash: 'x' },
      { sessionToken: 'x' },
      { apiKey: 'x' },
      { dob: '1980-04-12' },
      { fullName: 'Somebody' },
      { nested: { deeper: { national_id: '1' } } },
    ]) {
      // Refusing beats redacting: a silently stripped field leaves a record that
      // looks complete while describing something else.
      expect(() => assertSafePayload(payload, 'before')).toThrow(/personal or secret/)
    }
  })

  it('allows the internal identifiers an investigation actually needs', () => {
    expect(() =>
      assertSafePayload({ status: 'ELIGIBLE', communeId: 'c1', calculatedWeight: 6 }, 'after'),
    ).not.toThrow()
  })

  it('refuses a payload large enough to be a copy of the record', () => {
    expect(() => assertSafePayload({ notes: 'x'.repeat(5000) }, 'after')).toThrow(/limit is/)
  })

  it('refuses a blank reason where one is required', () => {
    for (const blank of ['', '   ', '\n\t']) {
      expect(() => normalizeAuditReason('HISTORICAL_RECORD_CORRECTED', blank)).toThrow(/without a reason/)
    }
    expect(() => normalizeAuditReason('HISTORICAL_RECORD_CORRECTED', undefined)).toThrow(/without a reason/)
  })

  it('does not demand a reason for routine events', () => {
    expect(normalizeAuditReason('AUTH_LOGIN_SUCCESS', null)).toBeNull()
    expect(normalizeAuditReason('AUTH_LOGIN_SUCCESS', '  spaced  ')).toBe('spaced')
  })

  it('records only the fields that moved', () => {
    const diff = diffSnapshots(
      { status: 'DRAFT', allocatedSpots: 10 },
      { status: 'READY', allocatedSpots: 10 },
    )

    expect(diff.before).toEqual({ status: 'DRAFT' })
    expect(diff.after).toEqual({ status: 'READY' })
    expect(diffSnapshots({ a: 1 }, { a: 1 })).toEqual({ before: null, after: null })
  })
})

describe('the trail is append-only', () => {
  async function anEntry() {
    const { user } = await superAdmin()
    return auditService.record({
      action: 'AUTH_LOGIN_SUCCESS',
      actor: actorOf(user),
      targetType: 'USER',
      targetId: user.id,
    })
  }

  it('records an event with its actor', async () => {
    const { user } = await superAdmin()

    const entry = await auditService.record({
      action: 'AUTH_LOGIN_SUCCESS',
      actor: actorOf(user),
      targetType: 'USER',
      targetId: user.id,
    })

    expect(entry.actorUserId).toBe(user.id)
    expect(entry.action).toBe('AUTH_LOGIN_SUCCESS')
    expect(entry.createdAt).toBeInstanceOf(Date)
  })

  it('refuses an update, at the database', async () => {
    const entry = await anEntry()

    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { reason: 'rewritten' } }),
    ).rejects.toThrow()

    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).reason).toBeNull()
  })

  it('refuses a delete, at the database', async () => {
    const entry = await anEntry()

    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow()
    await expect(prisma.auditLog.deleteMany({ where: { id: entry.id } })).rejects.toThrow()

    expect(await prisma.auditLog.count({ where: { id: entry.id } })).toBe(1)
  })

  it('serves no route that writes, edits or clears the trail', async () => {
    const entry = await anEntry()
    const { cookie } = await superAdmin()

    for (const response of [
      await request(app).post('/api/admin/audit-logs').set('Cookie', cookie).send({ action: 'AUTH_LOGOUT' }),
      await request(app).delete('/api/admin/audit-logs').set('Cookie', cookie),
      await request(app).delete(`/api/admin/audit-logs/${entry.id}`).set('Cookie', cookie),
      await request(app).patch(`/api/admin/audit-logs/${entry.id}`).set('Cookie', cookie).send({}),
    ]) {
      expect(response.status).toBe(404)
    }

    expect(await prisma.auditLog.count()).toBeGreaterThan(0)
  })
})

describe('the actor is the session, never the request', () => {
  it('records the signed-in administrator, whatever the body claims', async () => {
    const { user, cookie } = await superAdmin()
    const impostor = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await request(app)
      .post('/api/admin/draw-years')
      .set('Cookie', cookie)
      .send({ year: YEAR + 5, actorUserId: impostor.id })

    // `.strict()` refuses the field rather than ignoring it: a request trying to
    // forge an identity should fail loudly, not succeed with the field dropped.
    expect(response.status).toBe(400)
    expect(await prisma.auditLog.count({ where: { action: 'DRAW_YEAR_CREATED' } })).toBe(0)

    const honest = await request(app)
      .post('/api/admin/draw-years')
      .set('Cookie', cookie)
      .send({ year: YEAR + 5 })

    expect(honest.status).toBe(201)
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DRAW_YEAR_CREATED' } })
    expect(entry.actorUserId).toBe(user.id)
    expect(entry.actorUserId).not.toBe(impostor.id)
  })
})

describe('authentication events', () => {
  it('records a successful sign-in against the account it was for', async () => {
    const user = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD })
    expect(response.status).toBe(200)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'AUTH_LOGIN_SUCCESS' } })
    expect(entry.actorUserId).toBe(user.id)

    // Nothing that could be replayed or that names a credential.
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain(TEST_PASSWORD)
    expect(serialized).not.toContain(user.username)
  })

  it('records a failure without naming an actor or an account', async () => {
    const user = await createAdmin(prisma, { role: AdminRole.SUPER_ADMIN })

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ username: user.username, password: 'not the right password at all' })
    const unknownUser = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody.at.all', password: TEST_PASSWORD })

    expect(wrongPassword.status).toBe(401)
    expect(unknownUser.status).toBe(401)

    const failures = await prisma.auditLog.findMany({ where: { action: 'AUTH_LOGIN_FAILURE' } })
    expect(failures).toHaveLength(2)

    // The two are indistinguishable in the trail, exactly as they are in the
    // response: recording which username was tried would turn the log into a
    // list of guessed account names, and recording whether it existed would
    // answer through the audit trail the question the 401 refuses to answer.
    for (const failure of failures) {
      expect(failure.actorUserId).toBeNull()
      expect(failure.targetId).toBeNull()
      expect(JSON.stringify(failure)).not.toContain(user.username)
    }
    expect(failures[0]?.metadata).toEqual(failures[1]?.metadata)
  })

  it('records a sign-out', async () => {
    const { user, cookie } = await superAdmin()

    expect((await request(app).post('/api/auth/logout').set('Cookie', cookie)).status).toBe(204)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'AUTH_LOGOUT' } })
    expect(entry.actorUserId).toBe(user.id)
  })
})

describe('administrator accounts', () => {
  it('records a disabling, with its reason, and revokes the sessions', async () => {
    const { user: actor } = await superAdmin()
    const { user: target, cookie: targetCookie } = await wilayaAdmin(geo.wilayaA.id)

    await adminAccountService.deactivate(actor, target.id, 'Left the department')

    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(false)
    expect(await prisma.session.count({ where: { userId: target.id } })).toBe(0)
    // Disabled in the sense that also stops the session they already had.
    expect((await request(app).get('/api/auth/me').set('Cookie', targetCookie)).status).toBe(401)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ADMIN_DISABLED' } })
    expect(entry).toMatchObject({ actorUserId: actor.id, targetId: target.id, reason: 'Left the department' })
    expect(entry.wilayaId).toBeNull()
  })

  it('refuses to disable without a reason, and changes nothing', async () => {
    const { user: actor } = await superAdmin()
    const { user: target } = await wilayaAdmin(geo.wilayaA.id)

    await expect(adminAccountService.deactivate(actor, target.id, '   ')).rejects.toThrow(/without a reason/)

    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(true)
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_DISABLED' } })).toBe(0)
  })

  it('records a scope change with what it was and what it became', async () => {
    const { user: actor } = await superAdmin()
    const { user: target } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    await adminAccountService.changeScope(
      actor,
      target.id,
      { role: AdminRole.WILAYA_ADMIN, wilayaId: geo.wilayaA.id },
      'Promoted to cover the whole wilaya',
    )

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(updated.role).toBe('WILAYA_ADMIN')
    expect(updated.communeId).toBeNull()

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ADMIN_SCOPE_CHANGED' } })
    expect(entry.beforeData).toMatchObject({ role: 'COMMUNE_ADMIN', communeId: geo.communeA1.id })
    expect(entry.afterData).toMatchObject({ role: 'WILAYA_ADMIN', communeId: null })
    // National: an administrator's authority is not a property of a territory,
    // and filing it under one would let them watch their own permissions change.
    expect(entry.wilayaId).toBeNull()
    expect(entry.communeId).toBeNull()
  })

  it('rolls back the change when its audit record cannot be written', async () => {
    const { user: actor } = await superAdmin()
    const { user: target } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    // A reason far past the limit fails inside the transaction, after the user
    // row has already been updated.
    await expect(
      adminAccountService.changeScope(
        actor,
        target.id,
        { role: AdminRole.WILAYA_ADMIN, wilayaId: geo.wilayaA.id },
        'x'.repeat(2000),
      ),
    ).rejects.toThrow()

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: target.id } })
    expect(unchanged.role).toBe('COMMUNE_ADMIN')
    expect(unchanged.communeId).toBe(geo.communeA1.id)
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_SCOPE_CHANGED' } })).toBe(0)
  })
})

describe('draw configuration is audited', () => {
  it('records a commune draw and the allocation it was given', async () => {
    const { user, cookie } = await superAdmin()

    const created = await request(app)
      .post('/api/admin/commune-draws')
      .set('Cookie', cookie)
      .send({ drawYearId: drawYear.id, communeId: geo.communeA1.id, allocatedSpots: 12 })
    expect(created.status).toBe(201)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'COMMUNE_DRAW_CREATED' } })
    expect(entry.actorUserId).toBe(user.id)
    expect(entry.communeId).toBe(geo.communeA1.id)
    expect(entry.wilayaId).toBe(geo.wilayaA.id)
    expect(entry.afterData).toMatchObject({ allocatedSpots: 12, status: 'DRAFT' })
  })

  it('records only what an update changed', async () => {
    const { cookie } = await superAdmin()
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 10,
    })

    const updated = await request(app)
      .patch(`/api/admin/commune-draws/${communeDraw.id}`)
      .set('Cookie', cookie)
      .send({ allocatedSpots: 25 })
    expect(updated.status).toBe(200)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'COMMUNE_DRAW_UPDATED' } })
    expect(entry.beforeData).toEqual({ allocatedSpots: 10 })
    expect(entry.afterData).toEqual({ allocatedSpots: 25 })
  })

  it('records a draw year opening as a national event', async () => {
    const { cookie } = await superAdmin()
    const draft = await prisma.drawYear.create({ data: { year: YEAR + 3, status: 'DRAFT' } })
    await prisma.drawYear.update({ where: { id: drawYear.id }, data: { status: 'REGISTRATION_CLOSED' } })

    const opened = await request(app)
      .patch(`/api/admin/draw-years/${draft.id}`)
      .set('Cookie', cookie)
      .send({ status: 'REGISTRATION_OPEN' })
    expect(opened.status).toBe(200)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DRAW_YEAR_STATUS_CHANGED' } })
    expect(entry.beforeData).toEqual({ status: 'DRAFT' })
    expect(entry.afterData).toEqual({ status: 'REGISTRATION_OPEN' })
    expect(entry.wilayaId).toBeNull()
    expect(entry.communeId).toBeNull()
  })
})

describe('the lottery is audited', () => {
  /**
   * A locked commune draw with a frozen pool, ready to execute.
   *
   * Enough entries for the winners *and* the reserve list by default — a draw
   * for N places needs 2N — with `entries` left open so a test can deliberately
   * under-supply one and watch the execution refuse.
   */
  async function frozen(cookie: string, allocatedSpots = 1, entries = allocatedSpots * 2) {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots,
    })

    for (let entry = 0; entry < entries; entry += 1) {
      const response = await request(app)
        .post('/api/applications')
        .send({
          entryType: 'SINGLE',
          wilayaId: geo.wilayaA.id,
          communeId: geo.communeA1.id,
          primary: { nationalId: nationalId(), fullName: 'Draw Subject', dob: '1980-04-12' },
        })
      if (response.status !== 201) throw new Error(`Registration failed: ${response.status}`)

      const application = await prisma.application.findFirstOrThrow({
        where: { applicationReference: response.body.applicationReference },
      })
      await weightService.freezeApplicationWeight(application.id)
    }

    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')

    await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/freeze-pool`).set('Cookie', cookie)

    return communeDraw
  }

  it('records the freeze with its aggregates and hash, and no entries', async () => {
    const { user, cookie } = await superAdmin()
    const communeDraw = await frozen(cookie)

    const pool = await prisma.drawPool.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DRAW_POOL_FROZEN' } })

    expect(entry).toMatchObject({ actorUserId: user.id, targetId: pool.id, communeId: geo.communeA1.id })
    expect(entry.metadata).toMatchObject({
      entryCount: pool.entryCount,
      totalWeight: pool.totalWeight,
      snapshotHash: pool.snapshotHash,
    })
    // The pool's contents are not copied into the trail.
    expect(JSON.stringify(entry.metadata)).not.toContain('applicationReference')
  })

  it('records the execution, referencing the authoritative records', async () => {
    const { user, cookie } = await superAdmin()
    const communeDraw = await frozen(cookie)

    const executed = await request(app)
      .post(`/api/admin/commune-draws/${communeDraw.id}/execute`)
      .set('Cookie', cookie)
    expect(executed.status).toBe(201)

    const result = await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } })
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'COMMUNE_DRAW_EXECUTED' } })

    expect(entry).toMatchObject({ actorUserId: user.id, targetId: result.id, communeId: geo.communeA1.id })
    expect(entry.metadata).toMatchObject({
      poolHash: result.poolHash,
      algorithmVersion: 'weighted-csprng-v1',
      winnerCount: 1,
      // The reserve list is part of what the draw produced, so the record of
      // running it says how long the list is.
      reserveCount: 1,
    })

    // No winner is named, and no random value is repeated: the immutable
    // selection events already hold them.
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('Draw Subject')
    expect(serialized).not.toContain('randomValue')
  })

  it('leaves no audit record when the execution rolls back', async () => {
    const { cookie } = await superAdmin()
    // Two places, one entry: refused, and the whole transaction unwinds.
    const communeDraw = await frozen(cookie, 2, 1)

    const refused = await request(app)
      .post(`/api/admin/commune-draws/${communeDraw.id}/execute`)
      .set('Cookie', cookie)

    expect(refused.status).toBe(409)
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'COMMUNE_DRAW_EXECUTED' } })).toBe(0)
    // The freeze that did succeed keeps its record.
    expect(await prisma.auditLog.count({ where: { action: 'DRAW_POOL_FROZEN' } })).toBe(1)
  })
})

describe('historical corrections are governed', () => {
  it('lets a scoped administrator ask, and records the request', async () => {
    const record = await historyRecord(geo.communeA1.id)
    const { user, cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const requested = await request(app)
      .post(`/api/admin/history/${record.id}/correction-requests`)
      .set('Cookie', cookie)
      .send({ verified: true, reason: 'Checked against the 2139 register at the town hall' })

    expect(requested.status).toBe(201)
    expect(requested.body).toMatchObject({
      type: 'HISTORICAL_RECORD_CORRECTION',
      status: 'PENDING',
      requestedBy: { id: user.id },
      reviewedBy: null,
      communeCode: geo.communeA1.code,
    })

    // The record itself has not moved: asking is not doing.
    expect((await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })).verified).toBe(
      false,
    )

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'APPROVAL_CREATED' } })
    expect(entry.actorUserId).toBe(user.id)
    expect(entry.communeId).toBe(geo.communeA1.id)
  })

  it('refuses a request with no reason', async () => {
    const record = await historyRecord(geo.communeA1.id)
    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const body of [{ verified: true }, { verified: true, reason: '   ' }]) {
      const response = await request(app)
        .post(`/api/admin/history/${record.id}/correction-requests`)
        .set('Cookie', cookie)
        .send(body)
      expect(response.status).toBe(400)
    }

    expect(await prisma.approvalRequest.count()).toBe(0)
  })

  it('gives a scoped administrator no way to correct a record directly', async () => {
    const record = await historyRecord(geo.communeA1.id)

    for (const { cookie } of [
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
      await wilayaAdmin(geo.wilayaA.id),
    ]) {
      const response = await request(app)
        .patch(`/api/admin/history/${record.id}`)
        .set('Cookie', cookie)
        .send({ verified: true, reason: 'I would rather not ask' })

      expect(response.status).toBe(403)
      expect(response.body.code).toBe('FORBIDDEN_ROLE')
    }

    expect((await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })).verified).toBe(
      false,
    )
  })

  it('applies a SUPER_ADMIN correction directly, with its reason', async () => {
    const record = await historyRecord(geo.communeA1.id)
    const { user, cookie } = await superAdmin()

    const corrected = await request(app)
      .patch(`/api/admin/history/${record.id}`)
      .set('Cookie', cookie)
      .send({ verified: true, reason: 'Verified against the official register' })

    expect(corrected.status).toBe(200)

    const after = await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })
    expect(after.verified).toBe(true)
    // The reason becomes the note: one sentence, in one place.
    expect(after.notes).toBe('Verified against the official register')
    expect(after.source).toBe('ADMIN_CORRECTION')

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'HISTORICAL_RECORD_CORRECTED' } })
    expect(entry).toMatchObject({ actorUserId: user.id, targetId: record.id, communeId: geo.communeA1.id })
    expect(entry.beforeData).toMatchObject({ verified: false })
    expect(entry.afterData).toMatchObject({ verified: true })
  })

  it('rolls the correction back when its audit record cannot be written', async () => {
    const record = await historyRecord(geo.communeA1.id)
    const { cookie } = await superAdmin()

    const refused = await request(app)
      .patch(`/api/admin/history/${record.id}`)
      .set('Cookie', cookie)
      .send({ verified: true, reason: 'x'.repeat(2000) })

    expect(refused.status).toBe(400)
    expect((await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })).verified).toBe(
      false,
    )
    expect(await prisma.auditLog.count({ where: { action: 'HISTORICAL_RECORD_CORRECTED' } })).toBe(0)
  })
})

describe('approvals', () => {
  /** A pending request raised by a commune administrator. */
  async function pending(communeId = geo.communeA1.id, wilayaId = geo.wilayaA.id) {
    const record = await historyRecord(communeId)
    const requester = await communeAdmin(wilayaId, communeId)

    const response = await request(app)
      .post(`/api/admin/history/${record.id}/correction-requests`)
      .set('Cookie', requester.cookie)
      .send({ verified: true, reason: 'Confirmed with the register' })
    if (response.status !== 201) throw new Error(`Request failed: ${response.status}`)

    return { record, requester, requestId: response.body.id as string }
  }

  it('applies the correction when approved, and records both facts', async () => {
    const { record, requestId } = await pending()
    const { user: reviewer, cookie } = await superAdmin()

    const approved = await request(app)
      .post(`/api/admin/approvals/${requestId}/approve`)
      .set('Cookie', cookie)
      .send({ reason: 'Register checked and agrees' })

    expect(approved.status).toBe(200)
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      reviewedBy: { id: reviewer.id },
      reviewReason: 'Register checked and agrees',
    })
    expect(approved.body.reviewedAt).not.toBeNull()

    // Approving is applying: the record moved in the same transaction.
    const after = await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })
    expect(after.verified).toBe(true)

    const actions = await prisma.auditLog.findMany({ select: { action: true } })
    expect(actions.map((entry) => entry.action)).toContain('APPROVAL_APPROVED')
    expect(actions.map((entry) => entry.action)).toContain('HISTORICAL_RECORD_CORRECTED')
  })

  it('refuses to let the requester decide their own request', async () => {
    const record = await historyRecord(geo.communeA1.id)
    // A national administrator who raises a request cannot then approve it.
    const { user, cookie } = await superAdmin()

    const requested = await request(app)
      .post(`/api/admin/history/${record.id}/correction-requests`)
      .set('Cookie', cookie)
      .send({ verified: true, reason: 'Raising this for a colleague to check' })
    expect(requested.status).toBe(201)

    const selfApproved = await request(app)
      .post(`/api/admin/approvals/${requested.body.id}/approve`)
      .set('Cookie', cookie)
      .send({ reason: 'Approving my own' })

    expect(selfApproved.status).toBe(403)
    expect(selfApproved.body.code).toBe('SELF_APPROVAL_FORBIDDEN')

    const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requested.body.id } })
    expect(stored.status).toBe('PENDING')
    expect(stored.requestedByUserId).toBe(user.id)
    expect((await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })).verified).toBe(
      false,
    )
  })

  it('refuses self-review at the database as well as in the service', async () => {
    const { requester, requestId } = await pending()

    await expect(
      prisma.approvalRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedByUserId: requester.user.id,
          reviewedAt: new Date(),
          reviewReason: 'sneaking it through',
        },
      }),
    ).rejects.toThrow()
  })

  it('records a rejection and leaves the record alone', async () => {
    const { record, requestId } = await pending()
    const { cookie } = await superAdmin()

    const rejected = await request(app)
      .post(`/api/admin/approvals/${requestId}/reject`)
      .set('Cookie', cookie)
      .send({ reason: 'The register does not support this' })

    expect(rejected.status).toBe(200)
    expect(rejected.body.status).toBe('REJECTED')
    expect((await prisma.participationHistory.findUniqueOrThrow({ where: { id: record.id } })).verified).toBe(
      false,
    )
    expect(await prisma.auditLog.count({ where: { action: 'APPROVAL_REJECTED' } })).toBe(1)
  })

  it('cannot turn a rejection into an approval, by any route', async () => {
    const { requestId } = await pending()
    const { cookie } = await superAdmin()

    await request(app)
      .post(`/api/admin/approvals/${requestId}/reject`)
      .set('Cookie', cookie)
      .send({ reason: 'Not supported by the register' })

    // Not through the API...
    const again = await request(app)
      .post(`/api/admin/approvals/${requestId}/approve`)
      .set('Cookie', cookie)
      .send({ reason: 'Changed my mind' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('APPROVAL_NOT_PENDING')

    // ...and not underneath it either. A changed mind is a new request.
    await expect(
      prisma.approvalRequest.update({ where: { id: requestId }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow()

    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).status).toBe(
      'REJECTED',
    )
  })

  it('preserves the request itself against rewriting', async () => {
    const { requestId } = await pending()

    for (const data of [
      { reason: 'a different justification' },
      { requestedChange: { verified: false } },
      { createdAt: new Date('2000-01-01') },
    ]) {
      await expect(prisma.approvalRequest.update({ where: { id: requestId }, data })).rejects.toThrow()
    }

    await expect(prisma.approvalRequest.delete({ where: { id: requestId } })).rejects.toThrow()
    expect(await prisma.approvalRequest.count({ where: { id: requestId } })).toBe(1)
  })

  it('lets the requester withdraw, and nobody else', async () => {
    const { requester, requestId } = await pending()
    const other = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const refused = await request(app)
      .post(`/api/admin/approvals/${requestId}/cancel`)
      .set('Cookie', other.cookie)
      .send({ reason: 'Not mine to withdraw' })
    expect(refused.status).toBe(403)

    const cancelled = await request(app)
      .post(`/api/admin/approvals/${requestId}/cancel`)
      .set('Cookie', requester.cookie)
      .send({ reason: 'Raised against the wrong year' })

    expect(cancelled.status).toBe(200)
    expect(cancelled.body.status).toBe('CANCELLED')
    // A withdrawal is not a decision on the merits, so there is no reviewer.
    expect(cancelled.body.reviewedBy).toBeNull()
    expect(await prisma.auditLog.count({ where: { action: 'APPROVAL_CANCELLED' } })).toBe(1)
  })

  it('hides another territory’s request exactly as if it did not exist', async () => {
    const { requestId } = await pending(geo.communeB1.id, geo.wilayaB.id)

    for (const { cookie } of [
      await wilayaAdmin(geo.wilayaA.id),
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
    ]) {
      const refused = await request(app).get(`/api/admin/approvals/${requestId}`).set('Cookie', cookie)
      const missing = await request(app).get('/api/admin/approvals/no-such-request').set('Cookie', cookie)

      expect(refused.status).toBe(404)
      expect(refused.body).toEqual(missing.body)

      const listed = await request(app).get('/api/admin/approvals').set('Cookie', cookie)
      expect(listed.body.items).toEqual([])
    }
  })
})

describe('who can see the trail', () => {
  /**
   * One national event, one in wilaya A's commune, one in wilaya B's — the three
   * cases every visibility rule has to get right at once.
   */
  async function spread() {
    const { user } = await superAdmin()
    const actor = actorOf(user)

    await auditService.record({ action: 'DRAW_YEAR_CREATED', actor, targetType: 'DRAW_YEAR' })
    await auditService.record({
      action: 'COMMUNE_DRAW_CREATED',
      actor,
      targetType: 'COMMUNE_DRAW',
      scope: { wilayaId: geo.wilayaA.id, communeId: geo.communeA1.id },
    })
    await auditService.record({
      action: 'COMMUNE_DRAW_CREATED',
      actor,
      targetType: 'COMMUNE_DRAW',
      scope: { wilayaId: geo.wilayaB.id, communeId: geo.communeB1.id },
    })
  }

  it('shows a SUPER_ADMIN everything', async () => {
    await spread()
    const { cookie } = await superAdmin()

    const response = await auditVia(cookie)

    expect(response.status).toBe(200)
    expect(response.body.total).toBeGreaterThanOrEqual(3)
    const communes = response.body.items.map((item: { communeCode: string | null }) => item.communeCode)
    expect(communes).toContain(geo.communeA1.code)
    expect(communes).toContain(geo.communeB1.code)
    expect(communes).toContain(null)
  })

  it('shows a WILAYA_ADMIN their own wilaya and nothing else', async () => {
    await spread()
    const { cookie } = await wilayaAdmin(geo.wilayaA.id)

    const response = await auditVia(cookie)
    const items: { communeCode: string | null }[] = response.body.items

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item.communeCode).toBe(geo.communeA1.code)
  })

  it('shows a COMMUNE_ADMIN their own commune and nothing else', async () => {
    await spread()
    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const items: { communeCode: string | null }[] = (await auditVia(cookie)).body.items

    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item.communeCode).toBe(geo.communeA1.code)
  })

  it('withholds national events from scoped administrators', async () => {
    await spread()

    for (const { cookie } of [
      await wilayaAdmin(geo.wilayaA.id),
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
    ]) {
      const items: { action: string; communeCode: string | null }[] = (await auditVia(cookie)).body.items

      // An unscoped row here is a *national action* — an administrator's
      // privileges changing, the system being configured — not shared reference
      // data. Nobody scoped watches those.
      expect(items.some((item) => item.communeCode === null)).toBe(false)
      expect(items.some((item) => item.action === 'DRAW_YEAR_CREATED')).toBe(false)
    }
  })

  it('lets a filter narrow but never widen', async () => {
    await spread()
    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    // Asking for another territory returns nothing, not that territory's trail.
    const elsewhere = await auditVia(cookie, `?communeId=${geo.communeB1.id}`)
    expect(elsewhere.status).toBe(200)
    expect(elsewhere.body.items).toEqual([])

    const own = await auditVia(cookie, `?communeId=${geo.communeA1.id}`)
    expect(own.body.items.length).toBeGreaterThan(0)
  })

  it('never reveals whether another region has activity', async () => {
    await spread()
    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const busyElsewhere = await auditVia(cookie, `?communeId=${geo.communeB1.id}`)
    const quietNowhere = await auditVia(cookie, '?communeId=no-such-commune')

    expect(busyElsewhere.body).toEqual(quietNowhere.body)
  })

  it('refuses an unauthenticated caller', async () => {
    await spread()

    expect((await request(app).get('/api/admin/audit-logs')).status).toBe(401)
  })

  it('exposes no audit route publicly', async () => {
    await spread()

    // Nothing outside /api/admin serves the trail at all — not to a citizen,
    // and not to anybody holding a session.
    const { cookie } = await superAdmin()

    for (const path of ['/api/audit-logs', '/api/approvals', '/api/admin-audit-logs']) {
      expect((await request(app).get(path)).status).toBe(404)
      expect((await request(app).get(path).set('Cookie', cookie)).status).toBe(404)
    }
  })
})

describe('reading the trail', () => {
  async function manyEntries(count: number) {
    const { user, cookie } = await superAdmin()
    const actor = actorOf(user)

    for (let index = 0; index < count; index += 1) {
      await auditService.record({
        action: index % 2 === 0 ? 'DRAW_YEAR_CREATED' : 'AUTH_LOGOUT',
        actor,
        targetType: index % 2 === 0 ? 'DRAW_YEAR' : 'USER',
        targetId: `target-${index}`,
      })
    }

    return { user, cookie }
  }

  it('pages rather than returning everything', async () => {
    const { cookie } = await manyEntries(12)

    const first = await auditVia(cookie, '?page=1&pageSize=5')
    const second = await auditVia(cookie, '?page=2&pageSize=5')

    expect(first.body.items).toHaveLength(5)
    expect(first.body.pageSize).toBe(5)
    expect(first.body.total).toBeGreaterThanOrEqual(12)
    expect(first.body.totalPages).toBeGreaterThanOrEqual(3)

    const firstIds = first.body.items.map((item: { id: string }) => item.id)
    const secondIds = second.body.items.map((item: { id: string }) => item.id)
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false)
  })

  it('caps an over-large page size', async () => {
    const { cookie } = await manyEntries(3)

    const response = await auditVia(cookie, '?pageSize=100000')

    expect(response.status).toBe(400)
  })

  it('filters by action, target and actor', async () => {
    const { user, cookie } = await manyEntries(6)

    const byAction = await auditVia(cookie, '?action=AUTH_LOGOUT')
    expect(byAction.body.items.length).toBeGreaterThan(0)
    for (const item of byAction.body.items) expect(item.action).toBe('AUTH_LOGOUT')

    const byTarget = await auditVia(cookie, '?targetType=DRAW_YEAR&targetId=target-0')
    expect(byTarget.body.items).toHaveLength(1)

    const byActor = await auditVia(cookie, `?actorUserId=${user.id}`)
    expect(byActor.body.items.length).toBeGreaterThan(0)

    const byNobody = await auditVia(cookie, '?actorUserId=no-such-user')
    expect(byNobody.body.items).toEqual([])
  })

  it('filters by date range', async () => {
    const { cookie } = await manyEntries(3)

    const future = new Date(Date.now() + 86_400_000).toISOString()
    const past = new Date(Date.now() - 86_400_000).toISOString()

    expect((await auditVia(cookie, `?from=${future}`)).body.items).toEqual([])
    expect((await auditVia(cookie, `?from=${past}`)).body.items.length).toBeGreaterThan(0)
    expect((await auditVia(cookie, `?from=${future}&to=${past}`)).status).toBe(400)
  })

  it('refuses a filter it does not recognise', async () => {
    const { cookie } = await superAdmin()

    for (const query of ['?action=NOT_AN_ACTION', '?targetType=NONSENSE', '?unknownFilter=1']) {
      expect((await auditVia(cookie, query)).status).toBe(400)
    }
  })

  it('names the actor without exposing anything else about them', async () => {
    const { user, cookie } = await manyEntries(1)

    const item = (await auditVia(cookie)).body.items[0]

    expect(item.actor).toEqual({ id: user.id, username: user.username })
    expect(JSON.stringify(item)).not.toContain('passwordHash')
  })
})
