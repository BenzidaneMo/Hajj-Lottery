import { PrismaClient, type Participant } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { calculateStreak, type HistoryYear } from '../src/lib/participation-streak.js'
import { participationHistoryService } from '../src/services/participation-history.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'
import { participantFixture } from './helpers/participants.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
let participant: Participant

const CURRENT_YEAR = new Date().getUTCFullYear()

/** A year safely in the past, so tests never brush the future-year rule. */
const PAST = CURRENT_YEAR - 1

async function makeParticipant(nationalId: string, overrides: Record<string, unknown> = {}) {
  return prisma.participant.create({
    data: participantFixture(nationalId, {
      lastNameLatin: 'History Subject',
      dob: new Date('1980-01-01T00:00:00.000Z'),
      ...overrides,
    }),
  })
}

/** Records one year, verified unless a test says otherwise. */
function record(overrides: Record<string, unknown> = {}) {
  return participationHistoryService.create({
    participantId: participant.id,
    communeId: geo.communeA1.id,
    drawYear: PAST,
    participated: true,
    source: 'LEGACY_IMPORT',
    verified: true,
    ...overrides,
  })
}

beforeAll(async () => {
  await prisma.$connect()
})

beforeEach(async () => {
  app = createApp()
  geo = await ensureTestGeography(prisma)
  await prisma.participationHistory.deleteMany()
  participant = await makeParticipant('911111111111111111')
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('recording history', () => {
  it('creates a verified record', async () => {
    const created = await record({ notes: 'Register 12, page 4' })

    expect(created).toMatchObject({
      drawYear: PAST,
      participated: true,
      won: false,
      source: 'LEGACY_IMPORT',
      verified: true,
      notes: 'Register 12, page 4',
    })
    expect(created.commune.id).toBe(geo.communeA1.id)
  })

  it('leaves an imported record unverified unless told otherwise', async () => {
    const created = await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: PAST,
      participated: true,
      source: 'LEGACY_IMPORT',
    })

    expect(created.verified).toBe(false)
  })

  it('refuses a second record for the same participant and year', async () => {
    await record()

    await expect(record({ communeId: geo.communeA2.id })).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_HISTORY_YEAR',
    })
    expect(await prisma.participationHistory.count()).toBe(1)
  })

  it('lets one participant have many years', async () => {
    await record({ drawYear: PAST })
    await record({ drawYear: PAST - 1 })
    await record({ drawYear: PAST - 2 })

    const history = await participationHistoryService.listForParticipant(participant.id)

    expect(history.map((h) => h.drawYear)).toEqual([PAST, PAST - 1, PAST - 2])
  })

  it('preserves a different commune in a different year', async () => {
    await record({ drawYear: PAST, communeId: geo.communeA1.id })
    await record({ drawYear: PAST - 1, communeId: geo.communeB1.id })

    const history = await participationHistoryService.listForParticipant(participant.id)

    expect(history.map((h) => h.communeId)).toEqual([geo.communeA1.id, geo.communeB1.id])
  })

  it('refuses an unknown participant', async () => {
    await expect(record({ participantId: 'no-such-participant' })).rejects.toMatchObject({
      status: 404,
      code: 'PARTICIPANT_NOT_FOUND',
    })
  })

  it('refuses an unknown commune', async () => {
    await expect(record({ communeId: 'no-such-commune' })).rejects.toMatchObject({
      status: 404,
      code: 'COMMUNE_NOT_FOUND',
    })
  })

  it('refuses a year that has not happened yet', async () => {
    await expect(record({ drawYear: CURRENT_YEAR + 1 })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_DRAW_YEAR',
    })
    expect(await prisma.participationHistory.count()).toBe(0)
  })

  it('refuses to record a win in a draw the person did not enter', async () => {
    // The database forbids it; this asserts the constraint is really there.
    await expect(record({ participated: false, won: true })).rejects.toThrow()
  })

  it('distinguishes a known absence from a missing year', async () => {
    await record({ drawYear: PAST, participated: false })

    const stored = await prisma.participationHistory.findFirstOrThrow()
    expect(stored.participated).toBe(false)

    // The year before has no row at all — a different thing entirely, and the
    // ledger keeps them apart rather than defaulting one to the other.
    expect(await prisma.participationHistory.count({ where: { drawYear: PAST - 1 } })).toBe(0)
  })

  it('lets exactly one of two concurrent writes for the same year win', async () => {
    const attempts = [
      record({ notes: 'first' }),
      record({ notes: 'second' }),
      record({ notes: 'third' }),
    ].map((p) => p.then(() => 'created' as const).catch(() => 'refused' as const))

    const results = await Promise.all(attempts)

    expect(results.filter((r) => r === 'created')).toHaveLength(1)
    expect(await prisma.participationHistory.count()).toBe(1)
  })
})

describe('correcting history', () => {
  it('amends a fact in place and records why', async () => {
    const created = await record({ participated: true, notes: 'Imported' })

    const corrected = await participationHistoryService.correct(created.id, {
      participated: false,
      notes: 'Register entry belonged to a different person',
    })

    expect(corrected.id).toBe(created.id)
    expect(corrected.participated).toBe(false)
    expect(corrected.source).toBe('ADMIN_CORRECTION')
    expect(corrected.notes).toBe('Register entry belonged to a different person')
    // Amended, not replaced: one row still, so an audit trail can attach later.
    expect(await prisma.participationHistory.count()).toBe(1)
  })

  it('refuses a correction that would contradict itself', async () => {
    const created = await record({ participated: true, won: true })

    await expect(
      participationHistoryService.correct(created.id, { participated: false, notes: 'wrong' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('does not touch participant identity', async () => {
    const created = await record()
    const before = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })

    await participationHistoryService.correct(created.id, { verified: true, notes: 'Confirmed' })

    expect(await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } })).toEqual(before)
  })

  it('refuses to correct a record that does not exist', async () => {
    await expect(participationHistoryService.correct('no-such-record', { notes: 'x' })).rejects.toMatchObject(
      { status: 404, code: 'HISTORY_NOT_FOUND' },
    )
  })
})

describe('the streak walk, in isolation', () => {
  const year = (drawYear: number, overrides: Partial<HistoryYear> = {}): HistoryYear => ({
    drawYear,
    participated: true,
    won: false,
    verified: true,
    ...overrides,
  })

  it('counts a contiguous run of non-winning years', () => {
    const years = [2022, 2023, 2024, 2025, 2026].map((y) => year(y))

    const streak = calculateStreak('p-1', 2027, years)

    expect(streak.consecutiveNonWinningYears).toBe(5)
    expect(streak.stoppedAt).toBe(2021)
    expect(streak.stoppedBecause).toBe('NO_AUTHORITATIVE_RECORD')
  })

  it('stops at a missing year instead of bridging it', () => {
    // 2023 is absent. The streak before 2025 is 2024 alone — it must not
    // reach back across the hole and claim 2022 as well.
    const streak = calculateStreak('p-1', 2025, [year(2022), year(2024)])

    expect(streak.consecutiveNonWinningYears).toBe(1)
    expect(streak.stoppedAt).toBe(2023)
    expect(streak.stoppedBecause).toBe('NO_AUTHORITATIVE_RECORD')
  })

  it('stops at a year the person did not take part in', () => {
    const streak = calculateStreak('p-1', 2027, [year(2026), year(2025, { participated: false }), year(2024)])

    expect(streak.consecutiveNonWinningYears).toBe(1)
    expect(streak.stoppedAt).toBe(2025)
    expect(streak.stoppedBecause).toBe('DID_NOT_PARTICIPATE')
  })

  it('stops at a win', () => {
    const streak = calculateStreak('p-1', 2027, [year(2026), year(2025, { won: true }), year(2024)])

    expect(streak.consecutiveNonWinningYears).toBe(1)
    expect(streak.stoppedAt).toBe(2025)
    expect(streak.stoppedBecause).toBe('WON')
  })

  it('does not count an unverified record', () => {
    const streak = calculateStreak('p-1', 2027, [year(2026), year(2025, { verified: false })])

    expect(streak.consecutiveNonWinningYears).toBe(1)
    expect(streak.stoppedBecause).toBe('UNVERIFIED_RECORD')
  })

  it('never counts the target year itself', () => {
    // A record for 2027 exists, but 2027 is the year being decided.
    const streak = calculateStreak('p-1', 2027, [year(2027), year(2026)])

    expect(streak.consecutiveNonWinningYears).toBe(1)
    expect(streak.stoppedAt).toBe(2025)
  })

  it('reports an empty ledger as a streak of zero, not an error', () => {
    const streak = calculateStreak('p-1', 2027, [])

    expect(streak.consecutiveNonWinningYears).toBe(0)
    expect(streak.stoppedAt).toBe(2026)
  })

  it('is deterministic, and independent of the order rows arrive in', () => {
    const years = [year(2024), year(2026), year(2025)]

    const first = calculateStreak('p-1', 2027, years)
    const second = calculateStreak('p-1', 2027, [...years].reverse())

    expect(first.consecutiveNonWinningYears).toBe(3)
    expect(second).toEqual(first)
  })
})

describe('the streak, over the database', () => {
  it('counts verified participation years before the target', async () => {
    for (const drawYear of [PAST, PAST - 1, PAST - 2]) {
      await record({ drawYear })
    }

    const streak = await participationHistoryService.calculateConsecutiveNonWinningYears(
      participant.id,
      PAST + 1,
    )

    expect(streak.consecutiveNonWinningYears).toBe(3)
    expect(streak.targetDrawYear).toBe(PAST + 1)
  })

  it('gives the same answer every time it is asked', async () => {
    await record({ drawYear: PAST })
    await record({ drawYear: PAST - 1 })

    const first = await participationHistoryService.calculateConsecutiveNonWinningYears(
      participant.id,
      PAST + 1,
    )
    const second = await participationHistoryService.calculateConsecutiveNonWinningYears(
      participant.id,
      PAST + 1,
    )

    expect(first).toEqual(second)
    expect(first.consecutiveNonWinningYears).toBe(2)
  })

  it('does not invent participation for a person with no history', async () => {
    const streak = await participationHistoryService.calculateConsecutiveNonWinningYears(
      participant.id,
      PAST + 1,
    )

    expect(streak.consecutiveNonWinningYears).toBe(0)
  })
})

describe('administrative access', () => {
  const historyOf = (participantId: string, cookie: string) =>
    request(app).get(`/api/admin/participants/${participantId}/history`).set('Cookie', cookie)

  const recordAt = (id: string, cookie: string) =>
    request(app).get(`/api/admin/history/${id}`).set('Cookie', cookie)

  /** The same person, two years, two communes in different wilayas. */
  async function historyAcrossCommunes() {
    const inA = await record({ drawYear: PAST, communeId: geo.communeA1.id })
    const inB = await record({ drawYear: PAST - 1, communeId: geo.communeB1.id })
    return { inA, inB }
  }

  it('shows a SUPER_ADMIN every year, and the streak', async () => {
    await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const response = await historyOf(participant.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body.records).toHaveLength(2)
    expect(response.body.streak.consecutiveNonWinningYears).toBeGreaterThanOrEqual(0)
  })

  it('shows a WILAYA_ADMIN only their own wilaya’s years', async () => {
    const { inA } = await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    const response = await historyOf(participant.id, cookie)

    expect(response.body.records).toHaveLength(1)
    expect(response.body.records[0].id).toBe(inA.id)
    // The other year is not merely hidden from the list — it is not hinted at.
    expect(JSON.stringify(response.body)).not.toContain(geo.communeB1.code)
  })

  it('withholds the streak from a scoped administrator', async () => {
    await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    // A streak spans communes, so any number here would betray years outside
    // this administrator's territory.
    expect((await historyOf(participant.id, cookie)).body.streak).toBeNull()
  })

  it('shows a COMMUNE_ADMIN only their own commune’s years', async () => {
    const inA1 = await record({ drawYear: PAST, communeId: geo.communeA1.id })
    await record({ drawYear: PAST - 1, communeId: geo.communeA2.id })

    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const response = await historyOf(participant.id, cookie)

    expect(response.body.records).toHaveLength(1)
    expect(response.body.records[0].id).toBe(inA1.id)
  })

  it('returns an empty history rather than a 404 for a participant with nothing in scope', async () => {
    await record({ drawYear: PAST, communeId: geo.communeB1.id })
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const response = await historyOf(participant.id, cookie)

    // Identical to what an unknown participant id returns, so the response
    // cannot be used to discover who is in the registry.
    const unknown = await historyOf('no-such-participant', cookie)
    expect(response.status).toBe(200)
    expect(response.body).toEqual(unknown.body)
  })

  it('lets an administrator read a record in their own territory', async () => {
    const { inA } = await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const response = await recordAt(inA.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ drawYear: PAST, participated: true, verified: true })
  })

  it('hides a record from another commune, exactly as if it did not exist', async () => {
    const { inB } = await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.COMMUNE_ADMIN,
      wilayaId: geo.wilayaA.id,
      communeId: geo.communeA1.id,
    })

    const refused = await recordAt(inB.id, cookie)
    const missing = await recordAt('no-such-record', cookie)

    expect(refused.status).toBe(404)
    expect(refused.body).toEqual(missing.body)
  })

  it('hides a record from another wilaya', async () => {
    const { inB } = await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, {
      role: AdminRole.WILAYA_ADMIN,
      wilayaId: geo.wilayaA.id,
    })

    expect((await recordAt(inB.id, cookie)).status).toBe(404)
  })

  it('exposes no participant identity', async () => {
    const { inA } = await historyAcrossCommunes()
    const { cookie } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const body = JSON.stringify((await recordAt(inA.id, cookie)).body)

    for (const forbidden of ['911111111111111111', 'History Subject', '1980-01-01', participant.id]) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('refuses an unauthenticated caller', async () => {
    const { inA } = await historyAcrossCommunes()

    expect((await request(app).get(`/api/admin/history/${inA.id}`)).status).toBe(401)
    expect((await request(app).get(`/api/admin/participants/${participant.id}/history`)).status).toBe(401)
  })
})
