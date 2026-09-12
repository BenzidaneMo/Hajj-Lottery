import { PrismaClient } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { evaluateEligibility, type EligibilitySubject } from '../src/lib/eligibility-rules.js'
import { eligibilityService } from '../src/services/eligibility.service.js'
import {
  AdminRole,
  createAdminAndSignIn,
  ensureOpenDrawYear,
  ensureTestGeography,
  type TestGeography,
} from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
const DRAW_YEAR = new Date().getUTCFullYear()

const NATIONAL_IDS = {
  ahmed: '811111111111111111',
  fatima: '822222222222222222',
  karim: '833333333333333333',
  leila: '844444444444444444',
}

function applicant(nationalId: string, overrides: Record<string, unknown> = {}) {
  return { nationalId, fullName: 'Test Applicant', dob: '1985-04-12', gender: 'MALE', ...overrides }
}

function singleBody(overrides: Record<string, unknown> = {}) {
  return {
    entryType: 'SINGLE',
    wilayaId: geo.wilayaA.id,
    communeId: geo.communeA1.id,
    primary: applicant(NATIONAL_IDS.ahmed),
    ...overrides,
  }
}

function pairedBody(overrides: Record<string, unknown> = {}) {
  return {
    entryType: 'PAIRED',
    wilayaId: geo.wilayaA.id,
    communeId: geo.communeA1.id,
    primary: applicant(NATIONAL_IDS.ahmed, { gender: 'FEMALE' }),
    secondary: applicant(NATIONAL_IDS.fatima, { fullName: 'Second Applicant', gender: 'MALE' }),
    ...overrides,
  }
}

const submit = (body: Record<string, unknown>) => request(app).post('/api/applications').send(body)

/** The eligibility view of an application, as an administrator sees it. */
const inspect = (id: string, cookie: string) =>
  request(app).get(`/api/admin/applications/${id}/eligibility`).set('Cookie', cookie)

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
  await ensureOpenDrawYear(prisma, geo)
  await prisma.applicationParticipant.deleteMany()
  await prisma.application.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * A subject that passes every rule. Each test below breaks exactly one thing,
 * so a failure names the rule that changed rather than the fixture.
 */
function eligibleSubject(overrides: Partial<EligibilitySubject> = {}): EligibilitySubject {
  return {
    applicationId: null,
    drawYear: DRAW_YEAR,
    expectedDrawYear: DRAW_YEAR,
    entryType: 'SINGLE',
    commune: { id: 'commune-1', wilayaId: 'wilaya-1', isActive: true, wilayaIsActive: true },
    claimedWilayaId: 'wilaya-1',
    primary: { participantId: 'p-1', hasWonHajj: false, applicationIdsThisYear: [] },
    secondary: null,
    ...overrides,
  }
}

const PAIR = {
  primary: { participantId: 'p-1', hasWonHajj: false, applicationIdsThisYear: [] },
  secondary: { participantId: 'p-2', hasWonHajj: false, applicationIdsThisYear: [] },
}

describe('the rules, in isolation', () => {
  it('accepts a well-formed single application', () => {
    const result = evaluateEligibility(eligibleSubject())

    expect(result).toEqual({ eligible: true, status: 'ELIGIBLE', reasons: [] })
  })

  it('accepts a well-formed paired application', () => {
    const result = evaluateEligibility(eligibleSubject({ entryType: 'PAIRED', ...PAIR }))

    expect(result.eligible).toBe(true)
    expect(result.reasons).toEqual([])
  })

  it('refuses a single application carrying a second applicant', () => {
    const result = evaluateEligibility(eligibleSubject({ entryType: 'SINGLE', ...PAIR }))

    expect(result.eligible).toBe(false)
    expect(result.reasons).toContain('ENTRY_TYPE_MISMATCH')
  })

  it('refuses a paired application with no second applicant', () => {
    const result = evaluateEligibility(eligibleSubject({ entryType: 'PAIRED', secondary: null }))

    expect(result.reasons).toContain('APPLICATION_INCOMPLETE')
    expect(result.reasons).toContain('SECONDARY_PARTICIPANT_NOT_FOUND')
  })

  it('refuses an application whose primary applicant is unknown', () => {
    const result = evaluateEligibility(eligibleSubject({ primary: null }))

    expect(result.reasons).toEqual(['PARTICIPANT_NOT_FOUND'])
    expect(result.status).toBe('INELIGIBLE')
  })

  it('refuses a pair of the same person', () => {
    const result = evaluateEligibility(
      eligibleSubject({
        entryType: 'PAIRED',
        primary: PAIR.primary,
        secondary: { ...PAIR.primary },
      }),
    )

    expect(result.reasons).toContain('DUPLICATE_APPLICANTS')
  })

  it('refuses a past winner in either slot', () => {
    const asPrimary = evaluateEligibility(eligibleSubject({ primary: { ...PAIR.primary, hasWonHajj: true } }))
    const asSecondary = evaluateEligibility(
      eligibleSubject({
        entryType: 'PAIRED',
        primary: PAIR.primary,
        secondary: { ...PAIR.secondary, hasWonHajj: true },
      }),
    )

    expect(asPrimary.reasons).toEqual(['PARTICIPANT_HAS_ALREADY_WON'])
    expect(asSecondary.reasons).toEqual(['SECONDARY_PARTICIPANT_HAS_ALREADY_WON'])
  })

  it('refuses someone who already occupies another application this year', () => {
    const result = evaluateEligibility(
      eligibleSubject({
        primary: { ...PAIR.primary, applicationIdsThisYear: ['other-application'] },
      }),
    )

    expect(result.reasons).toEqual(['DUPLICATE_ANNUAL_APPLICATION'])
  })

  it('does not count the application being evaluated as its own duplicate', () => {
    const result = evaluateEligibility(
      eligibleSubject({
        applicationId: 'app-1',
        primary: { ...PAIR.primary, applicationIdsThisYear: ['app-1'] },
      }),
    )

    expect(result.eligible).toBe(true)
  })

  it('refuses a second applicant who is registered elsewhere this year', () => {
    const result = evaluateEligibility(
      eligibleSubject({
        entryType: 'PAIRED',
        primary: PAIR.primary,
        secondary: { ...PAIR.secondary, applicationIdsThisYear: ['other-application'] },
      }),
    )

    expect(result.reasons).toEqual(['SECONDARY_ALREADY_REGISTERED'])
  })

  it('refuses a commune that is missing, inactive, or in another wilaya', () => {
    const missing = evaluateEligibility(eligibleSubject({ commune: null }))
    const inactive = evaluateEligibility(
      eligibleSubject({
        commune: { id: 'c', wilayaId: 'wilaya-1', isActive: false, wilayaIsActive: true },
      }),
    )
    const inactiveWilaya = evaluateEligibility(
      eligibleSubject({
        commune: { id: 'c', wilayaId: 'wilaya-1', isActive: true, wilayaIsActive: false },
      }),
    )
    const elsewhere = evaluateEligibility(eligibleSubject({ claimedWilayaId: 'wilaya-2' }))

    for (const result of [missing, inactive, inactiveWilaya, elsewhere]) {
      expect(result.reasons).toEqual(['INVALID_COMMUNE'])
    }
  })

  it('refuses an implausible draw year', () => {
    for (const drawYear of [0, 1999, 2201, 1.5]) {
      const result = evaluateEligibility(eligibleSubject({ drawYear, expectedDrawYear: drawYear }))
      expect(result.reasons).toEqual(['DRAW_YEAR_INVALID'])
    }
  })

  it('refuses a year that is not the one being registered', () => {
    const result = evaluateEligibility(
      eligibleSubject({ drawYear: DRAW_YEAR + 1, expectedDrawYear: DRAW_YEAR }),
    )

    expect(result.reasons).toEqual(['DRAW_YEAR_INVALID'])
  })

  it('does not judge a stored application against the current year', () => {
    // A 2027 application is not retroactively invalid in 2028. Its year is a
    // fact of the record, so re-evaluation passes no expectation.
    const result = evaluateEligibility(
      eligibleSubject({ applicationId: 'app-1', drawYear: 2027, expectedDrawYear: null }),
    )

    expect(result.eligible).toBe(true)
  })

  it('reports every broken rule at once, in a fixed order', () => {
    const subject = eligibleSubject({
      entryType: 'PAIRED',
      commune: null,
      primary: { participantId: 'p-1', hasWonHajj: true, applicationIdsThisYear: ['other'] },
      secondary: null,
    })

    const first = evaluateEligibility(subject)
    const second = evaluateEligibility(subject)

    expect(first.reasons).toEqual([
      'APPLICATION_INCOMPLETE',
      'SECONDARY_PARTICIPANT_NOT_FOUND',
      'INVALID_COMMUNE',
      'PARTICIPANT_HAS_ALREADY_WON',
      'DUPLICATE_ANNUAL_APPLICATION',
    ])
    // Deterministic: same input, byte-identical verdict.
    expect(second).toEqual(first)
  })
})

describe('evaluating a stored application', () => {
  it('finds a registered application eligible, repeatedly', async () => {
    await submit(singleBody())
    const application = await prisma.application.findFirstOrThrow()

    const first = await eligibilityService.evaluateApplication(application.id)
    const second = await eligibilityService.evaluateApplication(application.id)

    expect(first).toEqual({ eligible: true, status: 'ELIGIBLE', reasons: [] })
    expect(second).toEqual(first)
  })

  it('does not treat an application as its own duplicate', async () => {
    await submit(pairedBody())
    const application = await prisma.application.findFirstOrThrow()

    // Both participants have a participation row for this very application.
    expect(await prisma.applicationParticipant.count()).toBe(2)
    expect((await eligibilityService.evaluateApplication(application.id))?.eligible).toBe(true)
  })

  it('turns ineligible when a participant is later recorded as a winner', async () => {
    await submit(pairedBody())
    const application = await prisma.application.findFirstOrThrow()

    await prisma.participant.update({
      where: { nationalId: NATIONAL_IDS.fatima },
      data: { hasWonHajj: true },
    })

    const result = await eligibilityService.evaluateApplication(application.id)

    expect(result?.eligible).toBe(false)
    expect(result?.reasons).toEqual(['SECONDARY_PARTICIPANT_HAS_ALREADY_WON'])
  })

  it('returns null for an application that does not exist', async () => {
    expect(await eligibilityService.evaluateApplication('no-such-application')).toBeNull()
  })

  it('changes nothing by evaluating', async () => {
    await submit(singleBody())
    const before = await prisma.application.findFirstOrThrow()
    const participantBefore = await prisma.participant.findUniqueOrThrow({
      where: { nationalId: NATIONAL_IDS.ahmed },
    })

    await eligibilityService.evaluateApplication(before.id)

    expect(await prisma.application.findFirstOrThrow()).toEqual(before)
    expect(await prisma.participant.findUniqueOrThrow({ where: { nationalId: NATIONAL_IDS.ahmed } })).toEqual(
      participantBefore,
    )
  })

  it('persists a verdict only when asked to', async () => {
    await submit(singleBody())
    const application = await prisma.application.findFirstOrThrow()

    await eligibilityService.applyEligibilityResult(application.id, {
      eligible: false,
      status: 'INELIGIBLE',
      reasons: ['PARTICIPANT_HAS_ALREADY_WON'],
    })

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: application.id } })
    expect(stored.status).toBe('INELIGIBLE')
    // The verdict is a status, not a copy of the reasoning: nothing else moved.
    expect(stored.calculatedWeight).toBeNull()
    expect(stored.applicationReference).toBe(application.applicationReference)
  })
})

describe('registration applies the same rules', () => {
  it('stores the verdict as the application status', async () => {
    const response = await submit(singleBody())

    expect(response.status).toBe(201)
    expect(response.body.status).toBe('ELIGIBLE')
    expect((await prisma.application.findFirstOrThrow()).status).toBe('ELIGIBLE')
  })

  it('never stores an unevaluated application', async () => {
    await submit(singleBody())
    await submit(singleBody({ primary: applicant(NATIONAL_IDS.karim) }))

    const pending = await prisma.application.count({ where: { status: 'PENDING' } })
    expect(pending).toBe(0)
  })

  it('refuses to create anything for an ineligible applicant', async () => {
    await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.ahmed,
        fullName: 'Past Winner',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        hasWonHajj: true,
      },
    })

    const response = await submit(singleBody())

    expect(response.status).toBe(422)
    expect(await prisma.application.count()).toBe(0)
  })

  it('tells the citizen a code it can translate, never the internal reason', async () => {
    await prisma.participant.create({
      data: {
        nationalId: NATIONAL_IDS.fatima,
        fullName: 'Past Winner',
        dob: new Date('1970-01-01T00:00:00.000Z'),
        hasWonHajj: true,
      },
    })

    const response = await submit(pairedBody())
    const body = JSON.stringify(response.body)

    expect(response.body.code).toBe('APPLICANT_NOT_ELIGIBLE')
    for (const internal of [
      'SECONDARY_PARTICIPANT_HAS_ALREADY_WON',
      'DUPLICATE_ANNUAL_APPLICATION',
      'hasWonHajj',
      'reasons',
    ]) {
      expect(body).not.toContain(internal)
    }
  })

  it('rejects a status supplied by the client rather than honouring it', async () => {
    const response = await submit({ ...singleBody(), status: 'ELIGIBLE' })

    expect(response.status).toBe(400)
    expect(await prisma.application.count()).toBe(0)
  })

  it('keeps the database constraint authoritative under concurrency', async () => {
    // The eligibility read cannot see an uncommitted sibling transaction, so
    // both submissions may believe they are fine. Exactly one still wins.
    const results = await Promise.all([submit(singleBody()), submit(singleBody())])

    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(1)
    expect(await prisma.application.count()).toBe(1)
  })
})

describe('administrative review', () => {
  async function registeredApplication() {
    await submit(singleBody())
    return prisma.application.findFirstOrThrow()
  }

  it('lets a SUPER_ADMIN inspect any application', async () => {
    const application = await registeredApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await inspect(application.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      applicationReference: application.applicationReference,
      drawYear: DRAW_YEAR,
      entryType: 'SINGLE',
      storedStatus: 'ELIGIBLE',
      evaluation: { eligible: true, status: 'ELIGIBLE', reasons: [] },
    })
    expect(response.body.commune.code).toBe(geo.communeA1.code)
  })

  it('shows an administrator the reason codes', async () => {
    const application = await registeredApplication()
    await prisma.participant.update({
      where: { nationalId: NATIONAL_IDS.ahmed },
      data: { hasWonHajj: true },
    })
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await inspect(application.id, cookie)

    expect(response.body.evaluation).toEqual({
      eligible: false,
      status: 'INELIGIBLE',
      reasons: ['PARTICIPANT_HAS_ALREADY_WON'],
    })
    // The stored status still reflects the last decision that was written.
    expect(response.body.storedStatus).toBe('ELIGIBLE')
  })

  it('exposes no participant identity', async () => {
    await submit(
      pairedBody({ primary: applicant(NATIONAL_IDS.ahmed, { phoneNumber: '0555123456', gender: 'FEMALE' }) }),
    )
    const application = await prisma.application.findFirstOrThrow()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await inspect(application.id, cookie)
    const body = JSON.stringify(response.body)

    for (const forbidden of [
      NATIONAL_IDS.ahmed,
      NATIONAL_IDS.fatima,
      'Test Applicant',
      '+213555123456',
      application.id,
      application.primaryParticipantId,
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('lets a WILAYA_ADMIN inspect their own wilaya', async () => {
    const application = await registeredApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    expect((await inspect(application.id, cookie)).status).toBe(200)
  })

  it('hides another wilaya’s application from a WILAYA_ADMIN', async () => {
    const application = await registeredApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaB.id,
    })

    const response = await inspect(application.id, cookie)
    const missing = await inspect('no-such-application', cookie)

    expect(response.status).toBe(404)
    // Byte-identical to an id that was never issued: existence is not probeable.
    expect(response.body).toEqual(missing.body)
  })

  it('lets a COMMUNE_ADMIN inspect only their own commune', async () => {
    const application = await registeredApplication()

    const own = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })
    const neighbour = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA2.id,
    })

    expect((await inspect(application.id, own.cookie)).status).toBe(200)

    const refused = await inspect(application.id, neighbour.cookie)
    const missing = await inspect('no-such-application', neighbour.cookie)
    expect(refused.status).toBe(404)
    expect(refused.body).toEqual(missing.body)
  })

  it('refuses an unauthenticated caller', async () => {
    const application = await registeredApplication()

    const response = await request(app).get(`/api/admin/applications/${application.id}/eligibility`)

    expect(response.status).toBe(401)
  })

  it('cannot be widened by a query parameter', async () => {
    const application = await registeredApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaB.id,
    })

    const response = await request(app)
      .get(`/api/admin/applications/${application.id}/eligibility`)
      .query({ wilayaId: geo.wilayaA.id, communeId: geo.communeA1.id })
      .set('Cookie', cookie)

    expect(response.status).toBe(404)
  })
})
