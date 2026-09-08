import {
  APPROVAL_STATUSES,
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZE_MAX,
  AUDIT_TARGET_TYPES,
  MAX_REASON_LENGTH,
} from '@hajj-lottery/shared'
import { z } from 'zod'

/**
 * Request shapes for the audit trail and the approval workflow.
 *
 * `.strict()` throughout, which here is doing more than tidiness: it is what
 * stops a client from putting `actorUserId` in a body and having it believed.
 * The actor is the session's user, always, and a body that names one is refused
 * rather than ignored — a request that tries to forge an identity should fail
 * loudly, not succeed with the field dropped.
 */

/**
 * A human's explanation for a change.
 *
 * Trimmed before it is measured, so whitespace cannot pass as a justification. A
 * correction nobody had to justify is indistinguishable from a mistake once
 * everybody involved has moved on.
 */
const reasonSchema = z
  .string({ required_error: 'A reason is required', invalid_type_error: 'A reason must be text' })
  .trim()
  .min(1, 'A reason is required')
  .max(MAX_REASON_LENGTH, `A reason must be at most ${MAX_REASON_LENGTH} characters`)

/**
 * GET /api/admin/audit-logs — filters and paging, all optional.
 *
 * Query strings arrive as text, so numbers and dates are coerced here rather
 * than parsed by hand in the controller.
 */
export const auditLogQuerySchema = z
  .object({
    action: z.enum(AUDIT_ACTIONS).optional(),
    actorUserId: z.string().min(1).max(100).optional(),
    targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
    targetId: z.string().min(1).max(100).optional(),
    wilayaId: z.string().min(1).max(100).optional(),
    communeId: z.string().min(1).max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(AUDIT_PAGE_SIZE_DEFAULT),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start of the range must not be after its end',
  })

/**
 * POST /api/admin/history/:id/correction-requests.
 *
 * The record and its geography come from the path and the database; the body
 * carries only what would change and why. There is no `notes` field: the reason
 * becomes the record's note, so the justification and the note cannot drift
 * apart.
 */
export const historicalCorrectionRequestSchema = z
  .object({
    participated: z.boolean().optional(),
    won: z.boolean().optional(),
    verified: z.boolean().optional(),
    reason: reasonSchema,
  })
  .strict()
  .refine(
    (value) => value.participated !== undefined || value.won !== undefined || value.verified !== undefined,
    { message: 'A correction must change participation, the outcome, or verification' },
  )

/** PATCH /api/admin/history/:id — a SUPER_ADMIN's direct correction. */
export const historicalCorrectionSchema = historicalCorrectionRequestSchema

/** POST /api/admin/approvals/:id/approve | reject | cancel — a decision needs a reason too. */
export const approvalDecisionSchema = z.object({ reason: reasonSchema }).strict()

/** GET /api/admin/approvals */
export const approvalQuerySchema = z.object({ status: z.enum(APPROVAL_STATUSES).optional() }).strict()

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>
export type HistoricalCorrectionRequestInput = z.infer<typeof historicalCorrectionRequestSchema>
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>
