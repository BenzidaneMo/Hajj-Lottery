import type { ParticipationStreakDto } from '@hajj-lottery/shared'
import {
  Prisma,
  type Commune,
  type ParticipationHistory,
  type ParticipationSource,
  type PrismaClient,
  type Wilaya,
} from '@prisma/client'

import { normalizeAuditReason } from '../lib/audit-payload.js'
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js'
import { calculateStreak } from '../lib/participation-streak.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { auditService, AuditService, scopeOfCommune, type AuditActor } from './audit.service.js'
import { drawConfigurationService, DrawConfigurationService } from './draw-configuration.service.js'

/** A historical record with the geography needed to present or authorize it. */
export type HistoryRecordWithPlace = ParticipationHistory & {
  commune: Commune & { wilaya: Wilaya }
}

/** What creating one year of history requires. */
export interface CreateHistoryInput {
  participantId: string
  communeId: string
  drawYear: number
  participated: boolean
  won?: boolean
  source: ParticipationSource
  verified?: boolean
  notes?: string | null
}

/**
 * An administrative correction.
 *
 * Every field is optional because a correction is usually about one fact.
 * `notes` is not: a change to the historical record must say why it was made,
 * which is the seed of the audit trail that comes later.
 */
export interface CorrectHistoryInput {
  participated?: boolean
  won?: boolean
  communeId?: string
  verified?: boolean
  notes: string
}

/**
 * The participation ledger.
 *
 * Records facts about previous draw years and answers questions about them.
 * It does not invent anything: a row exists because somebody imported it from
 * a register or an administrator entered it, never because a Participant
 * exists or because an application was submitted. An application is an
 * intention; history is an outcome, and the two must not be confused.
 *
 * Geographic authorization is deliberately *not* here — it belongs to
 * AuthorizationService, where scope is a query filter rather than a check.
 */
export class ParticipationHistoryService {
  private readonly db: PrismaClient
  private readonly configuration: DrawConfigurationService
  private readonly audit: AuditService

  constructor(
    db: PrismaClient = defaultPrisma,
    configuration: DrawConfigurationService = drawConfigurationService,
    audit: AuditService = auditService,
  ) {
    this.db = db
    this.configuration = configuration
    this.audit = audit
  }

  /**
   * Records one year of one person's history.
   *
   * The participant and commune must already exist — this creates history, not
   * people or places. The year must not be in the future: the ledger describes
   * draws that have happened, and a draw that has not run has no outcome to
   * record.
   */
  async create(input: CreateHistoryInput): Promise<HistoryRecordWithPlace> {
    await this.assertNotFutureYear(input.drawYear)

    const [participant, commune] = await Promise.all([
      this.db.participant.findUnique({ where: { id: input.participantId }, select: { id: true } }),
      this.db.commune.findUnique({ where: { id: input.communeId }, select: { id: true } }),
    ])

    if (!participant) throw new NotFoundError('PARTICIPANT_NOT_FOUND', 'Participant not found')
    if (!commune) throw new NotFoundError('COMMUNE_NOT_FOUND', 'Commune not found')

    try {
      return await this.db.participationHistory.create({
        data: {
          participantId: input.participantId,
          communeId: input.communeId,
          drawYear: input.drawYear,
          participated: input.participated,
          won: input.won ?? false,
          source: input.source,
          // Unverified unless stated. Imported history has to earn its
          // authority; nothing counts toward a streak until it does.
          verified: input.verified ?? false,
          notes: input.notes ?? null,
        },
        include: { commune: { include: { wilaya: true } } },
      })
    } catch (error) {
      // The unique index is the guarantee, not a prior read: two simultaneous
      // writes for the same participant-year resolve to one row, and the loser
      // arrives here rather than overwriting the winner.
      if (isDuplicateYear(error)) {
        throw new ConflictError(
          'DUPLICATE_HISTORY_YEAR',
          'This participant already has a record for that draw year',
        )
      }
      throw error
    }
  }

  /** One record, unscoped. Callers reaching an administrator go through
   *  AuthorizationService instead, so scope cannot be forgotten. */
  async findById(id: string): Promise<HistoryRecordWithPlace | null> {
    return this.db.participationHistory.findUnique({
      where: { id },
      include: { commune: { include: { wilaya: true } } },
    })
  }

  /**
   * One participant's full history, newest first.
   *
   * Unscoped: this is the domain view, used by the streak calculation, which
   * has to see every year to be correct. The administrative view is
   * `AuthorizationService.listParticipantHistory`, which returns only the
   * records the caller may see.
   */
  async listForParticipant(participantId: string): Promise<HistoryRecordWithPlace[]> {
    return this.db.participationHistory.findMany({
      where: { participantId },
      include: { commune: { include: { wilaya: true } } },
      orderBy: { drawYear: 'desc' },
    })
  }

  /** One participant's history strictly before a target year, newest first. */
  async listForParticipantBefore(
    participantId: string,
    targetDrawYear: number,
  ): Promise<HistoryRecordWithPlace[]> {
    return this.db.participationHistory.findMany({
      where: { participantId, drawYear: { lt: targetDrawYear } },
      include: { commune: { include: { wilaya: true } } },
      orderBy: { drawYear: 'desc' },
    })
  }

  /**
   * The consecutive non-winning participation streak immediately before a
   * target draw year.
   *
   * Only the years before the target are fetched, and only the columns the
   * walk reads — the ledger is queried, never loaded into memory wholesale.
   * The counting itself is a pure function; see lib/participation-streak.ts
   * for what stops a streak and why a missing year is not an absence.
   */
  async calculateConsecutiveNonWinningYears(
    participantId: string,
    targetDrawYear: number,
  ): Promise<ParticipationStreakDto> {
    const years = await this.db.participationHistory.findMany({
      where: { participantId, drawYear: { lt: targetDrawYear } },
      select: { drawYear: true, participated: true, won: true, verified: true },
      orderBy: { drawYear: 'desc' },
    })

    return calculateStreak(participantId, targetDrawYear, years)
  }

  /**
   * Amends a historical fact.
   *
   * An update rather than a delete-and-recreate: the record keeps its identity,
   * so the audit trail that arrives later can attach to something stable. A
   * correction must carry `notes` saying why, and is marked ADMIN_CORRECTION
   * regardless of where the row originally came from — the current claim is an
   * administrator's, whatever the register said.
   *
   * Participant identity is never touched here. Correcting a name is a
   * different operation on a different record, and still does not exist.
   *
   * There is no route to this. A correction reaches it either through an
   * approved request or through a SUPER_ADMIN's direct, audited correction —
   * see docs/audit-and-governance.md. `db` takes a transaction client so the
   * correction and its audit record commit together.
   */
  async correct(
    id: string,
    changes: CorrectHistoryInput,
    db: Pick<PrismaClient, 'participationHistory' | 'commune'> = this.db,
  ): Promise<HistoryRecordWithPlace> {
    const existing = await this.findById(id)
    if (!existing) throw new NotFoundError('HISTORY_NOT_FOUND', 'Historical record not found')

    if (changes.communeId) {
      const commune = await db.commune.findUnique({
        where: { id: changes.communeId },
        select: { id: true },
      })
      if (!commune) throw new NotFoundError('COMMUNE_NOT_FOUND', 'Commune not found')
    }

    const participated = changes.participated ?? existing.participated
    const won = changes.won ?? existing.won

    // The database forbids this too; catching it here gives an administrator a
    // sentence instead of a constraint violation.
    if (!participated && won) {
      throw new BadRequestError(
        'VALIDATION_FAILED',
        'Someone who did not take part in a draw cannot have won it',
      )
    }

    return db.participationHistory.update({
      where: { id },
      data: {
        participated,
        won,
        ...(changes.communeId ? { communeId: changes.communeId } : {}),
        ...(changes.verified === undefined ? {} : { verified: changes.verified }),
        source: 'ADMIN_CORRECTION',
        notes: changes.notes,
      },
      include: { commune: { include: { wilaya: true } } },
    })
  }

  /**
   * A national administrator's direct correction, with its audit record, in one
   * transaction.
   *
   * The alternative to the approval workflow, and available only to a
   * SUPER_ADMIN — see docs/audit-and-governance.md for why a scoped
   * administrator must ask instead. The reason is mandatory and becomes both the
   * record's note and the audit record's justification: one sentence, in one
   * place, so the two cannot drift apart.
   *
   * The correction and its record commit together. A ledger edit with no account
   * of who made it is the thing the trail exists to make impossible.
   */
  async correctWithAudit(
    actor: AuditActor,
    record: HistoryRecordWithPlace,
    change: { participated?: boolean; won?: boolean; verified?: boolean },
    reason: string,
  ): Promise<HistoryRecordWithPlace> {
    const justification = normalizeAuditReason('HISTORICAL_RECORD_CORRECTED', reason)

    return this.db.$transaction(async (tx) => {
      const corrected = await this.correct(record.id, { ...change, notes: reason }, tx)

      await this.audit.record(
        {
          action: 'HISTORICAL_RECORD_CORRECTED',
          actor,
          targetType: 'PARTICIPATION_HISTORY',
          targetId: corrected.id,
          scope: scopeOfCommune(corrected.commune),
          reason: justification,
          before: {
            participated: record.participated,
            won: record.won,
            verified: record.verified,
          },
          after: {
            participated: corrected.participated,
            won: corrected.won,
            verified: corrected.verified,
          },
          metadata: { drawYear: corrected.drawYear, direct: true },
        },
        tx,
      )

      return corrected
    })
  }

  /**
   * History is a record of draws that have happened.
   *
   * The current draw year is allowed — a draw could have concluded within it —
   * but nothing beyond it, since no outcome can exist for a year that has not
   * arrived. Automatic population from real draws is deferred until draw
   * processing exists.
   */
  private async assertNotFutureYear(drawYear: number): Promise<void> {
    const currentDrawYear = await this.configuration.referenceDrawYear()

    if (drawYear > currentDrawYear) {
      throw new BadRequestError('INVALID_DRAW_YEAR', 'A draw year in the future has no history to record')
    }
  }
}

function isDuplicateYear(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export const participationHistoryService = new ParticipationHistoryService()
