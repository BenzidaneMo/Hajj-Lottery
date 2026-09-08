import type { Prisma, PrismaClient } from '@prisma/client'

import { ConflictError, NotFoundError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { auditService, AuditService, scopeOfCommune, type AuditActor } from './audit.service.js'
import type { CommuneDrawWithPlace } from './draw-configuration.service.js'
import { lotteryService, LotteryService, type DrawSelection } from './lottery.service.js'

/**
 * One person who won, and the entry they won through.
 *
 * A paired application produces two of these from one entry — lifetime exclusion
 * applies to people, and both travellers are winners.
 */
interface WinningIndividual {
  participantId: string
  drawPoolEntryId: string
}

/** Everyone who was in the pool, and what happened to them. */
interface PooledParticipant {
  participantId: string
  won: boolean
}

/**
 * The record of an execution, shaped for the audit log that does not exist yet.
 *
 * Identifiers and counts only — never who won. Whatever eventually persists this
 * can do so without reshaping anything, and until then nothing writes a
 * fabricated audit row.
 */
export interface DrawExecutionEvent {
  event: 'draw.completed'
  actingAdministratorId: string | null
  communeDrawId: string
  drawResultId: string
  drawPoolId: string
  poolHash: string
  algorithmVersion: string
  winnerCount: number
  winningParticipantCount: number
  at: string
}

/** What an execution produced. */
export interface DrawExecution {
  drawResultId: string
  communeDraw: CommuneDrawWithPlace
  selection: DrawSelection
  winningParticipantCount: number
  notSelectedCount: number
  historyRecordsCreated: number
  startedAt: Date
  completedAt: Date
  event: DrawExecutionEvent
}

/**
 * Draw execution: the one operation that turns a frozen pool into winners.
 *
 * Everything happens in a single transaction — the claim, the selection, the
 * result, the winners, the archive, lifetime exclusion, the application outcomes,
 * the participation ledger and the commune draw's own transition. Either a
 * commune has a complete, consistent, permanent result, or it is exactly as it
 * was before anybody pressed the button. There is no state in between, because
 * every intermediate state this system could be caught in is one somebody would
 * have to resolve by hand against people who had already been told they won.
 *
 * The invariants that follow from that, none of which can be violated by a
 * partial failure:
 *
 *   a winner is recorded  ⟺  that person is excluded for life
 *   a draw is COMPLETED   ⟺  a result with all of its winners exists
 *   a result exists       ⟹  the draw cannot be run again
 *
 * Concurrency is settled by the database, not by this process. The claim is a
 * conditional `UPDATE ... WHERE status = 'LOCKED'`, so two simultaneous
 * executions serialize on the row: the second blocks, re-evaluates, matches
 * nothing, and is told the draw is already complete. An in-memory guard would
 * only work until a second API instance existed.
 *
 * Nothing here recalculates a weight, re-evaluates eligibility, or reads
 * participation history to influence the outcome. The pool is the input, and the
 * pool is frozen.
 */
export class DrawExecutionService {
  private readonly db: PrismaClient
  private readonly lottery: LotteryService
  private readonly audit: AuditService

  constructor(
    db: PrismaClient = defaultPrisma,
    lottery: LotteryService = lotteryService,
    audit: AuditService = auditService,
  ) {
    this.db = db
    this.lottery = lottery
    this.audit = audit
  }

  /**
   * Runs the draw and records everything it produced, exactly once.
   *
   * Refuses — leaving nothing behind — if the commune draw is not locked, has
   * already been drawn, has no pool, has a pool that does not verify, or holds
   * fewer entries than the commune has places.
   */
  async execute(communeDrawId: string, actor: AuditActor | null = null): Promise<DrawExecution> {
    const startedAt = new Date()

    return this.db.$transaction(async (tx) => {
      // Read before claiming, so the refusals below can name the actual state
      // and so the selection has the commune draw as it stood when it was
      // locked. Nothing is trusted from it: the claim itself is conditional.
      const communeDraw = await tx.communeDraw.findUnique({
        where: { id: communeDrawId },
        include: { drawYear: true, commune: { include: { wilaya: true } } },
      })
      if (!communeDraw) throw new NotFoundError('COMMUNE_DRAW_NOT_FOUND', 'Commune draw not found')

      // The claim, and the whole concurrency story. A conditional update rather
      // than a check followed by a write: two executions arriving together
      // serialize on this row, and the loser matches no row instead of running a
      // second draw. A crash before commit rolls the status back to LOCKED,
      // which is a safe, retryable state — no process-local lock could survive
      // that, and none is used.
      const claimed = await tx.communeDraw.updateMany({
        where: { id: communeDrawId, status: 'LOCKED' },
        data: { status: 'COMPLETED' },
      })

      if (claimed.count !== 1) {
        if (communeDraw.status === 'COMPLETED') {
          throw new ConflictError(
            'DRAW_ALREADY_COMPLETED',
            'This commune draw has already been drawn. Read its result instead.',
          )
        }
        throw new ConflictError(
          'DRAW_NOT_LOCKED',
          `A draw can only be run against a locked commune draw, and this one is ${communeDraw.status}`,
        )
      }

      // The selection reads the pool through the same transaction, verifies its
      // hash and aggregates, and refuses a pool smaller than the allocation. The
      // commune draw is passed as it was read above — LOCKED — because the claim
      // this transaction just made is the proof the draw was legitimate.
      const selection = await this.lottery.drawFrom(communeDraw, tx)

      const winners = this.winningIndividuals(selection)
      const pooled = await this.pooledParticipants(tx, selection)

      const completedAt = new Date()

      const result = await tx.drawResult.create({
        data: {
          communeDrawId: communeDraw.id,
          drawPoolId: selection.drawPoolId,
          winnerCount: selection.selected.length,
          totalWeightAtDraw: selection.totalWeight,
          poolHash: selection.snapshotHash,
          algorithmVersion: selection.algorithmVersion,
          startedAt,
          completedAt,
        },
      })

      await tx.drawWinner.createMany({
        data: selection.selected.map((entry) => ({
          drawResultId: result.id,
          drawPoolEntryId: entry.drawPoolEntryId,
          applicationId: entry.applicationId,
          primaryParticipantId: entry.primaryParticipantId,
          secondaryParticipantId: entry.secondaryParticipantId,
          selectionOrder: entry.selectionOrder,
          selectedWeight: entry.weight,
        })),
      })

      // The randomness, kept so the result can be replayed and checked by
      // somebody who does not trust the software that produced it.
      await tx.drawSelectionEvent.createMany({
        data: selection.events.map((event) => ({
          drawResultId: result.id,
          selectionOrder: event.selectionNumber,
          activeTotalWeight: event.totalActiveWeight,
          randomValue: event.randomValue,
          selectedPoolEntryId: event.selectedEntryId,
        })),
      })

      // One row per winning *person*. UNIQUE(participant_id) means a malformed
      // pool naming somebody twice aborts the entire transaction here rather
      // than being quietly deduplicated.
      await tx.winnerArchive.createMany({
        data: winners.map((winner) => ({
          participantId: winner.participantId,
          drawYear: communeDraw.drawYear.year,
          communeId: communeDraw.communeId,
          drawResultId: result.id,
          drawPoolEntryId: winner.drawPoolEntryId,
          drawnAt: completedAt,
        })),
      })

      // Lifetime exclusion, in the same transaction as the archive. After commit
      // registration and eligibility see it immediately; before commit, nobody
      // sees any of it.
      const excluded = await tx.participant.updateMany({
        where: { id: { in: winners.map((winner) => winner.participantId) } },
        data: { hasWonHajj: true },
      })
      if (excluded.count !== winners.length) {
        throw new ConflictError(
          'INVALID_POOL_SNAPSHOT',
          'A selected participant no longer exists and cannot be recorded as a winner',
        )
      }

      const selectedApplicationIds = selection.selected.map((entry) => entry.applicationId)
      const notSelectedApplicationIds = selection.pooledApplicationIds.filter(
        (id) => !selectedApplicationIds.includes(id),
      )

      // Final outcomes, for the applications that were in the pool and only
      // those. An application that never reached the pool took no part in this
      // lottery and keeps whatever the eligibility engine said about it.
      const finalizedSelected = await tx.application.updateMany({
        where: { id: { in: selectedApplicationIds } },
        data: { status: 'SELECTED' },
      })
      const finalizedNotSelected = await tx.application.updateMany({
        where: { id: { in: notSelectedApplicationIds } },
        data: { status: 'NOT_SELECTED' },
      })

      // The ledger the next draw's weighting reads. Verified, because the system
      // produced these from its own frozen pool — there is nobody to vouch for
      // them and nothing to reconcile against. Unverified rows do not count
      // toward a streak, so leaving them false here would quietly discard every
      // web-era year of patience.
      await tx.participationHistory.createMany({
        data: pooled.map((participant) => ({
          participantId: participant.participantId,
          communeId: communeDraw.communeId,
          drawYear: communeDraw.drawYear.year,
          participated: true,
          won: participant.won,
          source: 'APPLICATION' as const,
          verified: true,
        })),
      })

      // The permanent record of who ran the lottery, in the transaction that
      // ran it. References the authoritative records rather than copying them:
      // no winner is named, and no random value is repeated here, because the
      // immutable DrawSelectionEvent rows already hold them.
      await this.audit.record(
        {
          action: 'COMMUNE_DRAW_EXECUTED',
          actor,
          targetType: 'DRAW_RESULT',
          targetId: result.id,
          scope: scopeOfCommune(communeDraw.commune),
          metadata: {
            communeDrawId: communeDraw.id,
            drawYear: communeDraw.drawYear.year,
            drawPoolId: selection.drawPoolId,
            poolHash: selection.snapshotHash,
            algorithmVersion: selection.algorithmVersion,
            winnerCount: selection.selected.length,
            winningParticipantCount: winners.length,
            totalWeightAtDraw: selection.totalWeight,
            entryCount: selection.entryCount,
          },
        },
        tx,
      )

      // Checked against the rows actually written, while a rollback is still
      // possible — nothing can repair any of this afterwards, because none of it
      // can be updated at all.
      await this.assertComplete(tx, result.id, {
        winnerCount: selection.selected.length,
        winningParticipantCount: winners.length,
        finalizedApplications: finalizedSelected.count + finalizedNotSelected.count,
        pooledApplications: selection.pooledApplicationIds.length,
        historyRecords: pooled.length,
      })

      return {
        drawResultId: result.id,
        communeDraw,
        selection,
        winningParticipantCount: winners.length,
        notSelectedCount: notSelectedApplicationIds.length,
        historyRecordsCreated: pooled.length,
        startedAt,
        completedAt,
        event: {
          event: 'draw.completed' as const,
          actingAdministratorId: actor?.id ?? null,
          communeDrawId: communeDraw.id,
          drawResultId: result.id,
          drawPoolId: selection.drawPoolId,
          poolHash: selection.snapshotHash,
          algorithmVersion: selection.algorithmVersion,
          winnerCount: selection.selected.length,
          winningParticipantCount: winners.length,
          at: completedAt.toISOString(),
        },
      }
    })
  }

  /**
   * The people a selection wins for: one per SINGLE entry, two per PAIRED.
   *
   * Refuses a pool that names the same person twice rather than deduplicating.
   * Two entries for one participant is a corrupted snapshot — the registration
   * constraints make it impossible — and quietly collapsing them would hide
   * which of the two applications actually won.
   */
  private winningIndividuals(selection: DrawSelection): WinningIndividual[] {
    const individuals: WinningIndividual[] = []
    const seen = new Set<string>()

    for (const entry of selection.selected) {
      const participants = [entry.primaryParticipantId, entry.secondaryParticipantId].filter(
        (id): id is string => id !== null,
      )

      // A paired entry must have both, or it wins for one person while claiming
      // to travel with another.
      if (entry.entryType === 'PAIRED' && participants.length !== 2) {
        throw new ConflictError(
          'INVALID_POOL_SNAPSHOT',
          'A paired entry was selected without both of its applicants',
        )
      }

      for (const participantId of participants) {
        if (seen.has(participantId)) {
          throw new ConflictError(
            'INVALID_POOL_SNAPSHOT',
            'The same participant was selected more than once in this draw',
          )
        }
        seen.add(participantId)
        individuals.push({ participantId, drawPoolEntryId: entry.drawPoolEntryId })
      }
    }

    return individuals
  }

  /**
   * Everybody who actually took part, and whether they won.
   *
   * The pool is the authoritative list of participants in a draw — not the
   * applications table. Somebody whose application was refused, or who never
   * reached the frozen pool, did not take part, and must not be given a
   * non-winning record that would grow their priority for next year.
   *
   * Refuses if any of them already has a record for this year: two competing
   * accounts of one person's year is exactly what the ledger's unique constraint
   * exists to prevent, and resolving them is an administrator's decision.
   */
  private async pooledParticipants(
    tx: Prisma.TransactionClient,
    selection: DrawSelection,
  ): Promise<PooledParticipant[]> {
    const entries = await tx.drawPoolEntry.findMany({
      where: { drawPoolId: selection.drawPoolId },
      select: { applicationId: true, primaryParticipantId: true, secondaryParticipantId: true },
    })

    const wonApplicationIds = new Set(selection.selected.map((entry) => entry.applicationId))
    const pooled: PooledParticipant[] = []

    for (const entry of entries) {
      const won = wonApplicationIds.has(entry.applicationId)
      pooled.push({ participantId: entry.primaryParticipantId, won })
      if (entry.secondaryParticipantId) {
        pooled.push({ participantId: entry.secondaryParticipantId, won })
      }
    }

    const existing = await tx.participationHistory.findFirst({
      where: {
        drawYear: selection.drawYear,
        participantId: { in: pooled.map((participant) => participant.participantId) },
      },
      select: { id: true },
    })

    if (existing) {
      throw new ConflictError(
        'DUPLICATE_HISTORY_YEAR',
        'A participant in this pool already has a historical record for this draw year',
      )
    }

    return pooled
  }

  /**
   * Confirms the result is whole before the transaction commits.
   *
   * Counted from the database rather than from the arrays that were sent to it,
   * because what matters is what was written. A result missing a winner, or a
   * winner missing from the archive, would be permanent: nothing here can be
   * updated afterwards, by anyone.
   */
  private async assertComplete(
    tx: Prisma.TransactionClient,
    drawResultId: string,
    expected: {
      winnerCount: number
      winningParticipantCount: number
      finalizedApplications: number
      pooledApplications: number
      historyRecords: number
    },
  ): Promise<void> {
    const [winners, events, archived] = await Promise.all([
      tx.drawWinner.count({ where: { drawResultId } }),
      tx.drawSelectionEvent.count({ where: { drawResultId } }),
      tx.winnerArchive.count({ where: { drawResultId } }),
    ])

    const complete =
      winners === expected.winnerCount &&
      events === expected.winnerCount &&
      archived === expected.winningParticipantCount &&
      expected.finalizedApplications === expected.pooledApplications &&
      expected.historyRecords >= expected.pooledApplications

    if (!complete) {
      throw new ConflictError(
        'INVALID_POOL_SNAPSHOT',
        'The draw result written did not match the selection that produced it',
      )
    }
  }

  /** A concluded draw with its winners and randomness, for administrative reading. */
  async findResult(communeDrawId: string) {
    return this.db.drawResult.findUnique({
      where: { communeDrawId },
      include: {
        drawPool: { select: { entryCount: true, allocatedSpots: true } },
        winners: {
          select: {
            selectionOrder: true,
            selectedWeight: true,
            secondaryParticipantId: true,
            drawPoolEntry: { select: { applicationReference: true, entryType: true } },
          },
          orderBy: { selectionOrder: 'asc' },
        },
        events: {
          select: { selectionOrder: true, activeTotalWeight: true, randomValue: true },
          orderBy: { selectionOrder: 'asc' },
        },
        _count: { select: { archivedWinners: true } },
      },
    })
  }
}

export const drawExecutionService = new DrawExecutionService()
