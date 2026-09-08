import type {
  ApprovalRequestDto,
  AuditLogDto,
  AuditLogPageDto,
  AuditTargetType,
  ApprovalType,
  ApprovalStatus,
} from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { approvalService, type ApprovalRequestWithPlace } from '../services/approval.service.js'
import { auditActor } from '../services/audit.service.js'
import { authorizationService, type AuditLogPage } from '../services/authorization.service.js'
import { participationHistoryService } from '../services/participation-history.service.js'
import {
  approvalDecisionSchema,
  approvalQuerySchema,
  auditLogQuerySchema,
  historicalCorrectionRequestSchema,
} from '../validation/governance.js'

/**
 * The audit trail and the approval workflow.
 *
 * Two rules run through every handler here. The actor is `getAuthenticatedUser`
 * and nothing else — no body field can name somebody else as the person who
 * acted, and `.strict()` refuses a request that tries. And the geography of an
 * event comes from the record it concerns, not from what the caller says, so an
 * administrator cannot file their own action under a territory it did not touch.
 *
 * Nothing here is public. The trail names administrators and the changes they
 * made; publishing it would expose both the operations of the system and the
 * people running it.
 */

/** GET /api/admin/audit-logs — a page of the trail, narrowed to the caller's reach. */
export const listAuditLogs: RequestHandler = async (req, res) => {
  const parsed = auditLogQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid audit log query', parsed.error.flatten())
  }

  const page = await authorizationService.listAuditLogs(getAuthenticatedUser(req), parsed.data)

  res.json(toPageDto(page))
}

/**
 * POST /api/admin/history/:id/correction-requests
 *
 * The route a scoped administrator takes: they can see a record they believe is
 * wrong, and they can ask for it to be changed. They cannot change it.
 */
export const requestHistoricalCorrection: RequestHandler = async (req, res) => {
  const parsed = historicalCorrectionRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid correction request', parsed.error.flatten())
  }

  const user = getAuthenticatedUser(req)
  // Scoped first: a record in another territory is not found, exactly as an id
  // that was never issued is.
  const record = await authorizationService.findHistoryRecord(user, req.params.id ?? '')
  if (!record) throw new NotFoundError('HISTORY_NOT_FOUND', 'Historical record not found')

  const { reason, ...change } = parsed.data
  const request = await approvalService.requestHistoricalCorrection(auditActor(user), record, change, reason)

  res.status(201).json(toApprovalDto(request))
}

/**
 * PATCH /api/admin/history/:id — SUPER_ADMIN only.
 *
 * A national administrator corrects directly, because requiring a second
 * approver when there may be only one of them would mean nothing could ever be
 * fixed. The reason is mandatory and the change is audited, which is the
 * accountability that replaces the second pair of eyes.
 */
export const correctHistoryRecord: RequestHandler = async (req, res) => {
  const parsed = historicalCorrectionRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid correction', parsed.error.flatten())
  }

  const user = getAuthenticatedUser(req)
  const record = await authorizationService.findHistoryRecord(user, req.params.id ?? '')
  if (!record) throw new NotFoundError('HISTORY_NOT_FOUND', 'Historical record not found')

  const { reason, ...change } = parsed.data

  const corrected = await participationHistoryService.correctWithAudit(
    auditActor(user),
    record,
    change,
    reason,
  )

  res.json({
    id: corrected.id,
    participated: corrected.participated,
    won: corrected.won,
    verified: corrected.verified,
    notes: corrected.notes,
  })
}

/** GET /api/admin/approvals — the queue, narrowed to the caller's reach. */
export const listApprovals: RequestHandler = async (req, res) => {
  const parsed = approvalQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'Invalid approval query', parsed.error.flatten())
  }

  const requests = await authorizationService.listApprovalRequests(getAuthenticatedUser(req), parsed.data)

  res.json({ items: requests.map(toApprovalDto) })
}

/** GET /api/admin/approvals/:id */
export const getApproval: RequestHandler = async (req, res) => {
  res.json(toApprovalDto(await scopedApproval(req)))
}

/**
 * POST /api/admin/approvals/:id/approve — SUPER_ADMIN only.
 *
 * Approving is applying: the correction happens in the same transaction as the
 * decision, so a request marked approved whose change never landed cannot exist.
 */
export const approveRequest: RequestHandler = async (req, res) => {
  const request = await scopedApproval(req)
  const reason = decisionReason(req)

  const decided = await approvalService.approve(auditActor(getAuthenticatedUser(req)), request.id, reason)

  res.json(toApprovalDto(decided))
}

/** POST /api/admin/approvals/:id/reject — SUPER_ADMIN only. */
export const rejectRequest: RequestHandler = async (req, res) => {
  const request = await scopedApproval(req)
  const reason = decisionReason(req)

  const decided = await approvalService.reject(auditActor(getAuthenticatedUser(req)), request.id, reason)

  res.json(toApprovalDto(decided))
}

/**
 * POST /api/admin/approvals/:id/cancel — the requester withdraws their own.
 *
 * Not a decision on the merits, which is why it needs no reviewer and no
 * elevated role: only the author of a request may withdraw it.
 */
export const cancelRequest: RequestHandler = async (req, res) => {
  const request = await scopedApproval(req)
  const reason = decisionReason(req)

  const cancelled = await approvalService.cancel(auditActor(getAuthenticatedUser(req)), request.id, reason)

  res.json(toApprovalDto(cancelled))
}

/** Reaches the request through the caller's scope, or 404s. */
async function scopedApproval(req: Parameters<RequestHandler>[0]): Promise<ApprovalRequestWithPlace> {
  const request = await authorizationService.findApprovalRequest(
    getAuthenticatedUser(req),
    req.params.id ?? '',
  )
  if (!request) throw new NotFoundError('APPROVAL_NOT_FOUND', 'Approval request not found')

  return request
}

function decisionReason(req: Parameters<RequestHandler>[0]): string {
  const parsed = approvalDecisionSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'A decision requires a reason', parsed.error.flatten())
  }

  return parsed.data.reason
}

function toPageDto(page: AuditLogPage): AuditLogPageDto {
  const items: AuditLogDto[] = page.items.map((entry) => ({
    id: entry.id,
    action: entry.action,
    actor: entry.actor,
    targetType: entry.targetType as AuditTargetType,
    targetId: entry.targetId,
    // Codes rather than ids: the trail is read by people, and a commune code is
    // what they recognise.
    wilayaCode: entry.wilaya?.code ?? null,
    communeCode: entry.commune?.code ?? null,
    reason: entry.reason,
    before: entry.beforeData as Record<string, unknown> | null,
    after: entry.afterData as Record<string, unknown> | null,
    metadata: entry.metadata as Record<string, unknown> | null,
    createdAt: entry.createdAt.toISOString(),
  }))

  return { items, page: page.page, pageSize: page.pageSize, total: page.total, totalPages: page.totalPages }
}

function toApprovalDto(request: ApprovalRequestWithPlace): ApprovalRequestDto {
  return {
    id: request.id,
    type: request.type as ApprovalType,
    status: request.status as ApprovalStatus,
    requestedBy: request.requestedBy,
    reviewedBy: request.reviewedBy,
    targetType: request.targetType as AuditTargetType,
    targetId: request.targetId,
    wilayaCode: request.wilaya?.code ?? null,
    communeCode: request.commune?.code ?? null,
    requestedChange: request.requestedChange as Record<string, unknown>,
    reason: request.reason,
    reviewReason: request.reviewReason,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
  }
}
