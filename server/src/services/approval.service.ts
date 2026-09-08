import type { ApprovalStatus } from '@hajj-lottery/shared'
import type { ApprovalRequest, Commune, PrismaClient, User, Wilaya } from '@prisma/client'

import { normalizeAuditReason } from '../lib/audit-payload.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { auditService, AuditService, scopeOfCommune, type AuditActor } from './audit.service.js'
import {
  participationHistoryService,
  ParticipationHistoryService,
  type HistoryRecordWithPlace,
} from './participation-history.service.js'

/** A request with the geography needed to present or authorize it. */
export type ApprovalRequestWithPlace = ApprovalRequest & {
  requestedBy: Pick<User, 'id' | 'username'>
  reviewedBy: Pick<User, 'id' | 'username'> | null
  wilaya: Wilaya | null
  commune: Commune | null
}

/**
 * What a historical correction would change.
 *
 * The same fields the correction itself takes, so approving cannot mean
 * something different from what was asked. `notes` is deliberately absent: the
 * request's own reason becomes the record's note, because the justification for
 * a correction and the note explaining it are the same sentence, and keeping two
 * copies invites them to disagree.
 */
export interface HistoricalCorrectionChange {
  participated?: boolean
  won?: boolean
  verified?: boolean
}

/**
 * Separation of duties for changes that are too consequential to make alone.
 *
 * The rule this encodes: an administrator who can *see* a record they believe is
 * wrong cannot rewrite it — they can only ask. Somebody else decides. A scoped
 * administrator has every reason to want a correction and no independent check on
 * whether it is warranted, and the participation ledger drives who gets priority
 * in a lottery, so an unreviewable edit there is an unreviewable thumb on the
 * scale.
 *
 * A SUPER_ADMIN may correct directly, because requiring another approver when
 * one may be the only national administrator would mean nothing could ever be
 * fixed. Their correction is still audited and still requires a reason, which is
 * the accountability that replaces the second pair of eyes.
 *
 * Nobody reviews their own request. That is checked here, and also by a CHECK
 * constraint, because a rule that lives only in a service is a rule a later
 * refactor can drop.
 */
export class ApprovalService {
  private readonly db: PrismaClient
  private readonly audit: AuditService
  private readonly history: ParticipationHistoryService

  constructor(
    db: PrismaClient = defaultPrisma,
    audit: AuditService = auditService,
    history: ParticipationHistoryService = participationHistoryService,
  ) {
    this.db = db
    this.audit = audit
    this.history = history
  }

  /**
   * Raises a request to correct one historical record.
   *
   * The request and its audit row are written together: a request nobody can see
   * the origin of is worse than no request at all.
   */
  async requestHistoricalCorrection(
    actor: AuditActor,
    record: HistoryRecordWithPlace,
    change: HistoricalCorrectionChange,
    reason: string,
  ): Promise<ApprovalRequestWithPlace> {
    const justification = normalizeAuditReason('APPROVAL_CREATED', reason)
    assertChangesSomething(change, record)

    return this.db.$transaction(async (tx) => {
      const created = await tx.approvalRequest.create({
        data: {
          type: 'HISTORICAL_RECORD_CORRECTION',
          status: 'PENDING',
          requestedByUserId: actor.id,
          targetType: 'PARTICIPATION_HISTORY',
          targetId: record.id,
          ...scopeOfCommune(record.commune),
          requestedChange: { ...change },
          reason: justification ?? reason,
        },
        include: REQUEST_INCLUDE,
      })

      await this.audit.record(
        {
          action: 'APPROVAL_CREATED',
          actor,
          targetType: 'APPROVAL_REQUEST',
          targetId: created.id,
          scope: scopeOfCommune(record.commune),
          reason: created.reason,
          metadata: { approvalType: created.type, historyRecordId: record.id },
          after: { ...change },
        },
        tx,
      )

      return created
    })
  }

  /**
   * Approves a request and applies it, in one transaction.
   *
   * Approving *is* applying: a request marked approved whose change never
   * happened would be a decision with no effect, and nothing afterwards could
   * tell which of the two was true. Both the decision and the correction are
   * audited — the first records who allowed it, the second what it did.
   */
  async approve(
    actor: AuditActor,
    requestId: string,
    reviewReason: string,
  ): Promise<ApprovalRequestWithPlace> {
    const justification = normalizeAuditReason('APPROVAL_APPROVED', reviewReason)
    const request = await this.pending(requestId)
    this.assertNotSelfReview(actor, request)

    return this.db.$transaction(async (tx) => {
      const claimed = await this.claim(tx, requestId, 'APPROVED', actor.id, justification)

      const before = await tx.participationHistory.findUnique({ where: { id: request.targetId } })
      if (!before) throw new NotFoundError('HISTORY_NOT_FOUND', 'Historical record not found')

      const change = request.requestedChange as HistoricalCorrectionChange
      const corrected = await this.history.correct(
        request.targetId,
        // The request's reason becomes the record's note: one sentence, one place.
        { ...change, notes: request.reason },
        tx,
      )

      const scope = scopeOfCommune(corrected.commune)

      await this.audit.record(
        {
          action: 'APPROVAL_APPROVED',
          actor,
          targetType: 'APPROVAL_REQUEST',
          targetId: request.id,
          scope,
          reason: justification,
          metadata: { approvalType: request.type, requestedByUserId: request.requestedByUserId },
        },
        tx,
      )

      await this.audit.record(
        {
          action: 'HISTORICAL_RECORD_CORRECTED',
          actor,
          targetType: 'PARTICIPATION_HISTORY',
          targetId: corrected.id,
          scope,
          reason: request.reason,
          before: { participated: before.participated, won: before.won, verified: before.verified },
          after: {
            participated: corrected.participated,
            won: corrected.won,
            verified: corrected.verified,
          },
          metadata: { approvalRequestId: request.id },
        },
        tx,
      )

      return claimed
    })
  }

  /** Refuses a request. The record is untouched, and the refusal is permanent. */
  async reject(
    actor: AuditActor,
    requestId: string,
    reviewReason: string,
  ): Promise<ApprovalRequestWithPlace> {
    const justification = normalizeAuditReason('APPROVAL_REJECTED', reviewReason)
    const request = await this.pending(requestId)
    this.assertNotSelfReview(actor, request)

    return this.db.$transaction(async (tx) => {
      const claimed = await this.claim(tx, requestId, 'REJECTED', actor.id, justification)

      await this.audit.record(
        {
          action: 'APPROVAL_REJECTED',
          actor,
          targetType: 'APPROVAL_REQUEST',
          targetId: request.id,
          scope: { wilayaId: request.wilayaId, communeId: request.communeId },
          reason: justification,
          metadata: { approvalType: request.type, requestedByUserId: request.requestedByUserId },
        },
        tx,
      )

      return claimed
    })
  }

  /**
   * Withdraws a request, which only its author may do.
   *
   * The reviewer is left null rather than recording the requester as their own:
   * a withdrawal is not a decision about the merits, and filing it as one would
   * make every cancellation look like a self-approval.
   */
  async cancel(actor: AuditActor, requestId: string, reason: string): Promise<ApprovalRequestWithPlace> {
    const justification = normalizeAuditReason('APPROVAL_CANCELLED', reason)
    const request = await this.pending(requestId)

    if (request.requestedByUserId !== actor.id) {
      throw new ForbiddenError(
        'FORBIDDEN_ROLE',
        'Only the administrator who raised a request may withdraw it',
      )
    }

    return this.db.$transaction(async (tx) => {
      const claimed = await this.claim(tx, requestId, 'CANCELLED', null, justification)

      await this.audit.record(
        {
          action: 'APPROVAL_CANCELLED',
          actor,
          targetType: 'APPROVAL_REQUEST',
          targetId: request.id,
          scope: { wilayaId: request.wilayaId, communeId: request.communeId },
          reason: justification,
          metadata: { approvalType: request.type },
        },
        tx,
      )

      return claimed
    })
  }

  /** One request, unscoped. Callers reaching an administrator go through
   *  AuthorizationService instead, so scope cannot be forgotten. */
  async findById(id: string): Promise<ApprovalRequestWithPlace | null> {
    return this.db.approvalRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE })
  }

  /**
   * Takes the decision, conditionally on the request still being pending.
   *
   * A conditional update rather than a check followed by a write: two reviewers
   * deciding at once serialize on the row, and the second matches nothing rather
   * than overwriting the first's decision. The trigger would refuse it anyway;
   * this turns a constraint violation into a sentence.
   */
  private async claim(
    tx: Pick<PrismaClient, 'approvalRequest'>,
    requestId: string,
    status: Exclude<ApprovalStatus, 'PENDING'>,
    reviewerId: string | null,
    reviewReason: string | null,
  ): Promise<ApprovalRequestWithPlace> {
    const claimed = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status, reviewedByUserId: reviewerId, reviewReason, reviewedAt: new Date() },
    })

    if (claimed.count !== 1) {
      throw new ConflictError('APPROVAL_NOT_PENDING', 'This request has already been decided')
    }

    const request = await tx.approvalRequest.findUnique({
      where: { id: requestId },
      include: REQUEST_INCLUDE,
    })
    if (!request) throw new NotFoundError('APPROVAL_NOT_FOUND', 'Approval request not found')

    return request
  }

  private async pending(requestId: string): Promise<ApprovalRequestWithPlace> {
    const request = await this.findById(requestId)
    if (!request) throw new NotFoundError('APPROVAL_NOT_FOUND', 'Approval request not found')

    if (request.status !== 'PENDING') {
      throw new ConflictError('APPROVAL_NOT_PENDING', 'This request has already been decided')
    }

    return request
  }

  /**
   * Nobody decides their own request.
   *
   * The point of the workflow is a second pair of eyes; an administrator who can
   * approve what they asked for has the unreviewed edit the request existed to
   * prevent, with paperwork attached.
   */
  private assertNotSelfReview(actor: AuditActor, request: ApprovalRequest): void {
    if (request.requestedByUserId === actor.id) {
      throw new ForbiddenError(
        'SELF_APPROVAL_FORBIDDEN',
        'An administrator cannot decide their own request. Another SUPER_ADMIN must review it.',
      )
    }
  }
}

const REQUEST_INCLUDE = {
  requestedBy: { select: { id: true, username: true } },
  reviewedBy: { select: { id: true, username: true } },
  wilaya: true,
  commune: true,
} as const

/**
 * A request must ask for something.
 *
 * An approval workflow for a change that changes nothing wastes a reviewer's
 * attention, and an approved no-op in the trail reads like a correction that was
 * made when none was.
 */
function assertChangesSomething(change: HistoricalCorrectionChange, record: HistoryRecordWithPlace): void {
  const differs =
    (change.participated !== undefined && change.participated !== record.participated) ||
    (change.won !== undefined && change.won !== record.won) ||
    (change.verified !== undefined && change.verified !== record.verified)

  if (!differs) {
    throw new BadRequestError('VALIDATION_FAILED', 'This request would not change the record')
  }
}

export const approvalService = new ApprovalService()
