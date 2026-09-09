import { Prisma, type PrismaClient, type ResultPublication } from '@prisma/client'

import { ApiError, NotFoundError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import {
  assessResultIntegrity,
  type ResultIntegrityFacts,
  type ResultIntegrityIssue,
} from '../lib/result-integrity.js'
import { auditService, AuditService, scopeOfCommune, type AuditActor } from './audit.service.js'
import type { CommuneDrawWithPlace } from './draw-configuration.service.js'

/** What publishing produced, or found already there. */
export interface PublicationOutcome {
  publication: ResultPublication
  /** True when the result was already public and this call changed nothing. */
  alreadyPublished: boolean
}

/**
 * The release gate: turning a concluded draw into an official public result.
 *
 * Running a lottery and announcing it are two different acts, and this service
 * exists because they must stay that way. Execution writes the result the
 * instant the draw concludes — winners, randomness, lifetime exclusions, the
 * lot. Treating that as publication would mean every commune's outcome went
 * public the moment the button was pressed, before anybody had checked it and
 * without any named person having decided it was ready to be announced.
 *
 * So a result is private until a `ResultPublication` row exists for it, and
 * writing that row is a national administrator's deliberate, audited act.
 *
 * Three properties this is built around:
 *
 * - **It repairs nothing.** The integrity check reports every way the result
 *   fails to add up and refuses; it never fixes one. A draw that does not
 *   reconcile is a question for the people who ran it, and quietly patching it
 *   during publication would erase the evidence that anything was wrong.
 * - **It is idempotent.** `UNIQUE(draw_result_id)` means a second request
 *   cannot write a second publication, so publishing twice reports the existing
 *   one and — importantly — produces no second audit event.
 * - **It is one-way.** There is no `unpublish` method here, and the database
 *   would refuse one: UPDATE and DELETE on `result_publications` raise. Somebody
 *   who read an official result yesterday and somebody reading it today must be
 *   looking at the same thing.
 */
export class ResultPublicationService {
  private readonly db: PrismaClient
  private readonly audit: AuditService

  constructor(db: PrismaClient = defaultPrisma, audit: AuditService = auditService) {
    this.db = db
    this.audit = audit
  }

  /**
   * Publishes one commune's result, or reports that it already was.
   *
   * The verification and the write share a transaction, so a result cannot pass
   * the checks and then be published against a state that changed underneath
   * them — and the audit record commits with the publication or not at all.
   */
  async publish(communeDraw: CommuneDrawWithPlace, actor: AuditActor): Promise<PublicationOutcome> {
    try {
      return await this.db.$transaction(async (tx) => {
        const result = await tx.drawResult.findUnique({
          where: { communeDrawId: communeDraw.id },
          include: { publication: true, drawPool: true },
        })

        // Already public. Answered before anything else runs, so re-publishing
        // is cheap, writes nothing, and cannot fail on an integrity rule that
        // was satisfied at the time the announcement was actually made.
        if (result?.publication) {
          return { publication: result.publication, alreadyPublished: true }
        }

        const facts = await this.gatherFacts(tx, communeDraw, result)
        const issues = assessResultIntegrity(facts)
        if (issues.length > 0) throw notPublishable(issues)

        // Narrowing the compiler can reach: an absent result or pool is
        // reported by the assessment above, so neither can be null here.
        if (!result?.drawPool) throw notPublishable(['RESULT_MISSING'])

        const publication = await tx.resultPublication.create({
          data: {
            drawResultId: result.id,
            drawYear: communeDraw.drawYear.year,
            communeId: communeDraw.communeId,
            winnerCount: result.winnerCount,
            winningParticipantCount: facts.archivedWinnerCount,
            entryCount: result.drawPool.entryCount,
            allocatedSpots: result.drawPool.allocatedSpots,
            publishedByUserId: actor.id,
          },
        })

        // In the same transaction as the publication, like every other mutation
        // in this system. Counts and identifiers only — no winner is named, and
        // nothing personal reaches the trail.
        await this.audit.record(
          {
            action: 'DRAW_RESULT_PUBLISHED',
            actor,
            targetType: 'DRAW_RESULT',
            targetId: result.id,
            scope: scopeOfCommune(communeDraw.commune),
            metadata: {
              communeDrawId: communeDraw.id,
              drawYear: communeDraw.drawYear.year,
              resultPublicationId: publication.id,
              winnerCount: publication.winnerCount,
              winningParticipantCount: publication.winningParticipantCount,
              entryCount: publication.entryCount,
              allocatedSpots: publication.allocatedSpots,
            },
          },
          tx,
        )

        return { publication, alreadyPublished: false }
      })
    } catch (error) {
      // Two administrators publishing at once: one inserts, the other loses the
      // unique index. That is the same outcome as arriving second in time, so
      // it reports the existing publication rather than an error — and the
      // loser's audit record rolled back with its transaction, so exactly one
      // event survives.
      if (isDuplicatePublication(error)) {
        const existing = await this.findPublication(communeDraw.id)
        if (existing) return { publication: existing, alreadyPublished: true }
      }
      throw error
    }
  }

  /** The publication for one commune draw, or null while it is unpublished. */
  async findPublication(communeDrawId: string): Promise<ResultPublication | null> {
    return this.db.resultPublication.findFirst({ where: { drawResult: { communeDrawId } } })
  }

  /**
   * Everything the integrity rules judge, counted from the database.
   *
   * Aggregates rather than rows: this runs before every publication attempt, and
   * a commune with a hundred thousand allocated places must not make it load a
   * hundred thousand winners to check that the count is right.
   */
  private async gatherFacts(
    tx: Prisma.TransactionClient,
    communeDraw: CommuneDrawWithPlace,
    result: {
      id: string
      winnerCount: number
      drawPoolId: string
      poolHash: string
      drawPool: { id: string; snapshotHash: string; entryCount: number; allocatedSpots: number } | null
    } | null,
  ): Promise<ResultIntegrityFacts> {
    const base = {
      communeDrawStatus: communeDraw.status,
      result: result && {
        winnerCount: result.winnerCount,
        drawPoolId: result.drawPoolId,
        poolHash: result.poolHash,
      },
      pool: result?.drawPool ?? null,
    }

    // Nothing below is meaningful without both, and the assessment returns a
    // single decisive issue for either — so the counts are not worth running.
    if (!result || !result.drawPool) {
      return {
        ...base,
        drawWinnerCount: 0,
        selectionEventCount: 0,
        selectionOrderBounds: null,
        expectedWinningParticipants: 0,
        archivedWinnerCount: 0,
        excludedWinnerCount: 0,
        pooledParticipantCount: 0,
        participationRecordCount: 0,
      }
    }

    const [
      drawWinnerCount,
      pairedWinnerCount,
      selectionEventCount,
      selectionOrder,
      archivedWinnerCount,
      excludedWinnerCount,
      poolEntryCount,
      pairedPoolEntryCount,
      participationRecordCount,
    ] = await Promise.all([
      tx.drawWinner.count({ where: { drawResultId: result.id } }),
      tx.drawWinner.count({ where: { drawResultId: result.id, secondaryParticipantId: { not: null } } }),
      tx.drawSelectionEvent.count({ where: { drawResultId: result.id } }),
      tx.drawWinner.aggregate({
        where: { drawResultId: result.id },
        _min: { selectionOrder: true },
        _max: { selectionOrder: true },
      }),
      tx.winnerArchive.count({ where: { drawResultId: result.id } }),
      tx.winnerArchive.count({ where: { drawResultId: result.id, participant: { hasWonHajj: true } } }),
      tx.drawPoolEntry.count({ where: { drawPoolId: result.drawPool.id } }),
      tx.drawPoolEntry.count({
        where: { drawPoolId: result.drawPool.id, secondaryParticipantId: { not: null } },
      }),
      // Counted by commune and year rather than by a list of participant ids.
      // Execution writes exactly one APPLICATION-sourced row per pooled person,
      // and one commune runs at most one draw per year, so this is exact — and
      // it reads an index instead of an `IN` clause with a commune's whole pool
      // in it.
      tx.participationHistory.count({
        where: {
          communeId: communeDraw.communeId,
          drawYear: communeDraw.drawYear.year,
          source: 'APPLICATION',
        },
      }),
    ])

    const bounds = selectionOrder._min.selectionOrder
    const upper = selectionOrder._max.selectionOrder

    return {
      ...base,
      drawWinnerCount,
      selectionEventCount,
      selectionOrderBounds: bounds !== null && upper !== null ? { min: bounds, max: upper } : null,
      // A paired entry wins for two people, a single one for one.
      expectedWinningParticipants: drawWinnerCount + pairedWinnerCount,
      archivedWinnerCount,
      excludedWinnerCount,
      pooledParticipantCount: poolEntryCount + pairedPoolEntryCount,
      participationRecordCount,
    }
  }
}

/**
 * A refusal that names every problem found.
 *
 * The codes are for administrators, exactly like the pool validation codes and
 * unlike the eligibility ones: a national administrator investigating why a
 * commune cannot be announced needs to know it is the winner archive rather than
 * the ledger, and none of these names anybody.
 */
function notPublishable(issues: ResultIntegrityIssue[]): ApiError {
  return new ApiError(
    409,
    'RESULT_NOT_PUBLISHABLE',
    'This result cannot be published until it reconciles with the records behind it',
    { issues },
  )
}

function isDuplicatePublication(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

/** A commune draw that has no result at all, for the admin read route. */
export function resultNotFound(): NotFoundError {
  return new NotFoundError('DRAW_RESULT_NOT_FOUND', 'This commune draw has not been drawn')
}

export const resultPublicationService = new ResultPublicationService()
