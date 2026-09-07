import { PrismaClient, type Application, type Participant } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { combineWeights, individualWeight, MAX_APPLICATION_WEIGHT } from '../src/lib/weight-rules.js'
import { participationHistoryService } from '../src/services/participation-history.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography

const CURRENT_YEAR = new Date().getUTCFullYear()
/** The year applications are for; history is always strictly before it. */
const DRAW_YEAR = CURRENT_YEAR

const NATIONAL_IDS = {
  ahmed: '711111111111111111',
  fatima: '722222222222222222',
  karim: '733333333333333333',
}

function applicant(nationalId: string, overrides: Record<string, unknown> = {}) {
  return { nationalId, fullName: 'Weight Subject', dob: '1980-04-12', ...overrides }
}

const submit = (body: Record<string, unknown>) => request(app).post('/api/applications').send(body)

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
    primary: applicant(NATIONAL_IDS.ahmed),
    secondary: applicant(NATIONAL_IDS.fatima, { fullName: 'Second Applicant' }),
    ...overrides,
  }
}

/** Registers an application and returns the stored row. */
async function register(body: Record<string, unknown>): Promise<Application> {
  const response = await submit(body)
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })
}

async function participantByNationalId(nationalId: string): Promise<Participant> {
  return prisma.participant.findUniqueOrThrow({ where: { nationalId } })
}

/**
 * Gives someone `years` consecutive verified non-winning years ending the year
 * before `DRAW_YEAR`, which is exactly the run the streak walk should count.
 */
async function giveConsecutiveYears(
  participantId: string,
  years: number,
  overrides: Record<string, unknown> = {},
) {
  for (let offset = 1; offset <= years; offset += 1) {
    await participationHistoryService.create({
      participantId,
      communeId: geo.communeA1.id,
      drawYear: DRAW_YEAR - offset,
      participated: true,
      source: 'LEGACY_IMPORT',
      verified: true,
      ...overrides,
    })
  }
}

const weightOf = (id: string, cookie: string) =>
  request(app).get(`/api/admin/applications/${id}/weight`).set('Cookie', cookie)

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
  await prisma.participationHistory.deleteMany()
  await prisma.applicationParticipant.deleteMany()
  await prisma.application.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('the weighting rules, in isolation', () => {
  it('makes a weight out of a streak', () => {
    expect(individualWeight(1)).toBe(1)
    expect(individualWeight(5)).toBe(5)
    expect(individualWeight(42)).toBe(42)
  })

  it('floors a first-time applicant at one rather than zero', () => {
    // Zero would make them undrawable — ineligible by arithmetic, which is a
    // decision only the eligibility rules get to make.
    expect(individualWeight(0)).toBe(1)
  })

  it('uses the primary applicant alone for a single application', () => {
    expect(combineWeights(4, null)).toEqual({ calculatedWeight: 4, rule: 'SINGLE' })
  })

  it('takes the higher of a pair, whichever side it is on', () => {
    expect(combineWeights(5, 3)).toEqual({ calculatedWeight: 5, rule: 'MAX' })
    expect(combineWeights(3, 5)).toEqual({ calculatedWeight: 5, rule: 'MAX' })
  })

  it('keeps the shared weight when a pair are equal', () => {
    expect(combineWeights(4, 4)).toEqual({ calculatedWeight: 4, rule: 'MAX' })
  })

  it('refuses an implausible streak instead of weighting it', () => {
    expect(() => individualWeight(-1)).toThrow()
    expect(() => individualWeight(1.5)).toThrow()
    expect(() => individualWeight(MAX_APPLICATION_WEIGHT + 1)).toThrow()
    expect(() => individualWeight(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('weighting an application', () => {
  it('weighs one verified non-winning year as one', async () => {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 1)

    const result = await weightService.calculateApplicationWeight(application.id)

    expect(result.calculatedWeight).toBe(1)
    expect(result.rule).toBe('SINGLE')
    expect(result.secondaryWeight).toBeNull()
  })

  it('weighs five consecutive verified non-winning years as five', async () => {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 5)

    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(5)
  })

  it('gives a first-time applicant a positive weight', async () => {
    const application = await register(singleBody())

    const result = await weightService.calculateApplicationWeight(application.id)

    expect(result.calculatedWeight).toBe(1)
    expect(Number.isInteger(result.calculatedWeight)).toBe(true)
    expect(result.calculatedWeight).toBeGreaterThan(0)
  })

  it('stops at a missing year', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)

    // Two recent years, a hole, then two older ones that must not be reached.
    await giveConsecutiveYears(participant.id, 2)
    for (const offset of [4, 5]) {
      await participationHistoryService.create({
        participantId: participant.id,
        communeId: geo.communeA1.id,
        drawYear: DRAW_YEAR - offset,
        participated: true,
        source: 'LEGACY_IMPORT',
        verified: true,
      })
    }

    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(2)
  })

  it('does not count an unverified record', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)

    await giveConsecutiveYears(participant.id, 1)
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: DRAW_YEAR - 2,
      participated: true,
      source: 'LEGACY_IMPORT',
      verified: false,
    })

    // The unverified 2nd year back neither counts nor is bridged over.
    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(1)
  })

  it('does not count a year the person did not take part in', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)

    await giveConsecutiveYears(participant.id, 1)
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: DRAW_YEAR - 2,
      participated: false,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(1)
  })

  it('stops at a year the person won', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)

    await giveConsecutiveYears(participant.id, 2)
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: DRAW_YEAR - 3,
      participated: true,
      won: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(2)
  })

  it('does not count the target draw year itself', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)

    await giveConsecutiveYears(participant.id, 1)
    // A record for the draw year itself. It is the year being decided.
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: DRAW_YEAR,
      participated: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(1)
  })

  it('takes the higher weight of a pair', async () => {
    const application = await register(pairedBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 5)
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.fatima)).id, 3)

    const result = await weightService.calculateApplicationWeight(application.id)

    expect(result).toMatchObject({
      primaryWeight: 5,
      secondaryWeight: 3,
      calculatedWeight: 5,
      rule: 'MAX',
    })
  })

  it('takes the higher weight when the partner is the stronger one', async () => {
    const application = await register(pairedBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 3)
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.fatima)).id, 5)

    const result = await weightService.calculateApplicationWeight(application.id)

    expect(result).toMatchObject({ primaryWeight: 3, secondaryWeight: 5, calculatedWeight: 5 })
  })

  it('keeps the shared weight when both of a pair are equal', async () => {
    const application = await register(pairedBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 4)
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.fatima)).id, 4)

    expect((await weightService.calculateApplicationWeight(application.id)).calculatedWeight).toBe(4)
  })

  it('refuses to weight an ineligible application', async () => {
    const application = await register(singleBody())
    await prisma.participant.update({
      where: { nationalId: NATIONAL_IDS.ahmed },
      data: { hasWonHajj: true },
    })

    await expect(weightService.calculateApplicationWeight(application.id)).rejects.toMatchObject({
      status: 409,
      code: 'APPLICATION_INELIGIBLE',
    })
    // Refused, not given a zero: zero is a weight, not a verdict.
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).calculatedWeight,
    ).toBeNull()
  })

  it('refuses an application that does not exist', async () => {
    await expect(weightService.calculateApplicationWeight('no-such-application')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('gives the same answer every time it is asked', async () => {
    const application = await register(pairedBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 3)
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.fatima)).id, 2)

    const first = await weightService.calculateApplicationWeight(application.id)
    const second = await weightService.calculateApplicationWeight(application.id)

    expect(second).toEqual(first)
  })

  it('changes nothing by calculating', async () => {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 2)
    const before = await prisma.application.findUniqueOrThrow({ where: { id: application.id } })

    await weightService.calculateApplicationWeight(application.id)

    expect(await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).toEqual(before)
  })
})

describe('freezing a weight', () => {
  it('persists the weight onto the application', async () => {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 4)

    const result = await weightService.freezeApplicationWeight(application.id)

    expect(result.frozenWeight).toBe(4)
    expect(await weightService.frozenWeight(application.id)).toBe(4)
  })

  it('stores an integer, not a decimal', async () => {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 3)

    await weightService.freezeApplicationWeight(application.id)
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: application.id } })

    expect(stored.calculatedWeight).toBe(3)
    expect(Number.isInteger(stored.calculatedWeight)).toBe(true)
  })

  it('does not let a later historical correction rewrite a frozen weight', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)
    await giveConsecutiveYears(participant.id, 4)

    await weightService.freezeApplicationWeight(application.id)

    // A fifth year is verified after the fact. The live calculation grows; the
    // snapshot must not.
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: DRAW_YEAR - 5,
      participated: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    const afterCorrection = await weightService.calculateApplicationWeight(application.id)
    expect(afterCorrection.calculatedWeight).toBe(5)
    expect(afterCorrection.frozenWeight).toBe(4)

    // Re-freezing does not overwrite either — that needs a pre-draw
    // recalculation workflow, which does not exist yet.
    await weightService.freezeApplicationWeight(application.id)
    expect(await weightService.frozenWeight(application.id)).toBe(4)
  })

  it('refuses to freeze a weight for an ineligible application', async () => {
    const application = await register(singleBody())
    await prisma.participant.update({
      where: { nationalId: NATIONAL_IDS.ahmed },
      data: { hasWonHajj: true },
    })

    await expect(weightService.freezeApplicationWeight(application.id)).rejects.toMatchObject({
      code: 'APPLICATION_INELIGIBLE',
    })
    expect(await weightService.frozenWeight(application.id)).toBeNull()
  })

  it('settles on one value when frozen concurrently', async () => {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 3)

    const results = await Promise.all([
      weightService.freezeApplicationWeight(application.id),
      weightService.freezeApplicationWeight(application.id),
      weightService.freezeApplicationWeight(application.id),
    ])

    // Every caller sees the same authoritative snapshot, and so does the row.
    for (const result of results) expect(result.frozenWeight).toBe(3)
    expect(await weightService.frozenWeight(application.id)).toBe(3)
  })

  it('does not touch participant history or winner status', async () => {
    const application = await register(singleBody())
    const participant = await participantByNationalId(NATIONAL_IDS.ahmed)
    await giveConsecutiveYears(participant.id, 2)

    const historyBefore = await prisma.participationHistory.findMany({ orderBy: { drawYear: 'desc' } })
    const participantBefore = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })

    await weightService.freezeApplicationWeight(application.id)

    expect(await prisma.participationHistory.findMany({ orderBy: { drawYear: 'desc' } })).toEqual(
      historyBefore,
    )
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })).toEqual(
      participantBefore,
    )
  })
})

describe('administrative weight inspection', () => {
  async function weightedApplication() {
    const application = await register(singleBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 3)
    return application
  }

  it('shows a SUPER_ADMIN the weight and its breakdown', async () => {
    const application = await register(pairedBody())
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.ahmed)).id, 5)
    await giveConsecutiveYears((await participantByNationalId(NATIONAL_IDS.fatima)).id, 2)
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await weightOf(application.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      calculatedWeight: 5,
      rule: 'MAX',
      frozenWeight: null,
      breakdown: { primaryWeight: 5, secondaryWeight: 2 },
    })
  })

  it('reports whether a frozen snapshot still matches', async () => {
    const application = await weightedApplication()
    await weightService.freezeApplicationWeight(application.id)
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await weightOf(application.id, cookie)

    expect(response.body).toMatchObject({ frozenWeight: 3, calculatedWeight: 3, matchesFrozen: true })
  })

  it('shows a scoped administrator the weight but not the breakdown', async () => {
    const application = await weightedApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const response = await weightOf(application.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body.calculatedWeight).toBe(3)
    // A person's history can span communes, so the per-applicant figures are
    // not this administrator's to see.
    expect(response.body.breakdown).toBeNull()
  })

  it('hides another commune’s application from a COMMUNE_ADMIN', async () => {
    const application = await weightedApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA2.id,
    })

    const refused = await weightOf(application.id, cookie)
    const missing = await weightOf('no-such-application', cookie)

    expect(refused.status).toBe(404)
    expect(refused.body).toEqual(missing.body)
  })

  it('hides another wilaya’s application from a WILAYA_ADMIN', async () => {
    const application = await weightedApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaB.id,
    })

    expect((await weightOf(application.id, cookie)).status).toBe(404)
  })

  it('lets a WILAYA_ADMIN see an application in their own wilaya', async () => {
    const application = await weightedApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    const response = await weightOf(application.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body.breakdown).toBeNull()
  })

  it('exposes no participant identity or history detail', async () => {
    const application = await weightedApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const body = JSON.stringify((await weightOf(application.id, cookie)).body)

    for (const forbidden of [
      NATIONAL_IDS.ahmed,
      'Weight Subject',
      '1980-04-12',
      application.id,
      application.primaryParticipantId,
      'stoppedBecause',
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('never freezes a weight merely by being read', async () => {
    const application = await weightedApplication()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    await weightOf(application.id, cookie)

    expect(await weightService.frozenWeight(application.id)).toBeNull()
  })

  it('refuses an unauthenticated caller', async () => {
    const application = await weightedApplication()

    expect((await request(app).get(`/api/admin/applications/${application.id}/weight`)).status).toBe(401)
  })

  it('reports an ineligible application rather than inventing a weight', async () => {
    const application = await weightedApplication()
    await prisma.participant.update({
      where: { nationalId: NATIONAL_IDS.ahmed },
      data: { hasWonHajj: true },
    })
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await weightOf(application.id, cookie)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('APPLICATION_INELIGIBLE')
  })
})
