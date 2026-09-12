import { totalDrawSelections } from '@hajj-lottery/shared'
import {
  PrismaClient,
  type Application,
  type CommuneDraw,
  type DrawReserve,
  type DrawResult,
  type DrawWinner,
  type DrawYear,
} from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { auditActor, AuditService, type AuditEventInput } from '../src/services/audit.service.js'
import { drawConfigurationService } from '../src/services/draw-configuration.service.js'
import { drawExecutionService } from '../src/services/draw-execution.service.js'
import { drawPoolService } from '../src/services/draw-pool.service.js'
import { ReserveService } from '../src/services/reserve.service.js'
import { weightService } from '../src/services/weight.service.js'
import { AdminRole, createAdminAndSignIn, ensureTestGeography, type TestGeography } from './helpers/admins.js'

/**
 * Reserves, abandonment and replacement.
 *
 * The domain rule under test: a commune with N places draws 2N entries in one
 * continuous weighted sample, the first N as winners and the next N as an
 * ordered reserve list. When a winner gives up a place, the next reserve is
 * called for it — without re-running the lottery, without reordering anything,
 * and without the original result changing in any respect.
 *
 * Three properties recur through the whole file, and most of what follows is one
 * of them said precisely:
 *
 *   the original draw is a record and never moves
 *   a reserve is not a winner until they accept, and then fully is
 *   nothing is ever half-done
 */

const prisma = new PrismaClient()

let app: ReturnType<typeof createApp>
let geo: TestGeography
let drawYear: DrawYear

/** Well away from the calendar year, so nothing collides with other suites. */
const YEAR = 2147

/** The same number for everybody: it is a verification value, not an identity. */
const PHONE = '0555123456'

let nextId = 0
function nationalId(): string {
  nextId += 1
  return `53000000000000${String(nextId).padStart(4, '0')}`
}

// --- Fixtures ---------------------------------------------------------------

interface EntrySpec {
  paired?: boolean
}

async function register(
  commune: { id: string; wilayaId: string },
  options: EntrySpec = {},
): Promise<Application> {
  const body: Record<string, unknown> = {
    entryType: options.paired ? 'PAIRED' : 'SINGLE',
    wilayaId: commune.wilayaId,
    communeId: commune.id,
    // A number, because the public status lookup verifies against one and this
    // suite has to be able to ask what a reserve is told about themselves.
    primary: {
      nationalId: nationalId(),
      fullName: 'Reserve Subject',
      dob: '1980-04-12',
      // A pair is a female primary and her male Mahram; single stays male so
      // the Mahram rule never enters into it.
      gender: options.paired ? 'FEMALE' : 'MALE',
      phoneNumber: PHONE,
    },
  }
  if (options.paired) {
    body.secondary = {
      nationalId: nationalId(),
      fullName: 'Reserve Partner',
      dob: '1982-06-30',
      gender: 'MALE',
    }
  }

  const response = await request(app).post('/api/applications').send(body)
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`)
  }

  const application = await prisma.application.findFirstOrThrow({
    where: { applicationReference: response.body.applicationReference },
  })
  await weightService.freezeApplicationWeight(application.id)
  return application
}

interface DrawnCommune {
  communeDraw: CommuneDraw
  result: DrawResult
  winners: DrawWinner[]
  reserves: DrawReserve[]
}

/**
 * A commune draw carried all the way through execution.
 *
 * Defaults to exactly twice the allocation, which is the smallest pool a draw
 * can now run against: N winners and N reserves come out of the same sample, and
 * a pool that cannot supply both is refused rather than drawn short.
 */
async function drawn(
  allocatedSpots = 2,
  entries: EntrySpec[] = Array.from({ length: totalDrawSelections(allocatedSpots) }, () => ({})),
  commune: { id: string; wilayaId: string } = { id: geo.communeA1.id, wilayaId: geo.wilayaA.id },
): Promise<DrawnCommune> {
  const communeDraw = await drawConfigurationService.createCommuneDraw({
    drawYearId: drawYear.id,
    communeId: commune.id,
    allocatedSpots,
  })

  for (const entry of entries) await register(commune, entry)

  await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
  await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
  await drawPoolService.freeze(communeDraw.id)
  await drawExecutionService.execute(communeDraw.id)

  return {
    communeDraw,
    result: await prisma.drawResult.findUniqueOrThrow({ where: { communeDrawId: communeDraw.id } }),
    winners: await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } }),
    reserves: await prisma.drawReserve.findMany({ orderBy: { reservePosition: 'asc' } }),
  }
}

const superAdmin = () => createAdminAndSignIn(app, prisma, { role: AdminRole.SUPER_ADMIN })
const wilayaAdmin = (wilayaId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.WILAYA_ADMIN, wilayaId })
const communeAdmin = (wilayaId: string, communeId: string) =>
  createAdminAndSignIn(app, prisma, { role: AdminRole.COMMUNE_ADMIN, wilayaId, communeId })

const abandonVia = (drawId: string, selectionOrder: number, cookie: string) =>
  request(app)
    .post(`/api/admin/commune-draws/${drawId}/winners/${selectionOrder}/abandon`)
    .set('Cookie', cookie)

const callVia = (drawId: string, position: number, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${drawId}/reserves/${position}/call`).set('Cookie', cookie)

const acceptVia = (drawId: string, position: number, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${drawId}/reserves/${position}/accept`).set('Cookie', cookie)

const declineVia = (drawId: string, position: number, cookie: string) =>
  request(app).post(`/api/admin/commune-draws/${drawId}/reserves/${position}/decline`).set('Cookie', cookie)

const resultVia = (drawId: string, cookie: string) =>
  request(app).get(`/api/admin/commune-draws/${drawId}/result`).set('Cookie', cookie)

const REASON = { reason: 'VOLUNTARY_WITHDRAWAL', explanation: 'Withdrew in person at the daira office.' }

/** Records an abandonment and calls the next reserve — the two-step preamble. */
async function vacate(
  drawId: string,
  selectionOrder: number,
  cookie: string,
): Promise<{ reservePosition: number }> {
  const abandoned = await abandonVia(drawId, selectionOrder, cookie).send(REASON)
  if (abandoned.status !== 201) {
    throw new Error(`Abandonment failed: ${abandoned.status} ${JSON.stringify(abandoned.body)}`)
  }

  const next = await prisma.drawReserve.findFirstOrThrow({
    where: { drawResult: { communeDrawId: drawId }, status: 'WAITING' },
    orderBy: { reservePosition: 'asc' },
  })

  const called = await callVia(drawId, next.reservePosition, cookie).send({
    winnerSelectionOrder: selectionOrder,
  })
  if (called.status !== 200) {
    throw new Error(`Call failed: ${called.status} ${JSON.stringify(called.body)}`)
  }

  return { reservePosition: next.reservePosition }
}

/** Everyone a reserve entry wins for: one for a single entry, two for a pair. */
function participantsOf(entry: { primaryParticipantId: string; secondaryParticipantId: string | null }) {
  return [entry.primaryParticipantId, entry.secondaryParticipantId].filter((id): id is string => id !== null)
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

// --- The original draw ------------------------------------------------------

describe('a draw produces winners and an ordered reserve list', () => {
  it('selects twice the allocation: N winners, then N reserves', async () => {
    const { result, winners, reserves } = await drawn(
      3,
      Array.from({ length: 9 }, () => ({})),
    )

    expect(result.winnerCount).toBe(3)
    expect(winners.map((winner) => winner.selectionOrder)).toEqual([1, 2, 3])
    expect(reserves.map((reserve) => reserve.reservePosition)).toEqual([1, 2, 3])
    // The reserve half begins where the winners stop, in one unbroken sequence.
    expect(reserves.map((reserve) => reserve.selectionOrder)).toEqual([4, 5, 6])
    expect(await prisma.drawSelectionEvent.count()).toBe(6)
  })

  it('draws each entry into one half of the draw and never both', async () => {
    const { winners, reserves } = await drawn(
      3,
      Array.from({ length: 7 }, () => ({})),
    )

    const drawnEntries = [...winners, ...reserves].map((entry) => entry.drawPoolEntryId)
    expect(new Set(drawnEntries).size).toBe(drawnEntries.length)
  })

  it('leaves every reserve a non-winner: no place, no archive, no exclusion', async () => {
    const { reserves } = await drawn(2)

    for (const reserve of reserves) {
      expect(reserve.status).toBe('WAITING')
      expect(reserve.replacesDrawWinnerId).toBeNull()
      expect(reserve.calledAt).toBeNull()

      for (const participantId of participantsOf(reserve)) {
        const participant = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })
        expect(participant.hasWonHajj).toBe(false)
        expect(await prisma.winnerArchive.count({ where: { participantId } })).toBe(0)

        // They took part and did not win — which is what grows their priority
        // for next year, and is the truthful record of a draw they lost.
        const history = await prisma.participationHistory.findFirstOrThrow({
          where: { participantId, drawYear: YEAR },
        })
        expect(history.participated).toBe(true)
        expect(history.won).toBe(false)
      }
    }
  })

  it('refuses to draw at all when the pool cannot cover the reserves', async () => {
    const communeDraw = await drawConfigurationService.createCommuneDraw({
      drawYearId: drawYear.id,
      communeId: geo.communeA1.id,
      allocatedSpots: 3,
    })
    // Five entries for three places: enough winners, not enough reserves.
    for (let index = 0; index < 5; index += 1) {
      await register({ id: geo.communeA1.id, wilayaId: geo.wilayaA.id })
    }
    await drawConfigurationService.updateCommuneDraw(communeDraw.id, { status: 'READY' })
    await drawConfigurationService.updateDrawYearStatus(drawYear.id, 'REGISTRATION_CLOSED')
    await drawPoolService.freeze(communeDraw.id)

    await expect(drawExecutionService.execute(communeDraw.id)).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_DRAW_ENTRIES',
    })

    // Not three winners and two reserves: which of the three places went
    // unprotected would have been decided by nobody.
    expect(await prisma.drawResult.count()).toBe(0)
    expect(await prisma.drawReserve.count()).toBe(0)
    expect((await prisma.communeDraw.findUniqueOrThrow({ where: { id: communeDraw.id } })).status).toBe(
      'LOCKED',
    )
  })
})

// --- Abandonment ------------------------------------------------------------

describe('recording that a winner gave up their place', () => {
  it('records the reason, the explanation and who took the decision', async () => {
    const { communeDraw, winners } = await drawn(2)
    const { user, cookie } = await superAdmin()

    const response = await abandonVia(communeDraw.id, 1, cookie).send({
      reason: 'MEDICAL',
      explanation: 'Unfit to travel; certificate filed at the wilaya health directorate.',
    })

    expect(response.status).toBe(201)
    const abandonment = await prisma.winnerAbandonment.findFirstOrThrow()
    expect(abandonment.drawWinnerId).toBe(winners[0]?.id)
    expect(abandonment.reason).toBe('MEDICAL')
    expect(abandonment.recordedByUserId).toBe(user.id)

    // And the outcome is derived from that record's existence, not from a
    // column somebody could set on the winner itself.
    expect(response.body.winners[0]).toMatchObject({ selectionOrder: 1, outcome: 'ABANDONED' })
    expect(response.body.winners[1]).toMatchObject({ outcome: 'ACTIVE' })
    expect(response.body.activeWinnerCount).toBe(1)
  })

  it('refuses a blank explanation, and one that is only whitespace', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    for (const explanation of ['', '   ', '\n\t ']) {
      const response = await abandonVia(communeDraw.id, 1, cookie).send({
        reason: 'OTHER',
        explanation,
      })
      expect(response.status).toBe(400)
    }

    expect((await abandonVia(communeDraw.id, 1, cookie).send({ reason: 'OTHER' })).status).toBe(400)
    // An unrecognised category is refused too: the vocabulary is closed.
    expect(
      (await abandonVia(communeDraw.id, 1, cookie).send({ reason: 'CHANGED_MIND', explanation: 'x' })).status,
    ).toBe(400)
    expect(await prisma.winnerAbandonment.count()).toBe(0)
  })

  it('leaves the abandoned winner a winner: archived, excluded, still selected', async () => {
    const { communeDraw, winners } = await drawn(2)
    const { cookie } = await superAdmin()
    const winner = winners[0]
    if (!winner) throw new Error('Expected a winner')

    const archiveBefore = await prisma.winnerArchive.findMany({ orderBy: { id: 'asc' } })
    const applicationBefore = await prisma.application.findUniqueOrThrow({
      where: { id: winner.applicationId },
    })

    await abandonVia(communeDraw.id, 1, cookie).send(REASON)

    // A place that was awarded and given up was still awarded. Nothing here
    // un-archives anybody, and there is no operation anywhere that turns a
    // lifetime exclusion back off.
    for (const participantId of participantsOf(winner)) {
      const participant = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })
      expect(participant.hasWonHajj).toBe(true)
    }
    expect(await prisma.winnerArchive.findMany({ orderBy: { id: 'asc' } })).toEqual(archiveBefore)
    expect((await prisma.application.findUniqueOrThrow({ where: { id: winner.applicationId } })).status).toBe(
      applicationBefore.status,
    )
    expect(applicationBefore.status).toBe('SELECTED')

    // Their year in the ledger is unchanged: they won that draw.
    const history = await prisma.participationHistory.findFirstOrThrow({
      where: { participantId: winner.primaryParticipantId, drawYear: YEAR },
    })
    expect(history.won).toBe(true)
  })

  it('reruns nothing and reorders nothing', async () => {
    const { communeDraw, winners, reserves } = await drawn(
      3,
      Array.from({ length: 8 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    const eventsBefore = await prisma.drawSelectionEvent.findMany({ orderBy: { selectionOrder: 'asc' } })
    const resultBefore = await prisma.drawResult.findFirstOrThrow()

    await abandonVia(communeDraw.id, 2, cookie).send(REASON)

    expect(await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } })).toEqual(winners)
    expect(await prisma.drawSelectionEvent.findMany({ orderBy: { selectionOrder: 'asc' } })).toEqual(
      eventsBefore,
    )
    expect(await prisma.drawResult.findFirstOrThrow()).toEqual(resultBefore)

    // The reserve list keeps the order the lottery gave it — the abandonment
    // does not promote, reshuffle or even touch it.
    const after = await prisma.drawReserve.findMany({ orderBy: { reservePosition: 'asc' } })
    expect(after.map((reserve) => reserve.drawPoolEntryId)).toEqual(
      reserves.map((reserve) => reserve.drawPoolEntryId),
    )
    expect(after.every((reserve) => reserve.status === 'WAITING')).toBe(true)
  })

  it('applies to a paired winning application as a whole', async () => {
    const { communeDraw, winners } = await drawn(1, [{ paired: true }, { paired: true }])
    const { cookie } = await superAdmin()
    const winner = winners[0]
    if (!winner?.secondaryParticipantId) throw new Error('Expected a paired winner')

    await abandonVia(communeDraw.id, 1, cookie).send(REASON)

    // One entry, one abandonment. There is no way to record half of one, and
    // the next reserve replaces the whole application rather than one traveller.
    expect(await prisma.winnerAbandonment.count()).toBe(1)
    for (const participantId of participantsOf(winner)) {
      expect((await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).hasWonHajj).toBe(
        true,
      )
    }
  })

  it('records it once: a second attempt conflicts and changes nothing', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    expect((await abandonVia(communeDraw.id, 1, cookie).send(REASON)).status).toBe(201)
    const again = await abandonVia(communeDraw.id, 1, cookie).send({
      reason: 'DEATH',
      explanation: 'A different account of the same place.',
    })

    expect(again.status).toBe(409)
    expect(again.body.code).toBe('WINNER_ALREADY_ABANDONED')
    const abandonment = await prisma.winnerAbandonment.findFirstOrThrow()
    expect(abandonment.reason).toBe('VOLUNTARY_WITHDRAWAL')
    expect(await prisma.winnerAbandonment.count()).toBe(1)
  })

  it('does not know about a selection order this draw never had', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    const response = await abandonVia(communeDraw.id, 99, cookie).send(REASON)
    expect(response.status).toBe(404)
    expect(response.body.code).toBe('DRAW_WINNER_NOT_FOUND')
  })

  it('is audited, with the explanation as the reason and nobody named', async () => {
    const { communeDraw, result } = await drawn(2)
    const { user, cookie } = await superAdmin()

    await abandonVia(communeDraw.id, 1, cookie).send(REASON)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'WINNER_ABANDONED' } })
    expect(entry).toMatchObject({
      actorUserId: user.id,
      targetType: 'DRAW_WINNER',
      communeId: geo.communeA1.id,
      wilayaId: geo.wilayaA.id,
      reason: REASON.explanation,
    })
    expect(entry.metadata).toMatchObject({
      drawResultId: result.id,
      selectionOrder: 1,
      abandonmentReason: 'VOLUNTARY_WITHDRAWAL',
    })
    // Identifiers and counts, never a person.
    expect(JSON.stringify(entry)).not.toContain('Reserve Subject')
  })

  it('cannot be edited or retracted, at the database', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await abandonVia(communeDraw.id, 1, cookie).send(REASON)
    const abandonment = await prisma.winnerAbandonment.findFirstOrThrow()

    await expect(
      prisma.winnerAbandonment.update({ where: { id: abandonment.id }, data: { reason: 'OTHER' } }),
    ).rejects.toThrow()
    await expect(prisma.winnerAbandonment.delete({ where: { id: abandonment.id } })).rejects.toThrow()
  })
})

// --- Calling the next reserve ----------------------------------------------

describe('calling a reserve', () => {
  it('refuses until the place has actually been given up', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    const response = await callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 1 })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('WINNER_NOT_ABANDONED')
    expect((await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })).status).toBe(
      'WAITING',
    )
  })

  it('offers the place to reserve #1, and records which place it is', async () => {
    const { communeDraw, winners } = await drawn(2)
    const { user, cookie } = await superAdmin()
    await abandonVia(communeDraw.id, 2, cookie).send(REASON)

    const response = await callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 2 })

    expect(response.status).toBe(200)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    expect(reserve.status).toBe('CALLED')
    expect(reserve.replacesDrawWinnerId).toBe(winners[1]?.id)
    expect(reserve.calledAt).not.toBeNull()
    expect(reserve.decidedAt).toBeNull()
    expect(response.body.reserves[0]).toMatchObject({
      reservePosition: 1,
      status: 'CALLED',
      replacesSelectionOrder: 2,
    })

    // Still not a winner. Being asked is a question, not a place.
    for (const participantId of participantsOf(reserve)) {
      expect((await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).hasWonHajj).toBe(
        false,
      )
    }
    expect(response.body.activeWinnerCount).toBe(1)

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'RESERVE_CALLED' } })
    expect(entry).toMatchObject({ actorUserId: user.id, targetType: 'DRAW_RESERVE', targetId: reserve.id })
    expect(entry.metadata).toMatchObject({ reservePosition: 1, replacesSelectionOrder: 2 })
  })

  it('will not reach past a waiting reserve, whatever the request asks for', async () => {
    const { communeDraw } = await drawn(
      3,
      Array.from({ length: 6 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    await abandonVia(communeDraw.id, 1, cookie).send(REASON)

    // The ordering came from the lottery, so picking within it would be picking
    // a winner — whatever the position in the path says.
    for (const position of [2, 3]) {
      const response = await callVia(communeDraw.id, position, cookie).send({ winnerSelectionOrder: 1 })
      expect(response.status).toBe(409)
      expect(response.body.code).toBe('RESERVE_OUT_OF_ORDER')
    }

    expect(await prisma.drawReserve.count({ where: { status: 'CALLED' } })).toBe(0)
  })

  it('will not offer a second place to a reserve who is already holding an offer', async () => {
    const { communeDraw } = await drawn(
      3,
      Array.from({ length: 6 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)

    // A second vacancy exists, and reserve #1 is not available for it — they
    // have already been asked about the first. The refusal names who is next,
    // because an official who reached for #1 has made a mistake worth telling
    // them how to correct.
    await abandonVia(communeDraw.id, 2, cookie).send(REASON)
    const response = await callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 2 })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('RESERVE_OUT_OF_ORDER')
    expect(await prisma.drawReserve.count({ where: { status: 'CALLED' } })).toBe(1)

    // Reserve #2 is the one who may be called for it.
    const called = await callVia(communeDraw.id, 2, cookie).send({ winnerSelectionOrder: 2 })
    expect(called.status).toBe(200)
    expect(await prisma.drawReserve.count({ where: { status: 'CALLED' } })).toBe(2)
  })

  it('refuses a second reserve for the same vacated place', async () => {
    const { communeDraw } = await drawn(
      3,
      Array.from({ length: 6 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)

    const response = await callVia(communeDraw.id, 2, cookie).send({ winnerSelectionOrder: 1 })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PLACE_ALREADY_FILLED')
  })

  it('reports honestly when the reserve list has run out', async () => {
    const { communeDraw } = await drawn(1)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    await declineVia(communeDraw.id, 1, cookie).send({ explanation: 'Declined by telephone.' })

    const response = await callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 1 })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('NO_RESERVE_AVAILABLE')
  })
})

// --- Refusal ----------------------------------------------------------------

describe('a reserve who refuses the place', () => {
  it('is recorded, with a reason, and is not asked again', async () => {
    const { communeDraw } = await drawn(
      3,
      Array.from({ length: 6 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)

    const declined = await declineVia(communeDraw.id, 1, cookie).send({
      explanation: 'Unable to travel this year; recorded at the commune office.',
    })

    expect(declined.status).toBe(200)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    expect(reserve.status).toBe('DECLINED')
    expect(reserve.decidedAt).not.toBeNull()
    // The record still shows who was asked and for what.
    expect(reserve.replacesDrawWinnerId).not.toBeNull()

    // Nobody gained or lost anything by the refusal.
    for (const participantId of participantsOf(reserve)) {
      expect((await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).hasWonHajj).toBe(
        false,
      )
    }

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'RESERVE_DECLINED' } })
    expect(entry.reason).toContain('Unable to travel')
  })

  it('lets the next reserve be called for the same place', async () => {
    const { communeDraw, winners } = await drawn(
      3,
      Array.from({ length: 6 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    await declineVia(communeDraw.id, 1, cookie).send({ explanation: 'Declined by telephone.' })

    const called = await callVia(communeDraw.id, 2, cookie).send({ winnerSelectionOrder: 1 })

    expect(called.status).toBe(200)
    const second = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 2 } })
    expect(second.status).toBe('CALLED')
    expect(second.replacesDrawWinnerId).toBe(winners[0]?.id)
    // And reserve #1 stays declined: refusing is an answer, not a turn passed.
    expect((await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })).status).toBe(
      'DECLINED',
    )
  })

  it('cannot be recorded for a reserve nobody has called', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    const response = await declineVia(communeDraw.id, 1, cookie).send({ explanation: 'Not asked yet.' })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('RESERVE_NOT_CALLED')
  })

  it('requires an explanation', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)

    expect((await declineVia(communeDraw.id, 1, cookie).send({ explanation: '  ' })).status).toBe(400)
    expect((await declineVia(communeDraw.id, 1, cookie).send({})).status).toBe(400)
    expect((await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })).status).toBe(
      'CALLED',
    )
  })
})

// --- Promotion --------------------------------------------------------------

describe('a reserve who accepts becomes a winner', () => {
  it('is archived, excluded, finalized and audited, in one act', async () => {
    const { communeDraw, result, winners } = await drawn(2)
    const { user, cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    const accepted = await acceptVia(communeDraw.id, 1, cookie)

    expect(accepted.status).toBe(200)
    expect((await prisma.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } })).status).toBe(
      'ACCEPTED',
    )

    const archive = await prisma.winnerArchive.findFirstOrThrow({
      where: { participantId: reserve.primaryParticipantId },
    })
    expect(archive.source).toBe('RESERVE_REPLACEMENT')
    expect(archive.drawResultId).toBe(result.id)
    // The draw's moment, not this one: they were selected by that lottery, and
    // being called is not a second selection.
    expect(archive.drawnAt.toISOString()).toBe(result.completedAt.toISOString())

    expect(
      (await prisma.participant.findUniqueOrThrow({ where: { id: reserve.primaryParticipantId } }))
        .hasWonHajj,
    ).toBe(true)
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: reserve.applicationId } })).status,
    ).toBe('SELECTED')

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'RESERVE_PROMOTED' } })
    expect(entry).toMatchObject({ actorUserId: user.id, targetType: 'DRAW_RESERVE', targetId: reserve.id })
    expect(entry.metadata).toMatchObject({ reservePosition: 1, replacesSelectionOrder: 1 })
    expect(winners).toHaveLength(2)
  })

  it('corrects the ledger year it already has, rather than adding one', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    const before = await prisma.participationHistory.count({ where: { drawYear: YEAR } })

    await acceptVia(communeDraw.id, 1, cookie)

    // One participation fact per person per year. They took part once; what
    // changed is the outcome, and a second row would double-count the year for
    // anybody reading the ledger.
    expect(await prisma.participationHistory.count({ where: { drawYear: YEAR } })).toBe(before)
    const history = await prisma.participationHistory.findMany({
      where: { participantId: { in: participantsOf(reserve) }, drawYear: YEAR },
    })
    expect(history).toHaveLength(participantsOf(reserve).length)
    for (const record of history) {
      expect(record.participated).toBe(true)
      expect(record.won).toBe(true)
      expect(record.source).toBe('APPLICATION')
    }
  })

  it('makes both travellers of a paired reserve winners, or neither', async () => {
    const { communeDraw } = await drawn(1, [{ paired: true }, { paired: true }])
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    expect(reserve.secondaryParticipantId).not.toBeNull()

    await acceptVia(communeDraw.id, 1, cookie)

    // One reserve position, one winning application, two lifetime winners.
    for (const participantId of participantsOf(reserve)) {
      expect((await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })).hasWonHajj).toBe(
        true,
      )
      expect(await prisma.winnerArchive.count({ where: { participantId } })).toBe(1)
    }
    expect(await prisma.winnerArchive.count()).toBe(4)
    expect(await prisma.drawWinner.count()).toBe(1)
  })

  it('cannot be promoted twice', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    await acceptVia(communeDraw.id, 1, cookie)

    const again = await acceptVia(communeDraw.id, 1, cookie)

    expect(again.status).toBe(409)
    expect(again.body.code).toBe('RESERVE_NOT_CALLED')
    expect(await prisma.winnerArchive.count({ where: { source: 'RESERVE_REPLACEMENT' } })).toBe(1)
  })

  it('cannot be promoted without being called', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    const response = await acceptVia(communeDraw.id, 2, cookie)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('RESERVE_NOT_CALLED')
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(2)
  })

  it('refuses somebody who is already a lifetime winner, and repairs nothing', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    // A win recorded elsewhere between the call and the answer.
    await prisma.participant.update({
      where: { id: reserve.primaryParticipantId },
      data: { hasWonHajj: true },
    })

    const response = await acceptVia(communeDraw.id, 1, cookie)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PARTICIPANT_ALREADY_WON')
    // Nothing is fixed automatically: which of the two records is the mistake is
    // a question for the people who made them.
    expect((await prisma.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } })).status).toBe('CALLED')
    expect(await prisma.winnerArchive.count({ where: { source: 'RESERVE_REPLACEMENT' } })).toBe(0)
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: reserve.applicationId } })).status,
    ).toBe('RESERVE')
  })

  it('refuses somebody who already holds a winner archive row', async () => {
    const { communeDraw, result, winners } = await drawn(2)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    await prisma.winnerArchive.create({
      data: {
        participantId: reserve.primaryParticipantId,
        drawYear: YEAR,
        communeId: geo.communeA1.id,
        drawResultId: result.id,
        drawPoolEntryId: winners[0]?.drawPoolEntryId ?? '',
        drawnAt: new Date(),
      },
    })

    const response = await acceptVia(communeDraw.id, 1, cookie)

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PARTICIPANT_ALREADY_WON')
    expect((await prisma.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } })).status).toBe('CALLED')
  })

  it('rolls the whole promotion back when one of a pair cannot be promoted', async () => {
    const { communeDraw } = await drawn(1, [{ paired: true }, { paired: true }])
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    const partner = reserve.secondaryParticipantId
    if (!partner) throw new Error('Expected a paired reserve')

    await prisma.participant.update({ where: { id: partner }, data: { hasWonHajj: true } })

    const response = await acceptVia(communeDraw.id, 1, cookie)

    expect(response.status).toBe(409)
    // Not one traveller promoted and the other left behind. A pair is one entry.
    expect(
      (await prisma.participant.findUniqueOrThrow({ where: { id: reserve.primaryParticipantId } }))
        .hasWonHajj,
    ).toBe(false)
    expect(await prisma.winnerArchive.count({ where: { source: 'RESERVE_REPLACEMENT' } })).toBe(0)
    expect((await prisma.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } })).status).toBe('CALLED')
  })

  it('leaves the original draw exactly as it was', async () => {
    const { communeDraw, result, winners, reserves } = await drawn(2)
    const { cookie } = await superAdmin()
    const eventsBefore = await prisma.drawSelectionEvent.findMany({ orderBy: { selectionOrder: 'asc' } })
    const poolBefore = await prisma.drawPoolEntry.findMany({ orderBy: { id: 'asc' } })

    await vacate(communeDraw.id, 1, cookie)
    await acceptVia(communeDraw.id, 1, cookie)

    // The lottery's record, untouched. A promoted reserve does not become
    // "winner #1": they stay reserve #1 of this draw and separately hold a place.
    expect(await prisma.drawResult.findFirstOrThrow()).toEqual(result)
    expect(await prisma.drawWinner.findMany({ orderBy: { selectionOrder: 'asc' } })).toEqual(winners)
    expect(await prisma.drawSelectionEvent.findMany({ orderBy: { selectionOrder: 'asc' } })).toEqual(
      eventsBefore,
    )
    expect(await prisma.drawPoolEntry.findMany({ orderBy: { id: 'asc' } })).toEqual(poolBefore)

    const promoted = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    expect(promoted.reservePosition).toBe(reserves[0]?.reservePosition)
    expect(promoted.selectionOrder).toBe(reserves[0]?.selectionOrder)
    expect(promoted.drawPoolEntryId).toBe(reserves[0]?.drawPoolEntryId)
  })

  it('replaces a place rather than adding one', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    expect((await resultVia(communeDraw.id, cookie)).body.activeWinnerCount).toBe(2)

    await vacate(communeDraw.id, 1, cookie)
    const midway = await resultVia(communeDraw.id, cookie)
    // One place is open while nobody has answered.
    expect(midway.body.activeWinnerCount).toBe(1)

    const after = await acceptVia(communeDraw.id, 1, cookie)

    expect(after.body.winnerCount).toBe(2)
    expect(after.body.activeWinnerCount).toBe(2)
    // Three people hold a lifetime win from a two-place draw: the two original
    // winners — an abandoned place was still awarded — and the replacement.
    expect(await prisma.winnerArchive.count()).toBe(3)
    expect(await prisma.drawWinner.count()).toBe(2)
  })
})

// --- Concurrency ------------------------------------------------------------

describe('two administrators acting at once', () => {
  it('records one abandonment, whichever arrives first', async () => {
    const { communeDraw, winners } = await drawn(2)
    const { cookie } = await superAdmin()
    const { cookie: other } = await superAdmin()

    const outcomes = await Promise.allSettled([
      abandonVia(communeDraw.id, 1, cookie).send(REASON),
      abandonVia(communeDraw.id, 1, other).send({ reason: 'DEATH', explanation: 'Second account.' }),
    ])

    const accepted = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.status === 201,
    )
    expect(accepted).toHaveLength(1)
    expect(await prisma.winnerAbandonment.count({ where: { drawWinnerId: winners[0]?.id } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'WINNER_ABANDONED' } })).toBe(1)
  })

  it('calls one reserve for one vacated place', async () => {
    const { communeDraw } = await drawn(
      3,
      Array.from({ length: 6 }, () => ({})),
    )
    const { cookie } = await superAdmin()
    const { cookie: other } = await superAdmin()
    await abandonVia(communeDraw.id, 1, cookie).send(REASON)

    const outcomes = await Promise.allSettled([
      callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 1 }),
      callVia(communeDraw.id, 1, other).send({ winnerSelectionOrder: 1 }),
    ])

    const accepted = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.status === 200,
    )
    expect(accepted).toHaveLength(1)
    expect(await prisma.drawReserve.count({ where: { status: 'CALLED' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'RESERVE_CALLED' } })).toBe(1)
  })

  it('promotes a reserve once, however many people press the button', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    const { cookie: other } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)

    const outcomes = await Promise.allSettled([
      acceptVia(communeDraw.id, 1, cookie),
      acceptVia(communeDraw.id, 1, other),
    ])

    const accepted = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.status === 200,
    )
    expect(accepted).toHaveLength(1)
    expect(await prisma.winnerArchive.count({ where: { source: 'RESERVE_REPLACEMENT' } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { action: 'RESERVE_PROMOTED' } })).toBe(1)
    expect(await prisma.winnerArchive.count()).toBe(3)
  })

  it('leaves the database consistent after a burst of overlapping operations', async () => {
    const { communeDraw } = await drawn(
      3,
      Array.from({ length: 8 }, () => ({})),
    )
    const { cookie } = await superAdmin()

    await Promise.allSettled([
      abandonVia(communeDraw.id, 1, cookie).send(REASON),
      abandonVia(communeDraw.id, 2, cookie).send(REASON),
      abandonVia(communeDraw.id, 1, cookie).send(REASON),
    ])
    await Promise.allSettled([
      callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 1 }),
      callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 2 }),
      callVia(communeDraw.id, 2, cookie).send({ winnerSelectionOrder: 2 }),
    ])
    await Promise.allSettled([acceptVia(communeDraw.id, 1, cookie), acceptVia(communeDraw.id, 2, cookie)])

    const winners = await prisma.drawWinner.count()
    const abandoned = await prisma.winnerAbandonment.count()
    const promoted = await prisma.drawReserve.count({ where: { status: 'ACCEPTED' } })

    // The invariants, whatever order the requests happened to resolve in.
    expect(winners).toBe(3)
    expect(promoted).toBeLessThanOrEqual(abandoned)
    expect(winners - abandoned + promoted).toBeLessThanOrEqual(3)
    expect(await prisma.winnerArchive.count()).toBe(3 + promoted)
    expect(await prisma.participant.count({ where: { hasWonHajj: true } })).toBe(3 + promoted)

    // Every promoted reserve is a lifetime winner, and no waiting one is.
    for (const reserve of await prisma.drawReserve.findMany()) {
      for (const participantId of participantsOf(reserve)) {
        const participant = await prisma.participant.findUniqueOrThrow({ where: { id: participantId } })
        expect(participant.hasWonHajj).toBe(reserve.status === 'ACCEPTED')
      }
    }
  })
})

// --- Transactions -----------------------------------------------------------

describe('nothing survives a failed promotion', () => {
  /** An audit service that fails at the last moment, after every other write. */
  class FailingAudit extends AuditService {
    override async record(_input: AuditEventInput): Promise<never> {
      throw new Error('audit write failed')
    }
  }

  it('rolls back the archive, the exclusion and the ledger when the audit fails', async () => {
    const { communeDraw } = await drawn(2)
    const { user, cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    const failing = new ReserveService(prisma, new FailingAudit(prisma))
    const scoped = await prisma.communeDraw.findUniqueOrThrow({
      where: { id: communeDraw.id },
      include: { drawYear: true, commune: { include: { wilaya: true } } },
    })

    await expect(failing.promoteReserve(scoped, 1, auditActor(user))).rejects.toThrow(/audit write failed/)

    // A promotion whose record of who authorised it did not survive is not a
    // promotion. Every part of it unwinds together.
    expect((await prisma.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } })).status).toBe('CALLED')
    expect(await prisma.winnerArchive.count({ where: { source: 'RESERVE_REPLACEMENT' } })).toBe(0)
    expect(
      (await prisma.participant.findUniqueOrThrow({ where: { id: reserve.primaryParticipantId } }))
        .hasWonHajj,
    ).toBe(false)
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: reserve.applicationId } })).status,
    ).toBe('RESERVE')
    expect(
      (
        await prisma.participationHistory.findFirstOrThrow({
          where: { participantId: reserve.primaryParticipantId, drawYear: YEAR },
        })
      ).won,
    ).toBe(false)
  })

  it('rolls back an abandonment whose audit record fails', async () => {
    const { communeDraw } = await drawn(2)
    const { user } = await superAdmin()

    const failing = new ReserveService(prisma, new FailingAudit(prisma))
    const scoped = await prisma.communeDraw.findUniqueOrThrow({
      where: { id: communeDraw.id },
      include: { drawYear: true, commune: { include: { wilaya: true } } },
    })

    await expect(
      failing.recordAbandonment(scoped, 1, { reason: 'OTHER', explanation: 'x' }, auditActor(user)),
    ).rejects.toThrow(/audit write failed/)

    expect(await prisma.winnerAbandonment.count()).toBe(0)
  })
})

// --- Immutability -----------------------------------------------------------

describe('the original selection behind a reserve is immutable', () => {
  it('refuses to move a reserve to another position or place in the draw', async () => {
    await drawn(2)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    for (const data of [
      { reservePosition: 2 },
      { selectionOrder: 1 },
      { selectedWeight: 900 },
      { drawPoolEntryId: (await prisma.drawWinner.findFirstOrThrow()).drawPoolEntryId },
    ]) {
      await expect(prisma.drawReserve.update({ where: { id: reserve.id }, data })).rejects.toThrow()
    }

    const after = await prisma.drawReserve.findUniqueOrThrow({ where: { id: reserve.id } })
    expect(after).toEqual(reserve)
  })

  it('refuses to delete a reserve, so the list can never have a gap', async () => {
    await drawn(2)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    await expect(prisma.drawReserve.delete({ where: { id: reserve.id } })).rejects.toThrow()
    expect(await prisma.drawReserve.count()).toBe(2)
  })

  it('refuses a lifecycle jump the workflow does not allow', async () => {
    await drawn(2)
    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })

    // Straight to accepted, with nobody having called them and no place to fill.
    await expect(
      prisma.drawReserve.update({ where: { id: reserve.id }, data: { status: 'ACCEPTED' } }),
    ).rejects.toThrow()
  })

  it('refuses a reserve position outside the allocation, at the database', async () => {
    // Five entries for two places, so one is left undrawn and can stand in for
    // a row somebody tries to add by hand.
    const { result, winners, reserves } = await drawn(
      2,
      Array.from({ length: 5 }, () => ({})),
    )
    const drawnEntryIds = [...winners, ...reserves].map((entry) => entry.drawPoolEntryId)
    const entry = await prisma.drawPoolEntry.findFirstOrThrow({
      where: { id: { notIn: drawnEntryIds } },
    })

    for (const shape of [
      { reservePosition: 3, selectionOrder: 5 },
      { reservePosition: 1, selectionOrder: 2 },
    ]) {
      await expect(
        prisma.drawReserve.create({
          data: {
            drawResultId: result.id,
            drawPoolEntryId: entry.id,
            applicationId: entry.applicationId,
            primaryParticipantId: entry.primaryParticipantId,
            selectedWeight: 1,
            ...shape,
          },
        }),
      ).rejects.toThrow()
    }
  })

  it('refuses to make a winning entry a reserve as well', async () => {
    const { result, winners } = await drawn(2)
    const winner = winners[0]
    if (!winner) throw new Error('Expected a winner')

    await expect(
      prisma.drawReserve.create({
        data: {
          drawResultId: result.id,
          drawPoolEntryId: winner.drawPoolEntryId,
          applicationId: winner.applicationId,
          primaryParticipantId: winner.primaryParticipantId,
          selectionOrder: 4,
          reservePosition: 2,
          selectedWeight: 1,
        },
      }),
    ).rejects.toThrow()
  })

  it('serves no endpoint that rewrites a selection order or a reserve position', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    for (const path of [
      `/api/admin/commune-draws/${communeDraw.id}/reserves`,
      `/api/admin/commune-draws/${communeDraw.id}/reserves/1`,
      `/api/admin/commune-draws/${communeDraw.id}/reserves/reorder`,
      `/api/admin/commune-draws/${communeDraw.id}/winners/1`,
      `/api/admin/commune-draws/${communeDraw.id}/redraw`,
    ]) {
      expect((await request(app).patch(path).set('Cookie', cookie).send({})).status).toBe(404)
      expect((await request(app).put(path).set('Cookie', cookie).send({})).status).toBe(404)
      expect((await request(app).delete(path).set('Cookie', cookie)).status).toBe(404)
    }
  })
})

// --- Authorization ----------------------------------------------------------

describe('who may move a reserve', () => {
  it('refuses every reserve operation to a scoped administrator', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie: superCookie } = await superAdmin()
    await abandonVia(communeDraw.id, 2, superCookie).send(REASON)

    const wilaya = await wilayaAdmin(geo.wilayaA.id)
    const commune = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)

    // Their own territory, and still 403: a place is being taken from somebody
    // or given to them, which is national work for the same reason running and
    // publishing the draw are.
    for (const { cookie } of [wilaya, commune]) {
      expect((await abandonVia(communeDraw.id, 1, cookie).send(REASON)).status).toBe(403)
      expect((await callVia(communeDraw.id, 1, cookie).send({ winnerSelectionOrder: 2 })).status).toBe(403)
      expect((await acceptVia(communeDraw.id, 1, cookie)).status).toBe(403)
      expect((await declineVia(communeDraw.id, 1, cookie).send({ explanation: 'no' })).status).toBe(403)
    }

    expect(await prisma.winnerAbandonment.count()).toBe(1)
    expect(await prisma.drawReserve.count({ where: { status: 'WAITING' } })).toBe(2)
  })

  it('refuses an unauthenticated caller', async () => {
    const { communeDraw } = await drawn(2)

    expect(
      (await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/winners/1/abandon`)).status,
    ).toBe(401)
    expect(
      (await request(app).post(`/api/admin/commune-draws/${communeDraw.id}/reserves/1/accept`)).status,
    ).toBe(401)
    expect(await prisma.winnerAbandonment.count()).toBe(0)
  })

  it('lets a scoped administrator read their own commune’s winners and reserves', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie: superCookie } = await superAdmin()
    await vacate(communeDraw.id, 1, superCookie)

    const { cookie } = await communeAdmin(geo.wilayaA.id, geo.communeA1.id)
    const response = await resultVia(communeDraw.id, cookie)

    expect(response.status).toBe(200)
    expect(response.body.reserves).toHaveLength(2)
    expect(response.body.reserves[0]).toMatchObject({ reservePosition: 1, status: 'CALLED' })
    expect(response.body.winners[0]).toMatchObject({ outcome: 'ABANDONED' })
    // Checking their own commune's list is exactly what a scoped administrator
    // is for, so the recorded reason reaches them.
    expect(response.body.winners[0].abandonment.explanation).toBe(REASON.explanation)
  })

  it('does not find another territory’s draw at all', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await communeAdmin(geo.wilayaB.id, geo.communeB1.id)

    // 404, not 403: out of scope and nonexistent must stay indistinguishable.
    expect((await resultVia(communeDraw.id, cookie)).status).toBe(404)
  })
})

// --- The public surface -----------------------------------------------------

describe('what the public sees of reserves and replacements', () => {
  /** Publishes the commune's result as a fresh national administrator. */
  async function publish(communeDrawId: string): Promise<void> {
    const { cookie } = await superAdmin()
    const response = await request(app)
      .post(`/api/admin/commune-draws/${communeDrawId}/publish-result`)
      .set('Cookie', cookie)
    if (response.status !== 201) {
      throw new Error(`Publication failed: ${response.status} ${JSON.stringify(response.body)}`)
    }
  }

  const publicResult = () =>
    request(app).get(`/api/public/results/${YEAR}/${geo.wilayaA.code}/${geo.communeA1.code}`)

  it('publishes the reserve list in the order the draw produced it', async () => {
    const { communeDraw } = await drawn(2)
    await publish(communeDraw.id)

    const response = await publicResult()

    expect(response.status).toBe(200)
    expect(response.body.reserves).toHaveLength(2)
    expect(response.body.reserves.map((r: { reservePosition: number }) => r.reservePosition)).toEqual([1, 2])
    expect(response.body.reserves.map((r: { selectionOrder: number }) => r.selectionOrder)).toEqual([3, 4])
    expect(response.body.reserves.every((r: { outcome: string }) => r.outcome === 'WAITING')).toBe(true)
    expect(response.body.winners.every((w: { outcome: string }) => w.outcome === 'ACTIVE')).toBe(true)
  })

  it('says a place was given up without saying why', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await publish(communeDraw.id)
    await abandonVia(communeDraw.id, 1, cookie).send({
      reason: 'DEATH',
      explanation: 'Passed away in March; certificate held by the commune.',
    })

    const response = await publicResult()
    const serialized = JSON.stringify(response.body)

    expect(response.body.winners[0].outcome).toBe('WITHDRAWN')
    expect(response.body.winners[1].outcome).toBe('ACTIVE')
    // Never the reason, the explanation, or who recorded either.
    for (const forbidden of ['DEATH', 'Passed away', 'certificate', 'explanation', 'recordedBy']) {
      expect(serialized).not.toContain(forbidden)
    }
    // And the original result is not rewritten: the same winner, in the same
    // place in the order, still on the list.
    expect(response.body.winners).toHaveLength(2)
    expect(response.body.winners[0].selectionOrder).toBe(1)
  })

  it('shows a promoted reserve as promoted, and leaves the winner list alone', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await publish(communeDraw.id)
    const before = await publicResult()

    await vacate(communeDraw.id, 1, cookie)
    await acceptVia(communeDraw.id, 1, cookie)

    const after = await publicResult()

    expect(after.body.reserves[0].outcome).toBe('PROMOTED')
    expect(after.body.reserves[1].outcome).toBe('WAITING')
    // The lottery's own record, unchanged — a replacement is not a new draw.
    expect(after.body.winners.map((w: { applicationReference: string }) => w.applicationReference)).toEqual(
      before.body.winners.map((w: { applicationReference: string }) => w.applicationReference),
    )
    expect(after.body.poolHash).toBe(before.body.poolHash)
    expect(after.body.winnerCount).toBe(before.body.winnerCount)
  })

  it('tells a waiting reserve they are a reserve, and a promoted one they hold a place', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()

    const reserve = await prisma.drawReserve.findFirstOrThrow({ where: { reservePosition: 1 } })
    const application = await prisma.application.findUniqueOrThrow({ where: { id: reserve.applicationId } })

    const check = () =>
      request(app)
        .post('/api/public/application-status')
        .send({ applicationReference: application.applicationReference, phoneNumber: PHONE })

    // Before the announcement, a reserve is told exactly what everybody else is
    // told — three outcomes told apart early are three outcomes somebody can
    // learn by polling their own reference.
    expect((await check()).body.status).toBe('AWAITING_RESULTS')

    await publish(communeDraw.id)
    expect((await check()).body.status).toBe('RESERVE')

    await vacate(communeDraw.id, 1, cookie)
    // Being called is administrative, and about somebody else's circumstances:
    // the citizen's own status does not move until they hold the place.
    expect((await check()).body.status).toBe('RESERVE')

    await acceptVia(communeDraw.id, 1, cookie)
    expect((await check()).body.status).toBe('SELECTED')

    // And nothing about the lifecycle leaks alongside it.
    const serialized = JSON.stringify((await check()).body)
    for (const forbidden of ['CALLED', 'reservePosition', 'replaces', 'abandon']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('still publishes a result whose reserve has already been promoted', async () => {
    const { communeDraw } = await drawn(2)
    const { cookie } = await superAdmin()
    await vacate(communeDraw.id, 1, cookie)
    await acceptVia(communeDraw.id, 1, cookie)

    // The integrity gate counts the promoted reserve's archive rows as part of
    // what this draw made true, so a replacement before publication reconciles
    // rather than blocking the announcement.
    await publish(communeDraw.id)

    const response = await publicResult()
    expect(response.status).toBe(200)
    expect(response.body.winningParticipantCount).toBe(3)
    expect(response.body.reserves[0].outcome).toBe('PROMOTED')
  })
})
