import {
  IMPORT_BATCH_STATUSES,
  IMPORT_ROW_PAGE_SIZE_DEFAULT,
  IMPORT_ROW_PAGE_SIZE_MAX,
  IMPORT_ROW_STATUSES,
  MAX_REASON_LENGTH,
} from '@hajj-lottery/shared'
import { z } from 'zod'

/**
 * Request shapes for the legacy import.
 *
 * `.strict()` throughout, and here it is load-bearing rather than tidy. The
 * register arrives as a file and everything else — who is acting, what territory
 * they may speak for, which draw year a row belongs to — comes from the session
 * and from the file's own contents. A body that tries to supply an uploader, a
 * batch status, a verification flag or a participation source is refused rather
 * than having the field quietly dropped, because a request attempting to set one
 * of those is not a request to satisfy.
 *
 * There is deliberately no schema for the upload's body at all: the endpoint is
 * multipart and takes one file. Nothing accompanies it.
 */

const reasonSchema = z
  .string({ required_error: 'A reason is required', invalid_type_error: 'A reason must be text' })
  .trim()
  .min(1, 'A reason is required')
  .max(MAX_REASON_LENGTH, `A reason must be at most ${MAX_REASON_LENGTH} characters`)

/** GET /api/admin/imports */
export const importListQuerySchema = z.object({ status: z.enum(IMPORT_BATCH_STATUSES).optional() }).strict()

/** GET /api/admin/imports/:id/rows and /conflicts */
export const importRowQuerySchema = z
  .object({
    status: z.enum(IMPORT_ROW_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(IMPORT_ROW_PAGE_SIZE_MAX)
      .default(IMPORT_ROW_PAGE_SIZE_DEFAULT),
  })
  .strict()

/**
 * POST /api/admin/imports/:id/approve | reject.
 *
 * A reason, and nothing else. Not the batch's status — that is decided by which
 * endpoint was called — and not the approver, who is the session's user.
 */
export const importDecisionSchema = z.object({ reason: reasonSchema }).strict()

export type ImportListQuery = z.infer<typeof importListQuerySchema>
export type ImportRowQuery = z.infer<typeof importRowQuerySchema>
export type ImportDecisionInput = z.infer<typeof importDecisionSchema>
