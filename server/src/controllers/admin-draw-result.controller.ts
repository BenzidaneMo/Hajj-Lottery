import type {
  DrawExecutionDto,
  DrawReserveDto,
  DrawResultDto,
  DrawSelectionEventDto,
  DrawWinnerDto,
  ResultPublicationDto,
} from '@hajj-lottery/shared'
import type { EntryType } from '@prisma/client'
import type { RequestHandler } from 'express'

import { holdsAPlace } from '../lib/reserve-lifecycle.js'
import { NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor } from '../services/audit.service.js'
import { authorizationService } from '../services/authorization.service.js'
import type { CommuneDrawWithPlace } from '../services/draw-configuration.service.js'
import { drawExecutionService } from '../services/draw-execution.service.js'
import { resultPublicationService } from '../services/result-publication.service.js'

/**
 * Executing a draw, and reading what it produced.
 *
 * The two are deliberately different privileges. Reading a result is scoped
 * administrative work — an administrator may see their own territory's outcome.
 * *Running* the lottery is national: it is irreversible, it excludes people from
 * every future draw, and nobody should be able to run the draw they are
 * themselves subject to.
 *
 * Both resolve the commune draw through the caller's own scope first, so a
 * result in another territory is not found rather than refused — the same answer
 * an id that was never issued gets.
 *
 * Nothing here is public. Winner publication carries its own consent and
 * notification questions, none of which have been answered.
 */

/** Reaches the commune draw, or 404s — before anything else runs. */
export async function scopedCommuneDraw(req: Parameters<RequestHandler>[0]): Promise<CommuneDrawWithPlace> {
  const communeDraw = await authorizationService.findCommuneDraw(
    getAuthenticatedUser(req),
    req.params.id ?? '',
  )
  if (!communeDraw) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

  return communeDraw
}

/**
 * POST /api/admin/commune-draws/:id/execute — SUPER_ADMIN only.
 *
 * The irreversible act. Everything it needs comes from the database: the winner
 * count from the pool's frozen allocation, the entries and weights from the pool,
 * the randomness from the CSPRNG. The request body is not read at all — there is
 * nothing a caller could usefully say, and a great deal they must not be able to.
 */
export const executeDraw: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const execution = await drawExecutionService.execute(communeDraw.id, auditActor(getAuthenticatedUser(req)))

  // `execution.event` is the structured record a future audit log will persist:
  // who ran what, against which pool, and how many won. Nothing writes it yet,
  // and it is deliberately not logged — a fabricated audit row would be worse
  // than none, and winners must not reach any log.

  const body: DrawExecutionDto = {
    ...toResultDto(execution.communeDraw, {
      id: execution.drawResultId,
      winnerCount: execution.selection.selected.length,
      reserveCount: execution.reserveCount,
      // Every place is held: nobody can have given one up in the moment
      // between the draw concluding and this response.
      activeWinnerCount: execution.selection.selected.length,
      winningParticipantCount: execution.winningParticipantCount,
      allocatedSpots: execution.selection.allocatedSpots,
      entryCount: execution.selection.entryCount,
      totalWeightAtDraw: execution.selection.totalWeight,
      poolHash: execution.selection.snapshotHash,
      algorithmVersion: execution.selection.algorithmVersion,
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt.toISOString(),
      // Always null: a draw that has just been run has not been published, and
      // execution has no path that could publish one.
      publishedAt: null,
      winners: execution.selection.selected.map((entry) => ({
        selectionOrder: entry.selectionOrder,
        applicationReference: entry.applicationReference,
        entryType: entry.entryType,
        selectedWeight: entry.weight,
        participantCount: entry.secondaryParticipantId ? 2 : 1,
        outcome: 'ACTIVE' as const,
        abandonment: null,
      })),
      reserves: execution.selection.reserves.map((entry) => ({
        reservePosition: entry.reservePosition,
        selectionOrder: entry.selectionOrder,
        applicationReference: entry.applicationReference,
        entryType: entry.entryType,
        selectedWeight: entry.weight,
        participantCount: entry.secondaryParticipantId ? 2 : 1,
        // Drawn, and nothing more. A reserve is not a winner and is not
        // excluded from anything by having been selected as one.
        status: 'WAITING' as const,
        replacesSelectionOrder: null,
        calledAt: null,
        decidedAt: null,
      })),
      events: execution.selection.events.map((event) => ({
        selectionOrder: event.selectionNumber,
        activeTotalWeight: event.totalActiveWeight,
        randomValue: event.randomValue,
      })),
    }),
    notSelectedCount: execution.notSelectedCount,
    historyRecordsCreated: execution.historyRecordsCreated,
  }

  res.status(201).json(body)
}

/**
 * GET /api/admin/commune-draws/:id/result — any administrator, within scope.
 *
 * Reads the stored record. Nothing is recomputed and no randomness is drawn:
 * the result is what it was when it was written, permanently.
 */
export const getDrawResult: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)

  res.json(await readResultDto(communeDraw))
}

/**
 * The stored result, as an administrator reads it.
 *
 * Exported because every reserve operation answers with it: an administrator who
 * has just recorded an abandonment or promoted a reserve needs the draw's whole
 * new state, and reading it back from the same records that were written is the
 * only way to be sure the response describes what was actually stored.
 *
 * Two vocabularies travel side by side here and are deliberately never merged.
 * The winners and the reserves are the lottery's own record — position, order,
 * entry — and never change. `outcome` and `status` are the current
 * administrative facts about the people holding those positions. A promoted
 * reserve appears in `reserves` as position #1 with status `ACCEPTED`, and does
 * *not* appear in `winners`: the draw did not select them as a winner, and this
 * response must not claim it did.
 */
export async function readResultDto(communeDraw: CommuneDrawWithPlace): Promise<DrawResultDto> {
  const result = await drawExecutionService.findResult(communeDraw.id)
  if (!result) throw new NotFoundError('DRAW_RESULT_NOT_FOUND', 'This commune draw has not been drawn')

  const publication = await resultPublicationService.findPublication(communeDraw.id)

  const abandonedCount = result.winners.filter((winner) => winner.abandonment !== null).length
  const promotedCount = result.reserves.filter((reserve) => holdsAPlace(reserve.status)).length

  return toResultDto(communeDraw, {
    publishedAt: publication?.publishedAt.toISOString() ?? null,
    id: result.id,
    winnerCount: result.winnerCount,
    reserveCount: result.reserves.length,
    // Places held right now: the original winners who have not given theirs up,
    // plus the reserves who took the ones that were. A replacement fills a
    // place rather than adding one, so this returns to the allocation and
    // never exceeds it.
    activeWinnerCount: result.winnerCount - abandonedCount + promotedCount,
    winningParticipantCount: result._count.archivedWinners,
    allocatedSpots: result.drawPool.allocatedSpots,
    entryCount: result.drawPool.entryCount,
    totalWeightAtDraw: result.totalWeightAtDraw,
    poolHash: result.poolHash,
    algorithmVersion: result.algorithmVersion,
    startedAt: result.startedAt.toISOString(),
    completedAt: result.completedAt.toISOString(),
    winners: result.winners.map((winner) => ({
      selectionOrder: winner.selectionOrder,
      applicationReference: winner.drawPoolEntry.applicationReference,
      entryType: winner.drawPoolEntry.entryType,
      selectedWeight: winner.selectedWeight,
      participantCount: winner.secondaryParticipantId ? 2 : 1,
      // Derived from whether a record of the decision exists, never from a
      // column on the winner row — that row is evidence of a lottery and has
      // nothing on it anybody could set.
      outcome: winner.abandonment ? ('ABANDONED' as const) : ('ACTIVE' as const),
      abandonment: winner.abandonment && {
        reason: winner.abandonment.reason,
        explanation: winner.abandonment.explanation,
        recordedBy: winner.abandonment.recordedBy,
        recordedAt: winner.abandonment.recordedAt.toISOString(),
      },
    })),
    reserves: result.reserves.map((reserve) => ({
      reservePosition: reserve.reservePosition,
      selectionOrder: reserve.selectionOrder,
      applicationReference: reserve.drawPoolEntry.applicationReference,
      entryType: reserve.drawPoolEntry.entryType,
      selectedWeight: reserve.selectedWeight,
      participantCount: reserve.secondaryParticipantId ? 2 : 1,
      status: reserve.status,
      replacesSelectionOrder: reserve.replacesDrawWinner?.selectionOrder ?? null,
      calledAt: reserve.calledAt?.toISOString() ?? null,
      decidedAt: reserve.decidedAt?.toISOString() ?? null,
    })),
    events: result.events,
  })
}

/**
 * The place, plus the result's own facts.
 *
 * Winners are identified by their application reference only — no names, no
 * national IDs, no internal ids — exactly as the pool listing identifies entries.
 * Who a winner *is* becomes a question for publication and notification, which
 * do not exist.
 */
function toResultDto(
  communeDraw: CommuneDrawWithPlace,
  result: {
    id: string
    winnerCount: number
    reserveCount: number
    activeWinnerCount: number
    winningParticipantCount: number
    allocatedSpots: number
    entryCount: number
    totalWeightAtDraw: number
    poolHash: string
    algorithmVersion: string
    startedAt: string
    completedAt: string
    publishedAt: string | null
    winners: (Omit<DrawWinnerDto, 'entryType'> & { entryType: EntryType })[]
    reserves: (Omit<DrawReserveDto, 'entryType'> & { entryType: EntryType })[]
    events: DrawSelectionEventDto[]
  },
): DrawResultDto {
  return {
    id: result.id,
    drawYear: communeDraw.drawYear.year,
    communeCode: communeDraw.commune.code,
    winnerCount: result.winnerCount,
    reserveCount: result.reserveCount,
    activeWinnerCount: result.activeWinnerCount,
    winningParticipantCount: result.winningParticipantCount,
    allocatedSpots: result.allocatedSpots,
    entryCount: result.entryCount,
    totalWeightAtDraw: result.totalWeightAtDraw,
    poolHash: result.poolHash,
    algorithmVersion: result.algorithmVersion,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    publishedAt: result.publishedAt,
    winners: result.winners,
    reserves: result.reserves,
    events: result.events,
  }
}

/**
 * POST /api/admin/commune-draws/:id/publish-result — SUPER_ADMIN only.
 *
 * Publishing is national work for the same reason running the draw is. A
 * WILAYA_ADMIN or COMMUNE_ADMIN may read their own territory's result — they
 * have to be able to check it — but announcing one is an act with national
 * consequences taken by somebody who is not subject to the draw they are
 * releasing. Both get a 403 here, which is the role failure they can act on,
 * rather than the 404 an out-of-scope commune gets.
 *
 * The body is ignored entirely. There is nothing a caller could usefully say:
 * the winners, the counts and the moment of the draw all come from records
 * written when the lottery ran, and the publisher comes from the session.
 *
 * Idempotent. A repeated request returns 200 with `alreadyPublished`, writes no
 * second publication and produces no second audit event — see the service.
 */
export const publishResult: RequestHandler = async (req, res) => {
  const communeDraw = await scopedCommuneDraw(req)
  const outcome = await resultPublicationService.publish(communeDraw, auditActor(getAuthenticatedUser(req)))

  const body: ResultPublicationDto = {
    drawYear: communeDraw.drawYear.year,
    communeCode: communeDraw.commune.code,
    wilayaCode: communeDraw.commune.wilaya.code,
    publishedAt: outcome.publication.publishedAt.toISOString(),
    winnerCount: outcome.publication.winnerCount,
    winningParticipantCount: outcome.publication.winningParticipantCount,
    alreadyPublished: outcome.alreadyPublished,
  }

  res.status(outcome.alreadyPublished ? 200 : 201).json(body)
}
