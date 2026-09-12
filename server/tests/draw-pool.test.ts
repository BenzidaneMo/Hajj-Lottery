import { PrismaClient, type Application, type CommuneDraw, type DrawYear } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { canonicalizePool, hashPool, type HashableEntry } from '../src/lib/draw-pool-hash.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { drawPoolService } from '../src/services/draw-pool.service.js'
import { participationHistoryService } from '../src/services/participation-history.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
let drawYear: DrawYear

/** Well away from the calendar year, so nothing collides with other suites. */
const YEAR = 2160

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `50000000000000${String(nextId).padStart(4, '0')}`
}

const submit = (body: Record<string, unknown>) => request(app).post('/api/applications').send(body)

/**
 * Registers one application into a commune, and freezes its weight — the state
 * an application must be in before it can enter a pool.
 */
async function registerAndWeigh(
  communeId: string,
  wilayaId: string,
  options: { streakYears?: number } = {},
): Promise<Application> {
  const id = nationalId()
  const response = await submit({
    entryType: 'SINGLE',
    wilayaId,
    communeId,
    primary: { nationalId: id, fullName: 'Pool Subject', dob: '1980-04-12', gender: 'MALE' },
  })
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })

  if (options.streakYears) {
    const participant = await prisma.participant.findUniqueOrThrow({ where: { nationalId: id } })
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

/** Moves the whole configuration to the state freezing requires. */
async function readyToFreeze(communeDraw: CommuneDraw): Promise<void> {
  await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
}

async function communeDrawFor(communeId: string, allocatedSpots = 12): Promise<CommuneDraw> {
  return drawConfigurationService.createCommuneDraw({
    drawYearId: drawYear.id,
    communeId,
    allocatedSpots,
  })
}

const poolOf = (id: string, cookie: string) =>
  request(app).get(`/api/admin/commune-draws/${id}/pool`).set('Cookie', cookie)

const freezeVia = (id: string, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${id}/freeze-pool`).set('Cookie', cookie)

const validateVia = (id: string, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${id}/validate-pool`).set('Cookie', cookie)

function blockerCodes(blockers: { code: string }[]): string[] {
  return blockers.map((b) => b.code)
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

describe('canonical hashing', () => {
  const entry = (overrides: Partial<HashableEntry> = {}): HashableEntry => ({
    applicationId: 'app-1',
    applicationReference: 'HZ-2160-MES-AAAAAA',
    entryType: 'SINGLE',
    primaryParticipantId: 'p-1',
    secondaryParticipantId: null,
    weight: 3,
    ...overrides,
  })

  const pool = (entries: HashableEntry[]) => ({
    communeDrawId: 'cd-1',
    communeId: 'c-1',
    drawYear: YEAR,
    allocatedSpots: 12,
    entries,
  })

  it('is deterministic', () => {
    const entries = [entry(), entry({ applicationId: 'app-2', primaryParticipantId: 'p-2' })]

    expect(hashPool(pool(entries))).toBe(hashPool(pool(entries)))
  })

  it('does not depend on the order entries arrive in', () => {
    const a = entry({ applicationId: 'app-a' })
    const b = entry({ applicationId: 'app-b', primaryParticipantId: 'p-2' })

    // Sorted by application id, so however the database returned them, the
    // fingerprint is the same.
    expect(hashPool(pool([a, b]))).toBe(hashPool(pool([b, a])))
  })

  it('changes when a weight changes', () => {
    const before = hashPool(pool([entry({ weight: 3 })]))
    const after = hashPool(pool([entry({ weight: 4 })]))

    expect(after).not.toBe(before)
  })

  it('changes when an application identifier changes', () => {
    const before = hashPool(pool([entry({ applicationId: 'app-1' })]))
    const after = hashPool(pool([entry({ applicationId: 'app-9' })]))

    expect(after).not.toBe(before)
  })

  it('changes when a participant or the allocation changes', () => {
    const base = hashPool(pool([entry()]))

    expect(hashPool(pool([entry({ primaryParticipantId: 'p-9' })]))).not.toBe(base)
    expect(hashPool({ ...pool([entry()]), allocatedSpots: 13 })).not.toBe(base)
  })

  it('tells a single applicant apart from a missing partner', () => {
    const single = hashPool(pool([entry({ secondaryParticipantId: null })]))
    const paired = hashPool(pool([entry({ entryType: 'PAIRED', secondaryParticipantId: 'p-2' })]))

    expect(paired).not.toBe(single)
  })

  it('carries no personal information into the canonical form', () => {
    const serialized = canonicalizePool(pool([entry()]))

    for (const personal of ['Pool Subject', '1980-04-12', '0555']) {
      expect(serialized).not.toContain(personal)
    }
  })

  it('refuses a value that would make the format ambiguous', () => {
    expect(() => hashPool(pool([entry({ applicationReference: 'HZ|INJECTED' })]))).toThrow()
  })
})

describe('validating a pool', () => {
  it('reports ready once everything is in place', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)

    const validation = await drawPoolService.validate(communeDraw.id)

    expect(validation.ready).toBe(true)
    expect(validation.blockers).toEqual([])
    expect(validation.entries).toHaveLength(1)
  })

  it('blocks while registration is still open', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })

    const validation = await drawPoolService.validate(communeDraw.id)

    expect(validation.ready).toBe(false)
    expect(blockerCodes(validation.blockers)).toContain('REGISTRATION_STILL_OPEN')
  })

  it('blocks while the commune draw is still a draft', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')

    const validation = await drawPoolService.validate(communeDraw.id)

    expect(blockerCodes(validation.blockers)).toContain('COMMUNE_DRAW_NOT_READY')
  })

  it('blocks when nobody eligible applied', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await readyToFreeze(communeDraw)

    const validation = await drawPoolService.validate(communeDraw.id)

    // An explicit state, not an empty pool: a commune where nobody applied is
    // cancelled, never frozen with nothing in it.
    expect(validation.ready).toBe(false)
    expect(blockerCodes(validation.blockers)).toContain('NO_ELIGIBLE_APPLICATIONS')
  })

  it('blocks an application whose weight was never frozen', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.application.update({ where: { id: application.id }, data: { calculatedWeight: null } })
    await readyToFreeze(communeDraw)

    const validation = await drawPoolService.validate(communeDraw.id)

    expect(blockerCodes(validation.blockers)).toContain('MISSING_WEIGHT')
    expect(validation.blockers[0]?.applicationReference).toBe(application.applicationReference)
  })

  it('blocks an application whose frozen weight has gone stale', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)

    // A year of history is verified after the weight was frozen, so a fresh
    // calculation would now say 2 where the snapshot says 1.
    const participant = await prisma.participant.findUniqueOrThrow({
      where: { id: application.primaryParticipantId },
    })
    await participationHistoryService.create({
      participantId: participant.id,
      communeId: geo.communeA1.id,
      drawYear: YEAR - 1,
      participated: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })
    await readyToFreeze(communeDraw)

    const validation = await drawPoolService.validate(communeDraw.id)

    expect(blockerCodes(validation.blockers)).toContain('STALE_WEIGHT')
    // Reported, never repaired: the frozen weight is untouched.
    const stored = await prisma.application.findUniqueOrThrow({ where: { id: application.id } })
    expect(stored.calculatedWeight).toBe(1)
  })

  it('blocks when a participant has since been recorded as a winner', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.participant.update({
      where: { id: application.primaryParticipantId },
      data: { hasWonHajj: true },
    })
    await readyToFreeze(communeDraw)

    const validation = await drawPoolService.validate(communeDraw.id)

    expect(blockerCodes(validation.blockers)).toContain('PARTICIPANT_STATE_CONFLICT')
  })

  it('reports every blocker rather than only the first', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.application.update({ where: { id: application.id }, data: { calculatedWeight: null } })

    const validation = await drawPoolService.validate(communeDraw.id)

    const codes = blockerCodes(validation.blockers)
    expect(codes).toContain('REGISTRATION_STILL_OPEN')
    expect(codes).toContain('COMMUNE_DRAW_NOT_READY')
    expect(codes).toContain('MISSING_WEIGHT')
  })

  it('changes nothing by validating', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)
    const before = await prisma.application.findFirstOrThrow()

    await drawPoolService.validate(communeDraw.id)

    expect(await prisma.application.findFirstOrThrow()).toEqual(before)
    expect(await prisma.drawPool.count()).toBe(0)
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'READY',
    )
  })
})

describe('freezing a pool', () => {
  it('snapshots every eligible application exactly once', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const applications = [
      await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id),
      await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears: 2 }),
      await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears: 4 }),
    ]
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)

    const entries = await prisma.drawPoolEntry.findMany({ where: { drawPoolId: pool.id } })
    expect(entries).toHaveLength(3)
    expect(new Set(entries.map((e) => e.applicationId))).toEqual(new Set(applications.map((a) => a.id)))
    expect(pool.entryCount).toBe(3)
  })

  it('copies the frozen weight and sums it into the total', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id) // weight 1
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears: 2 }) // weight 3
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)
    const entries = await prisma.drawPoolEntry.findMany({ where: { drawPoolId: pool.id } })

    for (const entry of entries) {
      const application = await prisma.application.findUniqueOrThrow({ where: { id: entry.applicationId } })
      expect(entry.weight).toBe(application.calculatedWeight)
    }
    expect(pool.totalWeight).toBe(entries.reduce((sum, e) => sum + e.weight, 0))
    expect(pool.totalWeight).toBe(4)
  })

  it('leaves out another commune and another year', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const neighbour = await communeDrawFor(geo.communeA2.id)
    const mine = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await registerAndWeigh(geo.communeA2.id, geo.wilayaA.id)

    // An application filed under a different year entirely.
    const otherYear = await prisma.drawYear.create({ data: { year: YEAR - 1, status: 'DRAFT' } })
    await prisma.application.update({
      where: { id: (await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)).id },
      data: { drawYear: otherYear.year },
    })

    await drawConfigurationService.updateCommuneDraw(neighbour.id, { status: 'READY' })
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)
    const entries = await prisma.drawPoolEntry.findMany({ where: { drawPoolId: pool.id } })

    expect(entries).toHaveLength(1)
    expect(entries[0]?.applicationId).toBe(mine.id)
  })

  it('accepts a pool smaller than the allocation', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id, 100)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)

    // 100 places, one applicant. Nobody is selected here; that is the draw's job.
    expect(pool.entryCount).toBe(1)
    expect(pool.allocatedSpots).toBe(100)
  })

  it('locks the commune draw as part of the same transaction', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)

    await drawPoolService.freeze(communeDraw.id)

    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
  })

  it('refuses and leaves nothing behind when validation blocks', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    const application = await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await prisma.application.update({ where: { id: application.id }, data: { calculatedWeight: null } })
    await readyToFreeze(communeDraw)

    await expect(drawPoolService.freeze(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'POOL_NOT_READY',
    })

    expect(await prisma.drawPool.count()).toBe(0)
    expect(await prisma.drawPoolEntry.count()).toBe(0)
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'READY',
    )
  })

  it('is retryable once the blocking problem is fixed', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await readyToFreeze(communeDraw)

    await expect(drawPoolService.freeze(communeDraw.id)).rejects.toMatchObject({ code: 'POOL_NOT_READY' })

    // Reopen just long enough for an application to arrive, then close again.
    await prisma.drawYear.update({ where: { id: drawYear.id }, data: { status: 'REGISTRATION_OPEN' } })
    await prisma.communeDraw.update({ where: { id: communeDraw.id }, data: { status: 'DRAFT' } })
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)
    expect(pool.entryCount).toBe(1)
  })

  it('does not create a second pool when frozen again', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)

    const first = await drawPoolService.freeze(communeDraw.id)
    const second = await drawPoolService.freeze(communeDraw.id)

    expect(second.alreadyFrozen).toBe(true)
    expect(second.pool.id).toBe(first.pool.id)
    expect(await prisma.drawPool.count()).toBe(1)
  })

  it('produces exactly one authoritative pool under concurrent freezes', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears: 1 })
    await readyToFreeze(communeDraw)

    const results = await Promise.allSettled([
      drawPoolService.freeze(communeDraw.id),
      drawPoolService.freeze(communeDraw.id),
      drawPoolService.freeze(communeDraw.id),
    ])

    const poolIds = new Set(results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.pool.id] : [])))

    expect(await prisma.drawPool.count()).toBe(1)
    expect(poolIds.size).toBeLessThanOrEqual(1)
    // No partial entries from a losing attempt.
    expect(await prisma.drawPoolEntry.count()).toBe(2)
  })

  it('records who froze the pool, in the same transaction', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)
    const { user } = await createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })

    const { event, pool } = await drawPoolService.freeze(communeDraw.id, {
      id: user.id,
      role: user.role,
      wilayaId: user.wilayaId,
      communeId: user.communeId,
    })

    expect(event).toMatchObject({
      event: 'draw_pool.frozen',
      actingAdministratorId: user.id,
      communeDrawId: communeDraw.id,
      entryCount: 1,
      alreadyFrozen: false,
    })
    expect(event.snapshotHash).toMatch(/^[0-9a-f]{64}$/)

    // Persisted now, alongside the pool it describes — aggregates and the hash,
    // never the pool's contents.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'DRAW_POOL_FROZEN' } })
    expect(audit.actorUserId).toBe(user.id)
    expect(audit.targetId).toBe(pool.id)
    expect(audit.communeId).toBe(geo.communeA1.id)
    expect(audit.metadata).toMatchObject({ entryCount: 1, snapshotHash: pool.snapshotHash })
  })

  it('never touches participants or their history', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears: 2 })
    await readyToFreeze(communeDraw)

    const participantsBefore = await prisma.participant.findMany({ orderBy: { id: 'asc' } })
    const historyBefore = await prisma.participationHistory.findMany({ orderBy: { id: 'asc' } })

    await drawPoolService.freeze(communeDraw.id)

    expect(await prisma.participant.findMany({ orderBy: { id: 'asc' } })).toEqual(participantsBefore)
    expect(await prisma.participationHistory.findMany({ orderBy: { id: 'asc' } })).toEqual(historyBefore)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(0)
  })
})

describe('the frozen pool is immutable', () => {
  async function frozen() {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)
    const { pool } = await drawPoolService.freeze(communeDraw.id)
    return { communeDraw, pool }
  }

  it('refuses an update to a pool entry, at the database', async () => {
    const { pool } = await frozen()
    const entry = await prisma.drawPoolEntry.findFirstOrThrow({ where: { drawPoolId: pool.id } })

    await expect(
      prisma.drawPoolEntry.update({ where: { id: entry.id }, data: { weight: 99 } }),
    ).rejects.toThrow()

    expect((await prisma.drawPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })).weight).toBe(
      entry.weight,
    )
  })

  it('refuses a delete of a pool entry, at the database', async () => {
    const { pool } = await frozen()
    const entry = await prisma.drawPoolEntry.findFirstOrThrow({ where: { drawPoolId: pool.id } })

    await expect(prisma.drawPoolEntry.delete({ where: { id: entry.id } })).rejects.toThrow()
    expect(await prisma.drawPoolEntry.count({ where: { drawPoolId: pool.id } })).toBe(1)
  })

  it('refuses an update or a delete of the pool itself', async () => {
    const { pool } = await frozen()

    await expect(
      prisma.drawPool.update({ where: { id: pool.id }, data: { totalWeight: 999 } }),
    ).rejects.toThrow()
    await expect(prisma.drawPool.delete({ where: { id: pool.id } })).rejects.toThrow()

    expect(await prisma.drawPool.count()).toBe(1)
  })

  it('refuses a second pool for the same commune draw', async () => {
    const { communeDraw } = await frozen()

    await expect(
      prisma.drawPool.create({
        data: {
          communeDrawId: communeDraw.id,
          entryCount: 1,
          totalWeight: 1,
          allocatedSpots: 12,
          snapshotHash: 'x'.repeat(64),
        },
      }),
    ).rejects.toThrow()
  })

  it('keeps the allocation fixed once locked', async () => {
    const { communeDraw } = await frozen()

    await expect(
      drawConfigurationService.updateCommuneDraw(communeDraw.id, { allocatedSpots: 99 }),
    ).rejects.toMatchObject({ code: 'DRAW_CONFIGURATION_LOCKED' })
  })

  it('keeps its entries when the underlying weight would now differ', async () => {
    const { communeDraw, pool } = await frozen()
    const entry = await prisma.drawPoolEntry.findFirstOrThrow({ where: { drawPoolId: pool.id } })

    // History moves after the freeze. The snapshot does not.
    await participationHistoryService.create({
      participantId: entry.primaryParticipantId,
      communeId: geo.communeA1.id,
      drawYear: YEAR - 1,
      participated: true,
      source: 'LEGACY_IMPORT',
      verified: true,
    })

    const stored = await prisma.drawPoolEntry.findUniqueOrThrow({ where: { id: entry.id } })
    expect(stored.weight).toBe(entry.weight)
    expect((await prisma.drawPool.findUniqueOrThrow({ where: { id: pool.id } })).snapshotHash).toBe(
      pool.snapshotHash,
    )
    expect(communeDraw.id).toBeTruthy()
  })

  it('carries no personal information in its entries', async () => {
    const { pool } = await frozen()

    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'draw_pool_entries'
    `
    const names = columns.map((c) => c.column_name)

    for (const leaked of ['full_name', 'national_id', 'dob', 'phone_number']) {
      expect(names).not.toContain(leaked)
    }
    expect(pool.entryCount).toBe(1)
  })
})

describe('pool invariants hold in the database', () => {
  it('agrees with its own entries on count and total weight', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    for (const streakYears of [0, 1, 3, 5]) {
      await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id, { streakYears })
    }
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)

    const aggregate = await prisma.drawPoolEntry.aggregate({
      where: { drawPoolId: pool.id },
      _count: { _all: true },
      _sum: { weight: true },
    })

    expect(aggregate._count._all).toBe(pool.entryCount)
    expect(aggregate._sum.weight).toBe(pool.totalWeight)
  })

  it('holds every entry to a positive weight and the pool commune and year', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    for (let i = 0; i < 3; i += 1) await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)

    const { pool } = await drawPoolService.freeze(communeDraw.id)
    const entries = await prisma.drawPoolEntry.findMany({
      where: { drawPoolId: pool.id },
      include: { application: { select: { communeId: true, drawYear: true } } },
    })

    for (const entry of entries) {
      expect(entry.weight).toBeGreaterThan(0)
      expect(entry.application.communeId).toBe(geo.communeA1.id)
      expect(entry.application.drawYear).toBe(YEAR)
    }
  })

  it('rejects a non-positive weight at the database', async () => {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)
    const { pool } = await drawPoolService.freeze(communeDraw.id)
    const entry = await prisma.drawPoolEntry.findFirstOrThrow({ where: { drawPoolId: pool.id } })

    await expect(
      prisma.$executeRaw`
        INSERT INTO "draw_pool_entries"
          ("id", "draw_pool_id", "application_id", "application_reference", "entry_type",
           "primary_participant_id", "weight")
        VALUES ('bad', ${pool.id}, ${entry.applicationId}, 'HZ-2160-XXX-000000', 'SINGLE',
                ${entry.primaryParticipantId}, 0)
      `,
    ).rejects.toThrow()
  })
})

describe('administrative access', () => {
  async function frozenCommuneDraw() {
    const communeDraw = await communeDrawFor(geo.communeA1.id)
    await registerAndWeigh(geo.communeA1.id, geo.wilayaA.id)
    await readyToFreeze(communeDraw)
    return communeDraw
  }

  const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
  const wilayaAdmin = (wilayaId: string) =>
    createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })
  const communeAdmin = (wilayaId: string, communeId: string) =>
    createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId })

  it('lets a SUPER_ADMIN validate and then freeze', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie } = await superAdmin()

    const validation = await validateVia(communeDraw.id, cookie)
    expect(validation.status).toBe(200)
    expect(validation.body).toMatchObject({ ready: true, applicationCount: 1, blockers: [] })

    const frozen = await freezeVia(communeDraw.id, cookie)
    expect(frozen.status).toBe(201)
    expect(frozen.body).toMatchObject({ entryCount: 1, alreadyFrozen: false, snapshotVersion: 1 })
  })

  it('returns the existing pool rather than a second one on retry', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie } = await superAdmin()

    const first = await freezeVia(communeDraw.id, cookie)
    const again = await freezeVia(communeDraw.id, cookie)

    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ id: first.body.id, alreadyFrozen: true })
  })

  it('refuses a WILAYA_ADMIN and a COMMUNE_ADMIN freezing', async () => {
    const communeDraw = await frozenCommuneDraw()
    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    for (const { cookie } of [wilaya, commune]) {
      const response = await freezeVia(communeDraw.id, cookie)
      expect(response.status).toBe(403)
      expect(response.body.code).toBe('FORBIDDEN_ROLE')
    }

    expect(await prisma.drawPool.count()).toBe(0)
  })

  it('lets a scoped administrator validate and inspect their own commune', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie: superCookie } = await superAdmin()
    await freezeVia(communeDraw.id, superCookie)

    for (const { cookie } of [
      await wilayaAdmin(geo.wilayaA.id),
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
    ]) {
      expect((await validateVia(communeDraw.id, cookie)).status).toBe(200)

      const pool = await poolOf(communeDraw.id, cookie)
      expect(pool.status).toBe(200)
      expect(pool.body.entries).toHaveLength(1)
    }
  })

  it('hides another territory’s pool exactly as if it did not exist', async () => {
    const communeDraw = await communeDrawFor(geo.communeB1.id)
    await registerAndWeigh(geo.communeB1.id, geo.wilayaB.id)
    await readyToFreeze(communeDraw)
    const { cookie: superCookie } = await superAdmin()
    await freezeVia(communeDraw.id, superCookie)

    for (const { cookie } of [
      await wilayaAdmin(geo.wilayaA.id),
      await communeAdmin(geo.wilayaA.id, geo.communeA1.id),
    ]) {
      const refused = await poolOf(communeDraw.id, cookie)
      const missing = await poolOf('no-such-commune-draw', cookie)

      expect(refused.status).toBe(404)
      expect(refused.body).toEqual(missing.body)
      // The freeze route must not disclose it either.
      expect((await validateVia(communeDraw.id, cookie)).status).toBe(404)
    }
  })

  it('reports a summary without the entries', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie } = await superAdmin()
    await freezeVia(communeDraw.id, cookie)

    const response = await request(app)
      .get(`/api/admin/commune-draws/${communeDraw.id}/pool/summary`)
      .set('Cookie', cookie)

    expect(response.status).toBe(200)
    expect(response.body.snapshotHash).toMatch(/^[0-9a-f]{64}$/)
    expect(response.body).not.toHaveProperty('entries')
  })

  it('reports a missing pool as not found', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie } = await superAdmin()

    const response = await poolOf(communeDraw.id, cookie)

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('POOL_NOT_FOUND')
  })

  it('exposes no participant identity in a pool listing', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie } = await superAdmin()
    await freezeVia(communeDraw.id, cookie)

    const body = JSON.stringify((await poolOf(communeDraw.id, cookie)).body)

    for (const forbidden of ['Pool Subject', '1980-04-12', 'participantId', 'applicationId']) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('refuses an unauthenticated caller everywhere', async () => {
    const communeDraw = await frozenCommuneDraw()

    for (const response of [
      await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/validate-pool`),
      await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/freeze-pool`),
      await request(app).get(`/api/admin/commune-draws/${communeDraw.id}/pool`),
      await request(app).get(`/api/admin/commune-draws/${communeDraw.id}/pool/summary`),
    ]) {
      expect(response.status).toBe(401)
    }
  })

  it('exposes no pool route publicly', async () => {
    const communeDraw = await frozenCommuneDraw()
    const { cookie } = await superAdmin()
    await freezeVia(communeDraw.id, cookie)

    // Nothing outside /api/admin serves pool data at all.
    const response = await request(app).get(`/api/commune-draws/${communeDraw.id}/pool`)
    expect(response.status).toBe(404)
  })
})
