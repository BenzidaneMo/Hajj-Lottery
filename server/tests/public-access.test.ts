import { PrismaClient, type Application, type Commune, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { normalizeApplicationReference } from '../src/lib/application-reference.js'
import { assessResultIntegrity, type ResultIntegrityFacts } from '../src/lib/result-integrity.js'
import { toPublicApplicationStatus, toPublicDrawPhase } from '../src/lib/public-status.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { drawExecutionService } from '../src/services/draw-execution.service.js'
import { drawPoolService } from '../src/services/draw-pool.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
let drawYear: DrawYear

/** Well away from the calendar year and from every other suite's fixture. */
const YEAR = 2146

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `53000000000000${String(nextId).padStart(4, '0')}`
}

let nextPhone = 0
/** A distinct, valid Algerian mobile number per applicant. */
function phoneNumber(): string {
  nextPhone += 1
  return `0555${String(nextPhone).padStart(6, '0')}`
}

// --- Fixtures ---------------------------------------------------------------

interface RegisteredApplication {
  application: Application
  /** As typed by the citizen — deliberately not the canonical stored form. */
  phoneNumber: string
  primaryNationalId: string
  secondaryNationalId: string | null
  dob: string
}

interface RegisterOptions {
  paired?: boolean
  /** Omit the phone number entirely, as the form permits. */
  withoutPhone?: boolean
}

/**
 * The commune draw registration requires, created if it is not already there.
 *
 * `update: {}` on purpose: a fixture that already set an allocation must keep
 * it, so registering into a commune later in the same test cannot silently
 * reset how many places it has.
 */
async function ensureCommuneDraw(communeId: string, allocatedSpots = 1): Promise<CommuneDraw> {
  return prisma.communeDraw.upsert({
    where: { drawYearId_communeId: { drawYearId: drawYear.id, communeId } },
    update: {},
    create: { drawYearId: drawYear.id, communeId, allocatedSpots },
  })
}

async function register(
  commune: { id: string; wilayaId: string },
  options: RegisterOptions = {},
): Promise<RegisteredApplication> {
  await ensureCommuneDraw(commune.id)
  const primaryNationalId = nationalId()
  const secondaryNationalId = options.paired ? nationalId() : null
  const phone = phoneNumber()
  const dob = '1979-03-21'

  const body: Record<string, unknown> = {
    entryType: options.paired ? 'PAIRED' : 'SINGLE',
    wilayaId: commune.wilayaId,
    communeId: commune.id,
    primary: {
      nationalId: primaryNationalId,
      fullName: 'Public Subject',
      dob,
      ...(options.withoutPhone ? {} : { phoneNumber: phone }),
    },
    ...(secondaryNationalId
      ? { secondary: { nationalId: secondaryNationalId, fullName: 'Public Partner', dob: '1981-11-02' } }
      : {}),
  }

  const response = await request(app).post('/api/applications').send(body)
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })
  await weightService.freezeApplicationWeight(application.id)

  return { application, phoneNumber: phone, primaryNationalId, secondaryNationalId, dob }
}

interface DrawSpec {
  commune: { id: string; wilayaId: string }
  entries?: RegisterOptions[]
  allocatedSpots?: number
}

interface CompletedDraw {
  communeDraw: CommuneDraw
  registered: RegisteredApplication[]
}

/**
 * Commune draws carried all the way to recorded results.
 *
 * The whole chain, because publication is a read over what execution left
 * behind: nothing here may be faked, or the integrity gate would have nothing
 * real to check.
 *
 * Takes every commune at once because the order is forced by the domain — every
 * registration has to happen while the year is still open, and intake closes for
 * the nation rather than per commune, so freezing and drawing all come after the
 * last application.
 */
async function completedDraws(specs: DrawSpec[]): Promise<CompletedDraw[]> {
  const prepared: CompletedDraw[] = []

  for (const spec of specs) {
    // Before the registrations below, so the allocation this spec asks for is
    // the one that survives.
    const communeDraw = await ensureCommuneDraw(spec.commune.id, spec.allocatedSpots ?? 1)

    const registered: RegisteredApplication[] = []
    for (const options of spec.entries ?? [{}]) registered.push(await register(spec.commune, options))

    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    prepared.push({ communeDraw, registered })
  }

  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')

  for (const one of prepared) {
    await drawPoolService.freeze(one.communeDraw.id)
    await drawExecutionService.execute(one.communeDraw.id)
  }

  return prepared
}

async function completedDraw(
  commune: { id: string; wilayaId: string },
  entries: RegisterOptions[] = [{}],
  allocatedSpots = 1,
): Promise<CompletedDraw> {
  const [only] = await completedDraws([{ commune, entries, allocatedSpots }])
  if (!only) throw new Error('fixture produced no draw')
  return only
}

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })
const communeAdmin = (wilayaId: string, communeId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId })

const publishVia = (communeDrawId: string, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${communeDrawId}/publish-result`).set('Cookie', cookie)

/** Publishes as a fresh SUPER_ADMIN and asserts it worked. */
async function publish(communeDrawId: string): Promise<void> {
  const { cookie } = await superAdmin()
  const response = await publishVia(communeDrawId, cookie)
  if (response.status !== 201) {
    throw new Error(`Publication failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
}

const lookup = (body: Record<string, unknown>) =>
  request(app).post('/api/public/application-status').send(body)

/**
 * Fails a test if any of `secrets` appears anywhere in a response.
 *
 * Serialized and searched rather than asserted field by field, because the risk
 * is a field nobody thought to assert about — a nested include, a column added
 * upstream, a helper that spread a model.
 */
function expectNoSecrets(body: unknown, secrets: (string | null)[]): void {
  const serialized = JSON.stringify(body)
  for (const secret of secrets) {
    if (secret === null || secret === '') continue
    expect(serialized).not.toContain(secret)
  }
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

// --- The pure mappings ------------------------------------------------------

describe('mapping internal state to what the public is told', () => {
  it('gives every internal application status a public meaning', () => {
    expect(toPublicApplicationStatus('PENDING', false)).toBe('SUBMITTED')
    expect(toPublicApplicationStatus('ELIGIBLE', false)).toBe('IN_DRAW')
    expect(toPublicApplicationStatus('INELIGIBLE', false)).toBe('NOT_ELIGIBLE')
  })

  it('withholds a settled outcome until the result is published', () => {
    // The same value for both, not two similar ones: watching for a change must
    // reveal nothing either.
    expect(toPublicApplicationStatus('SELECTED', false)).toBe('AWAITING_RESULTS')
    expect(toPublicApplicationStatus('NOT_SELECTED', false)).toBe('AWAITING_RESULTS')
    expect(toPublicApplicationStatus('SELECTED', false)).toBe(
      toPublicApplicationStatus('NOT_SELECTED', false),
    )
  })

  it('releases the outcome once the result is published', () => {
    expect(toPublicApplicationStatus('SELECTED', true)).toBe('SELECTED')
    expect(toPublicApplicationStatus('NOT_SELECTED', true)).toBe('NOT_SELECTED')
  })

  it('collapses administrative preparation into one public phase', () => {
    expect(toPublicDrawPhase('DRAFT')).toBe('ACCEPTING')
    expect(toPublicDrawPhase('READY')).toBe('ACCEPTING')
    expect(toPublicDrawPhase('LOCKED')).toBe('ENTRIES_CLOSED')
    expect(toPublicDrawPhase('COMPLETED')).toBe('DRAWN')
    expect(toPublicDrawPhase('CANCELLED')).toBe('CANCELLED')
  })
})

describe('the publication integrity rules, in isolation', () => {
  const whole: ResultIntegrityFacts = {
    communeDrawStatus: 'COMPLETED',
    result: { winnerCount: 3, drawPoolId: 'pool-1', poolHash: 'hash-1' },
    pool: { id: 'pool-1', snapshotHash: 'hash-1', entryCount: 9, allocatedSpots: 3 },
    drawWinnerCount: 3,
    selectionEventCount: 3,
    selectionOrderBounds: { min: 1, max: 3 },
    expectedWinningParticipants: 4,
    archivedWinnerCount: 4,
    excludedWinnerCount: 4,
    pooledParticipantCount: 11,
    participationRecordCount: 11,
  }

  it('passes a result that reconciles', () => {
    expect(assessResultIntegrity(whole)).toEqual([])
  })

  it('reports a draw that was never run, and nothing else', () => {
    // One decisive fact rather than the cascade of consequences it causes.
    expect(assessResultIntegrity({ ...whole, communeDrawStatus: 'LOCKED' })).toEqual(['DRAW_NOT_COMPLETED'])
  })

  it('catches a snapshot whose fingerprint no longer matches the result', () => {
    const tampered = { ...whole, pool: { ...whole.pool!, snapshotHash: 'hash-2' } }
    expect(assessResultIntegrity(tampered)).toContain('POOL_HASH_MISMATCH')
  })

  it('catches a winner who is no longer excluded from future draws', () => {
    expect(assessResultIntegrity({ ...whole, excludedWinnerCount: 3 })).toContain('WINNER_EXCLUSION_MISSING')
  })

  it('catches a broken selection order', () => {
    expect(assessResultIntegrity({ ...whole, selectionOrderBounds: { min: 1, max: 7 } })).toContain(
      'SELECTION_ORDER_BROKEN',
    )
  })

  it('reports every problem at once rather than the first', () => {
    const broken = assessResultIntegrity({
      ...whole,
      drawWinnerCount: 2,
      archivedWinnerCount: 2,
      participationRecordCount: 4,
    })
    expect(broken.length).toBeGreaterThan(1)
  })
})

// --- Publication ------------------------------------------------------------

describe('publishing a result', () => {
  it('lets a SUPER_ADMIN publish a completed draw', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { cookie } = await superAdmin()

    const response = await publishVia(communeDraw.id, cookie)

    expect(response.status).toBe(201)
    expect(response.body.alreadyPublished).toBe(false)
    expect(response.body.winnerCount).toBe(1)
    expect(response.body.communeCode).toBe(geo.communeA1.code)
    expect(await prisma.resultPublication.count()).toBe(1)
  })

  it('refuses a WILAYA_ADMIN', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { cookie } = await wilayaAdmin(geo.wilayaA.id)

    const response = await publishVia(communeDraw.id, cookie)

    // 403 rather than 404: the commune is in their territory, so this is a role
    // failure they can act on, not a resource they may not know exists.
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FORBIDDEN_ROLE')
    expect(await prisma.resultPublication.count()).toBe(0)
  })

  it('refuses a COMMUNE_ADMIN, including for their own commune', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    const response = await publishVia(communeDraw.id, cookie)

    expect(response.status).toBe(403)
    expect(await prisma.resultPublication.count()).toBe(0)
  })

  it('refuses an unauthenticated caller', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)

    const response = await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/publish-result`)

    expect(response.status).toBe(401)
    expect(await prisma.resultPublication.count()).toBe(0)
  })

  it('records exactly one audit event, naming the actor and the result', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { user, cookie } = await superAdmin()

    await publishVia(communeDraw.id, cookie)

    const events = await prisma.auditLog.findMany({ where: { action: 'DRAW_RESULT_PUBLISHED' } })
    expect(events).toHaveLength(1)
    const [event] = events
    expect(event?.actorUserId).toBe(user.id)
    expect(event?.targetType).toBe('DRAW_RESULT')
    expect(event?.communeId).toBe(geo.communeA1.id)
    expect(event?.wilayaId).toBe(geo.wilayaA.id)
    // Counts and identifiers only — nothing personal reaches the trail.
    expect(JSON.stringify(event?.metadata)).toContain('winnerCount')
  })

  it('is idempotent: re-publishing writes no second publication and no second event', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { cookie } = await superAdmin()

    const first = await publishVia(communeDraw.id, cookie)
    const second = await publishVia(communeDraw.id, cookie)

    expect(first.status).toBe(201)
    expect(first.body.alreadyPublished).toBe(false)
    expect(second.status).toBe(200)
    expect(second.body.alreadyPublished).toBe(true)
    expect(second.body.publishedAt).toBe(first.body.publishedAt)

    expect(await prisma.resultPublication.count()).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'DRAW_RESULT_PUBLISHED' } })).toBe(1)
  })

  it('produces one publication under concurrent requests', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { cookie } = await superAdmin()

    const responses = await Promise.all([
      publishVia(communeDraw.id, cookie),
      publishVia(communeDraw.id, cookie),
      publishVia(communeDraw.id, cookie),
    ])

    expect(responses.every((response) => response.status === 200 || response.status === 201)).toBe(true)
    expect(await prisma.resultPublication.count()).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'DRAW_RESULT_PUBLISHED' } })).toBe(1)
  })

  it('ignores anything a client tries to dictate about the publication', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { user, cookie } = await superAdmin()

    const response = await publishVia(communeDraw.id, cookie).send({
      winnerCount: 999,
      publishedAt: '1999-01-01T00:00:00.000Z',
      publishedByUserId: 'somebody-else',
      winners: [{ applicationReference: 'HZ-2146-XXX-000000' }],
    })

    expect(response.status).toBe(201)
    expect(response.body.winnerCount).toBe(1)
    const publication = await prisma.resultPublication.findFirstOrThrow()
    expect(publication.winnerCount).toBe(1)
    expect(publication.publishedByUserId).toBe(user.id)
    expect(publication.publishedAt.getUTCFullYear()).toBe(new Date().getUTCFullYear())
  })

  it('refuses a draw that has not been run', async () => {
    const communeDraw = await ensureCommuneDraw(geo.communeA1.id)
    await register(geo.communeA1)
    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
    await drawPoolService.freeze(communeDraw.id)

    const { cookie } = await superAdmin()
    const response = await publishVia(communeDraw.id, cookie)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('RESULT_NOT_PUBLISHABLE')
    expect(response.body.details.issues).toContain('DRAW_NOT_COMPLETED')
    expect(await prisma.resultPublication.count()).toBe(0)
  })

  it('refuses a result whose winners are no longer excluded from future draws', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)

    // The tamper: lifetime exclusion cleared out from under a recorded winner.
    // draw_results, draw_winners and winner_archive are immutable by trigger, so
    // the participants table is where an inconsistency can actually be created —
    // which is exactly the case worth catching before an announcement.
    await prisma.participant.updateMany({ where: { hasWonHajj: true }, data: { hasWonHajj: false } })

    const { cookie } = await superAdmin()
    const response = await publishVia(communeDraw.id, cookie)

    expect(response.status).toBe(409)
    expect(response.body.details.issues).toContain('WINNER_EXCLUSION_MISSING')
    expect(await prisma.resultPublication.count()).toBe(0)
  })

  it('refuses a result whose participation ledger has been emptied', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1, [{}, {}], 1)

    await prisma.participationHistory.deleteMany({
      where: { communeId: geo.communeA1.id, drawYear: YEAR },
    })

    const { cookie } = await superAdmin()
    const response = await publishVia(communeDraw.id, cookie)

    expect(response.status).toBe(409)
    expect(response.body.details.issues).toContain('PARTICIPATION_HISTORY_INCOMPLETE')
  })

  it('repairs nothing when it refuses', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    await prisma.participant.updateMany({ where: { hasWonHajj: true }, data: { hasWonHajj: false } })

    const { cookie } = await superAdmin()
    await publishVia(communeDraw.id, cookie)

    // The inconsistency is still there. Publication reports; it does not fix.
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'DRAW_RESULT_PUBLISHED' } })).toBe(0)
  })

  it('keeps a published result read-only, for everyone', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    await publish(communeDraw.id)
    const publication = await prisma.resultPublication.findFirstOrThrow()

    await expect(
      prisma.resultPublication.update({ where: { id: publication.id }, data: { winnerCount: 99 } }),
    ).rejects.toThrow()

    // And there is no unpublishing, at any layer.
    await expect(prisma.resultPublication.delete({ where: { id: publication.id } })).rejects.toThrow()
    expect(await prisma.resultPublication.count()).toBe(1)
  })

  it('reports publication state on the administrative result view', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    const { cookie } = await superAdmin()

    const before = await request(app)
      .get(`/api/admin/commune-draws/${communeDraw.id}/result`)
      .set('Cookie', cookie)
    expect(before.body.publishedAt).toBeNull()

    await publishVia(communeDraw.id, cookie)

    const after = await request(app)
      .get(`/api/admin/commune-draws/${communeDraw.id}/result`)
      .set('Cookie', cookie)
    expect(typeof after.body.publishedAt).toBe('string')
  })
})

// --- Public results ---------------------------------------------------------

describe('public results', () => {
  it('does not show an unpublished result', async () => {
    await completedDraw(geo.communeA1)

    const listed = await request(app).get('/api/public/results')
    const direct = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )

    expect(listed.status).toBe(200)
    expect(listed.body.items).toHaveLength(0)
    // The same 404 a commune that never drew gets, and a code that does not exist.
    expect(direct.status).toBe(404)
    expect(direct.body.code).toBe('RESULT_NOT_PUBLISHED')
  })

  it('answers identically for a drawn-but-unpublished commune and one that never drew', async () => {
    await completedDraw(geo.communeA1)

    const drawn = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )
    const never = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA2.code}`,
    )
    const fictional = await request(app).get(`/api/public/results/${YEAR}/${geo.wilayaA.code}/99999`)

    expect(drawn.status).toBe(never.status)
    expect(drawn.status).toBe(fictional.status)
    expect(drawn.body).toEqual(never.body)
    expect(drawn.body).toEqual(fictional.body)
  })

  it('shows a published result to anybody, with no authentication at all', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    await publish(communeDraw.id)

    const response = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )

    expect(response.status).toBe(200)
    expect(response.body.drawYear).toBe(YEAR)
    expect(response.body.winnerCount).toBe(1)
    expect(response.body.winners).toHaveLength(1)
    expect(response.body.winners[0].selectionOrder).toBe(1)
    expect(typeof response.body.winners[0].applicationReference).toBe('string')
  })

  it('publishes winners in the persisted selection order, never a fresh draw', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1, [{}, {}, {}, {}], 3)
    await publish(communeDraw.id)

    const stored = await prisma.drawWinner.findMany({
      orderBy: { selectionOrder: 'asc' },
      include: { drawPoolEntry: { select: { applicationReference: true } } },
    })

    const first = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )
    const second = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )

    expect(first.body.winners.map((w: { applicationReference: string }) => w.applicationReference)).toEqual(
      stored.map((winner) => winner.drawPoolEntry.applicationReference),
    )
    // Reading a result is a read. Two requests are the same result.
    expect(second.body).toEqual(first.body)
  })

  it('treats a paired application as one winning entry covering two people', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1, [{ paired: true }], 1)
    await publish(communeDraw.id)

    const response = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )

    expect(response.body.winnerCount).toBe(1)
    expect(response.body.winners).toHaveLength(1)
    expect(response.body.winners[0].entryType).toBe('PAIRED')
    expect(response.body.winners[0].participantCount).toBe(2)
    // Spots count entries; people can exceed them.
    expect(response.body.winningParticipantCount).toBe(2)
  })

  it('publishes no identity, no contact details and no internal identifiers', async () => {
    const { communeDraw, registered } = await completedDraw(geo.communeA1, [{ paired: true }], 1)
    await publish(communeDraw.id)
    const [entry] = registered
    const participants = await prisma.participant.findMany()
    const poolEntries = await prisma.drawPoolEntry.findMany()

    const response = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )

    expectNoSecrets(response.body, [
      entry?.primaryNationalId ?? null,
      entry?.secondaryNationalId ?? null,
      entry?.phoneNumber ?? null,
      '+213555',
      entry?.dob ?? null,
      'Public Subject',
      'Public Partner',
      entry?.application.id ?? null,
      geo.communeA1.id,
      geo.wilayaA.id,
      ...participants.map((participant) => participant.id),
      ...poolEntries.map((poolEntry) => poolEntry.id),
    ])
    // And no priority information: a weight is how long a household waited, so
    // publishing one would publish that. The algorithm's *name* stays — it is
    // how the result identifies the implementation that produced it.
    const serialized = JSON.stringify(response.body)
    for (const field of ['"weight"', 'selectedWeight', 'totalWeight', 'calculatedWeight']) {
      expect(serialized).not.toContain(field)
    }
    expect(Object.keys(response.body.winners[0]).sort()).toEqual([
      'applicationReference',
      'entryType',
      'participantCount',
      'selectionOrder',
    ])
  })

  it('carries all three locales so the client renders the active language', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    await publish(communeDraw.id)

    const response = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )

    for (const place of [response.body.commune, response.body.wilaya]) {
      expect(place).toEqual({
        code: expect.any(String),
        nameAr: expect.any(String),
        nameFr: expect.any(String),
        nameEn: expect.any(String),
      })
      // The identifier a citizen has, not the one the database has.
      expect(place.id).toBeUndefined()
    }
  })

  it('filters by draw year, wilaya and commune', async () => {
    const drawn = await completedDraws([
      { commune: geo.communeA1 },
      { commune: geo.communeA2 },
      { commune: geo.communeB1 },
    ])
    for (const one of drawn) await publish(one.communeDraw.id)

    const all = await request(app).get('/api/public/results')
    const byWilaya = await request(app).get(`/api/public/results?wilayaCode=${geo.wilayaA.code}`)
    const byCommune = await request(app).get(`/api/public/results?communeCode=${geo.communeB1.code}`)
    const byYear = await request(app).get(`/api/public/results?drawYear=${YEAR + 5}`)

    expect(all.body.total).toBe(3)
    expect(byWilaya.body.total).toBe(2)
    expect(byCommune.body.total).toBe(1)
    expect(byCommune.body.items[0].commune.code).toBe(geo.communeB1.code)
    expect(byYear.body.total).toBe(0)
  })

  it('paginates, and caps the page size the caller asks for', async () => {
    const drawn = await completedDraws([
      { commune: geo.communeA1 },
      { commune: geo.communeA2 },
      { commune: geo.communeB1 },
    ])
    for (const one of drawn) await publish(one.communeDraw.id)

    const first = await request(app).get('/api/public/results?page=1&pageSize=2')
    const second = await request(app).get('/api/public/results?page=2&pageSize=2')
    const greedy = await request(app).get('/api/public/results?pageSize=10000000')

    expect(first.body.items).toHaveLength(2)
    expect(first.body.total).toBe(3)
    expect(first.body.totalPages).toBe(2)
    expect(second.body.items).toHaveLength(1)
    // No overlap and no gap: the order is total, so paging cannot repeat a row.
    const seen = [...first.body.items, ...second.body.items].map(
      (item: { commune: { code: string } }) => item.commune.code,
    )
    expect(new Set(seen).size).toBe(3)

    // Clamped, not honoured, and not an error.
    expect(greedy.status).toBe(200)
    expect(greedy.body.pageSize).toBe(100)
    expect(greedy.body.items.length).toBeLessThanOrEqual(100)
  })

  it('serves published results from a shared cache, and failures from none', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    await publish(communeDraw.id)

    const published = await request(app).get(
      `/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`,
    )
    const listing = await request(app).get('/api/public/results')
    const missing = await request(app).get(`/api/public/results/${YEAR}/${geo.wilayaA.code}/99999`)

    expect(published.headers['cache-control']).toContain('public')
    expect(published.headers['cache-control']).toContain('s-maxage=')
    expect(listing.headers['cache-control']).toContain('public')
    // A 404 must not be cached as "nothing here" past the announcement.
    expect(missing.headers['cache-control']).toBe('no-store')

    // Revalidation works, so a spike costs bandwidth once.
    expect(published.headers.etag).toBeTruthy()
    const revalidated = await request(app)
      .get(`/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`)
      .set('If-None-Match', published.headers.etag as string)
    expect(revalidated.status).toBe(304)
  })
})

// --- Public draw status -----------------------------------------------------

describe('public draw status', () => {
  it('is visible without authentication', async () => {
    await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 12,
    })

    const response = await request(app).get('/api/public/draw-status')

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0]).toMatchObject({
      drawYear: YEAR,
      registrationOpen: true,
      allocatedSpots: 12,
      phase: 'ACCEPTING',
      resultsPublished: false,
      winnerCount: null,
    })
  })

  it('reports the phase as the draw progresses', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)

    const drawn = await request(app).get('/api/public/draw-status')
    expect(drawn.body.items[0].phase).toBe('DRAWN')
    expect(drawn.body.items[0].resultsPublished).toBe(false)
    // Null rather than zero: "nobody won" and "you may not know yet" are
    // different answers and must not be confused.
    expect(drawn.body.items[0].winnerCount).toBeNull()

    await publish(communeDraw.id)

    const published = await request(app).get('/api/public/draw-status')
    expect(published.body.items[0].resultsPublished).toBe(true)
    expect(published.body.items[0].winnerCount).toBe(1)
  })

  it('leaks nothing about an unpublished result or the pool behind it', async () => {
    const { registered } = await completedDraw(geo.communeA1, [{}, {}, {}], 2)
    const pool = await prisma.drawPool.findFirstOrThrow()
    const winners = await prisma.drawWinner.findMany({
      include: { drawPoolEntry: { select: { applicationReference: true } } },
    })

    const response = await request(app).get('/api/public/draw-status')
    const serialized = JSON.stringify(response.body)

    // No winner, no reference, no fingerprint, no weight, no applicant count.
    for (const winner of winners) {
      expect(serialized).not.toContain(winner.drawPoolEntry.applicationReference)
    }
    expect(serialized).not.toContain(pool.snapshotHash)
    expect(serialized).not.toContain('totalWeight')
    expect(serialized).not.toContain('entryCount')
    expectNoSecrets(response.body, [
      registered[0]?.primaryNationalId ?? null,
      registered[0]?.phoneNumber ?? null,
      registered[0]?.application.id ?? null,
    ])
  })

  it('filters by wilaya and by commune', async () => {
    for (const commune of [geo.communeA1, geo.communeA2, geo.communeB1]) {
      await drawConfigurationService.createCommuneDraw({
        drawYearId: drawYear.id,
        communeId: commune.id,
        allocatedSpots: 5,
      })
    }

    const all = await request(app).get('/api/public/draw-status')
    const byWilaya = await request(app).get(`/api/public/draw-status?wilayaCode=${geo.wilayaA.code}`)
    const byCommune = await request(app).get(`/api/public/draw-status?communeCode=${geo.communeB1.code}`)

    expect(all.body.total).toBe(3)
    expect(byWilaya.body.total).toBe(2)
    expect(byCommune.body.total).toBe(1)
    expect(byCommune.body.items[0].wilaya.code).toBe(geo.wilayaB.code)
  })

  it('is bounded and cache-friendly', async () => {
    const communes = await manyCommunes(30)
    for (const commune of communes) {
      await drawConfigurationService.createCommuneDraw({
        drawYearId: drawYear.id,
        communeId: commune.id,
        allocatedSpots: 3,
      })
    }

    const greedy = await request(app).get('/api/public/draw-status?pageSize=999999')

    expect(greedy.body.total).toBe(30)
    expect(greedy.body.pageSize).toBe(100)
    expect(greedy.body.items).toHaveLength(30)
    expect(greedy.headers['cache-control']).toContain('public')
  })

  it('returns the default page size when none is asked for', async () => {
    const communes = await manyCommunes(30)
    for (const commune of communes) {
      await drawConfigurationService.createCommuneDraw({
        drawYearId: drawYear.id,
        communeId: commune.id,
        allocatedSpots: 3,
      })
    }

    const response = await request(app).get('/api/public/draw-status')

    // The whole table is never returned, even when nobody asks for a page.
    expect(response.body.pageSize).toBe(25)
    expect(response.body.items).toHaveLength(25)
    expect(response.body.total).toBe(30)
    expect(response.body.totalPages).toBe(2)
  })
})

/**
 * Extra fixture communes, upserted so they are idempotent across runs.
 *
 * Codes well outside Algeria's real range, like the shared geography helper —
 * the suite never truncates the geographic tables.
 */
async function manyCommunes(count: number): Promise<Commune[]> {
  const communes: Commune[] = []
  for (let index = 0; index < count; index += 1) {
    const code = `9031${String(index).padStart(2, '0')}`
    communes.push(
      await prisma.commune.upsert({
        where: { wilayaId_code: { wilayaId: geo.wilayaA.id, code } },
        update: {},
        create: {
          wilayaId: geo.wilayaA.id,
          code,
          nameAr: `Bulk ${code}`,
          nameFr: `Bulk ${code}`,
          nameEn: `Bulk ${code}`,
        },
      }),
    )
  }
  return communes
}

// --- Application status lookup ----------------------------------------------

describe('checking your own application', () => {
  it('returns the application to somebody with the reference and the number', async () => {
    const registered = await register(geo.communeA1)

    const response = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: registered.phoneNumber,
    })

    expect(response.status).toBe(200)
    expect(response.body.applicationReference).toBe(registered.application.applicationReference)
    expect(response.body.drawYear).toBe(YEAR)
    expect(response.body.commune.code).toBe(geo.communeA1.code)
    expect(response.body.status).toBe('IN_DRAW')
    expect(response.body.applicantCount).toBe(1)
  })

  it('accepts the number however the citizen writes it', async () => {
    const registered = await register(geo.communeA1)
    const national = registered.phoneNumber
    const digits = national.slice(1)

    for (const written of [
      national,
      `+213${digits}`,
      `00213${digits}`,
      `${national.slice(0, 4)} ${national.slice(4, 6)} ${national.slice(6, 8)} ${national.slice(8)}`,
      national.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3-$4'),
    ]) {
      const response = await lookup({
        applicationReference: registered.application.applicationReference,
        phoneNumber: written,
      })
      expect(response.status, `rejected "${written}"`).toBe(200)
    }
  })

  it('accepts the reference however the citizen writes it', async () => {
    const registered = await register(geo.communeA1)
    const reference = registered.application.applicationReference

    for (const written of [
      reference,
      reference.toLowerCase(),
      ` ${reference} `,
      reference.replace(/-/g, '—'),
    ]) {
      const response = await lookup({ applicationReference: written, phoneNumber: registered.phoneNumber })
      expect(response.status, `rejected "${written}"`).toBe(200)
    }
  })

  it('tells a wrong number and an unknown reference exactly the same thing', async () => {
    const registered = await register(geo.communeA1)

    const wrongNumber = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: '0555999999',
    })
    const unknownReference = await lookup({
      applicationReference: 'HZ-2146-ZZZ-000000',
      phoneNumber: registered.phoneNumber,
    })
    const malformedReference = await lookup({
      applicationReference: 'not-a-reference',
      phoneNumber: registered.phoneNumber,
    })

    // Byte-identical, not merely similar. Any difference here — status, code,
    // message, shape — is a bit an attacker can use to map who applied.
    expect(wrongNumber.status).toBe(404)
    expect(unknownReference.status).toBe(wrongNumber.status)
    expect(malformedReference.status).toBe(wrongNumber.status)
    expect(unknownReference.body).toEqual(wrongNumber.body)
    expect(malformedReference.body).toEqual(wrongNumber.body)
    expect(unknownReference.text).toBe(wrongNumber.text)
    expect(malformedReference.text).toBe(wrongNumber.text)
  })

  it('refuses an applicant who registered without a number, without saying so', async () => {
    const registered = await register(geo.communeA1, { withoutPhone: true })

    const response = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: registered.phoneNumber,
    })
    const unknown = await lookup({
      applicationReference: 'HZ-2146-ZZZ-000000',
      phoneNumber: registered.phoneNumber,
    })

    expect(response.status).toBe(404)
    expect(response.body).toEqual(unknown.body)
  })

  it('never returns a national ID, a phone number, a date of birth or an internal id', async () => {
    const registered = await register(geo.communeA1, { paired: true })
    const participants = await prisma.participant.findMany()

    const response = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: registered.phoneNumber,
    })

    expect(response.status).toBe(200)
    expectNoSecrets(response.body, [
      registered.primaryNationalId,
      registered.secondaryNationalId,
      registered.phoneNumber,
      '+213',
      registered.dob,
      'Public Subject',
      'Public Partner',
      registered.application.id,
      geo.communeA1.id,
      geo.wilayaA.id,
      ...participants.map((participant) => participant.id),
    ])
    expect(Object.keys(response.body).sort()).toEqual([
      'applicantCount',
      'applicationReference',
      'commune',
      'drawPhase',
      'drawYear',
      'entryType',
      'resultsPublished',
      'status',
      'submittedAt',
      'wilaya',
    ])
  })

  it('never returns participation history, a streak or a weight', async () => {
    const registered = await register(geo.communeA1)
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: registered.application.id },
    })
    expect(application.calculatedWeight).not.toBeNull()

    const response = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: registered.phoneNumber,
    })

    const serialized = JSON.stringify(response.body)
    for (const forbidden of ['weight', 'streak', 'history', 'consecutive', 'priority', 'participated']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('withholds the outcome of a concluded draw until it is published', async () => {
    const { communeDraw, registered } = await completedDraw(geo.communeA1, [{}, {}], 1)

    const selected = await prisma.application.findFirstOrThrow({ where: { status: 'SELECTED' } })
    const notSelected = await prisma.application.findFirstOrThrow({ where: { status: 'NOT_SELECTED' } })
    const numbers = new Map(
      registered.map((entry) => [entry.application.applicationReference, entry.phoneNumber]),
    )

    const winner = await lookup({
      applicationReference: selected.applicationReference,
      phoneNumber: numbers.get(selected.applicationReference) ?? '',
    })
    const loser = await lookup({
      applicationReference: notSelected.applicationReference,
      phoneNumber: numbers.get(notSelected.applicationReference) ?? '',
    })

    // Identical, so polling one's own reference cannot front-run the
    // announcement — nor can comparing two applicants' answers.
    expect(winner.body.status).toBe('AWAITING_RESULTS')
    expect(loser.body.status).toBe('AWAITING_RESULTS')
    expect(winner.body.resultsPublished).toBe(false)
    expect(winner.body.drawPhase).toBe('DRAWN')

    await publish(communeDraw.id)

    const winnerAfter = await lookup({
      applicationReference: selected.applicationReference,
      phoneNumber: numbers.get(selected.applicationReference) ?? '',
    })
    const loserAfter = await lookup({
      applicationReference: notSelected.applicationReference,
      phoneNumber: numbers.get(notSelected.applicationReference) ?? '',
    })

    expect(winnerAfter.body.status).toBe('SELECTED')
    expect(loserAfter.body.status).toBe('NOT_SELECTED')
    expect(winnerAfter.body.resultsPublished).toBe(true)
  })

  it('is never stored in a shared cache', async () => {
    const registered = await register(geo.communeA1)

    const found = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: registered.phoneNumber,
    })
    const failed = await lookup({
      applicationReference: 'HZ-2146-ZZZ-000000',
      phoneNumber: registered.phoneNumber,
    })

    expect(found.headers['cache-control']).toBe('no-store')
    expect(failed.headers['cache-control']).toBe('no-store')
  })

  it('bounds repeated failures against one reference', async () => {
    const registered = await register(geo.communeA1)
    const attempt = () =>
      lookup({
        applicationReference: registered.application.applicationReference,
        phoneNumber: '0555999999',
      })

    let refused = false
    for (let index = 0; index < 12; index += 1) {
      const response = await attempt()
      if (response.status === 429) {
        refused = true
        expect(response.body.code).toBe('TOO_MANY_ATTEMPTS')
        // Says nothing about how much budget is left, or which limit was hit.
        expect(response.headers['ratelimit']).toBeUndefined()
        expect(response.headers['ratelimit-remaining']).toBeUndefined()
        break
      }
    }
    expect(refused).toBe(true)
  })

  it('bounds failures against an unknown reference too, so refusal reveals nothing', async () => {
    // If only real references were counted, a 429 would itself confirm one.
    let refused = false
    for (let index = 0; index < 12; index += 1) {
      const response = await lookup({
        applicationReference: 'HZ-2146-ZZZ-111111',
        phoneNumber: '0555999999',
      })
      if (response.status === 429) {
        refused = true
        break
      }
    }
    expect(refused).toBe(true)
  })

  it('does not charge a citizen for checking their own application', async () => {
    const registered = await register(geo.communeA1)

    for (let index = 0; index < 20; index += 1) {
      const response = await lookup({
        applicationReference: registered.application.applicationReference,
        phoneNumber: registered.phoneNumber,
      })
      expect(response.status).toBe(200)
    }

    // Twenty successes have consumed nothing, so a genuine mistake afterwards
    // still gets the ordinary answer rather than a lockout.
    const mistyped = await lookup({
      applicationReference: registered.application.applicationReference,
      phoneNumber: '0555999999',
    })
    expect(mistyped.status).toBe(404)
  })
})

// --- Enumeration and the shape of the public surface ------------------------

describe('the public API is not an enumeration oracle', () => {
  it('offers no way to ask about a participant', async () => {
    const registered = await register(geo.communeA1)
    const participant = await prisma.participant.findFirstOrThrow()

    const byId = await request(app).get(`/api/public/participants/${participant.id}`)
    const byNationalId = await request(app).get(
      `/api/public/participants/by-national-id/${registered.primaryNationalId}`,
    )

    expect(byId.status).toBe(404)
    expect(byId.body.code).toBe('ROUTE_NOT_FOUND')
    expect(byNationalId.status).toBe(404)
    expect(byNationalId.body.code).toBe('ROUTE_NOT_FOUND')
  })

  it('keeps the existing participant registry behind a SUPER_ADMIN session', async () => {
    const participant = await prisma.participant.findFirst()
    expect(participant).toBeNull()

    const response = await request(app).get('/api/participants/anything')

    expect(response.status).toBe(401)
  })

  it('offers no way to ask about an application by id', async () => {
    const registered = await register(geo.communeA1)

    const byId = await request(app).get(`/api/public/applications/${registered.application.id}`)
    const listed = await request(app).get('/api/public/applications')

    expect(byId.status).toBe(404)
    expect(byId.body.code).toBe('ROUTE_NOT_FOUND')
    expect(listed.status).toBe(404)
    expect(listed.body.code).toBe('ROUTE_NOT_FOUND')
  })

  it('refuses a lookup that tries to name a participant instead of proving one', async () => {
    const registered = await register(geo.communeA1)

    for (const body of [
      { nationalId: registered.primaryNationalId },
      { participantId: 'anything' },
      {
        applicationReference: registered.application.applicationReference,
        phoneNumber: registered.phoneNumber,
        nationalId: registered.primaryNationalId,
      },
      { applicationId: registered.application.id, phoneNumber: registered.phoneNumber },
    ]) {
      const response = await lookup(body)
      // `.strict()` — an unexpected field is refused, never quietly ignored.
      expect(response.status).toBe(400)
      expect(response.body.code).toBe('VALIDATION_FAILED')
    }
  })

  it('cannot be walked by guessing references', async () => {
    await register(geo.communeA1)

    // The reference space is 32^6 per commune-year and non-sequential, and the
    // per-reference limiter bounds the search regardless. What matters here is
    // that a near miss is not a different answer from a wild one.
    const near = await lookup({ applicationReference: 'HZ-2146-TES-AAAAAA', phoneNumber: '0555000001' })
    const wild = await lookup({ applicationReference: 'HZ-2999-QQQ-999999', phoneNumber: '0555000001' })

    expect(near.status).toBe(wild.status)
    expect(near.text).toBe(wild.text)
  })

  it('exposes no audit trail, pool or admin data publicly', async () => {
    const { communeDraw } = await completedDraw(geo.communeA1)
    await publish(communeDraw.id)

    for (const path of [
      '/api/public/audit-logs',
      '/api/public/pool',
      `/api/public/commune-draws/${communeDraw.id}/pool`,
      '/api/public/admins',
    ]) {
      const response = await request(app).get(path)
      expect(response.status).toBe(404)
      expect(response.body.code).toBe('ROUTE_NOT_FOUND')
    }

    // And the admin surface still requires a session.
    const admin = await request(app).get(`/api/admin/commune-draws/${communeDraw.id}/result`)
    expect(admin.status).toBe(401)
  })
})

describe('reference normalization', () => {
  it('folds case, spacing and dash style without substituting characters', () => {
    expect(normalizeApplicationReference(' hz-2027-mes-8f42k1 ')).toBe('HZ-2027-MES-8F42K1')
    expect(normalizeApplicationReference('HZ 2027 MES 8F42K1')).toBe('HZ2027MES8F42K1')
    expect(normalizeApplicationReference('HZ—2027—MES—8F42K1')).toBe('HZ-2027-MES-8F42K1')
    // O and I are not in the alphabet, so guessing at them would be inventing
    // an input the citizen did not give.
    expect(normalizeApplicationReference('HZ-2027-MES-8F42KO')).toBe('HZ-2027-MES-8F42KO')
  })
})
