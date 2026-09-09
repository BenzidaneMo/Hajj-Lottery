import {
  ADMIN_PAGE_SIZE_DEFAULT,
  ADMIN_PAGE_SIZE_MAX,
  ADMIN_ROLES,
  APPLICATION_STATUSES,
  ENTRY_TYPES,
  MAX_REASON_LENGTH,
  NATIONAL_ID_LENGTH,
} from '@hajj-lottery/shared'
import { z } from 'zod'

import { MIN_PASSWORD_LENGTH } from '../lib/password.js'

/**
 * Request shapes for the administrative console.
 *
 * `.strict()` throughout, on the query schemas as well as the bodies. An
 * unrecognised filter is refused rather than dropped: a console that silently
 * ignored `?communeId=` would show one territory's data under another's label,
 * and the operator would have no way to tell.
 */

const pagingFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(ADMIN_PAGE_SIZE_MAX).default(ADMIN_PAGE_SIZE_DEFAULT),
}

/**
 * GET /api/admin/applications.
 *
 * `applicationReference` is matched exactly by the service. It is accepted here
 * as free text only because a receipt's format is the citizen's to type, not
 * because anything less than the whole of it will match.
 */
export const adminApplicationQuerySchema = z
  .object({
    drawYear: z.coerce.number().int().min(2000).max(2200).optional(),
    wilayaId: z.string().min(1).max(100).optional(),
    communeId: z.string().min(1).max(100).optional(),
    status: z.enum(APPLICATION_STATUSES).optional(),
    entryType: z.enum(ENTRY_TYPES).optional(),
    applicationReference: z.string().trim().min(1).max(64).optional(),
    ...pagingFields,
  })
  .strict()

/**
 * GET /api/admin/participants.
 *
 * A national ID is accepted only whole. Anything shorter is refused rather than
 * treated as a prefix: a registry that answered "which IDs begin with these
 * digits?" would be a way to discover who exists.
 */
export const adminParticipantQuerySchema = z
  .object({
    name: z.string().trim().min(2).max(150).optional(),
    nationalId: z.string().trim().length(NATIONAL_ID_LENGTH).optional(),
    hasWonHajj: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    ...pagingFields,
  })
  .strict()

const reasonSchema = z
  .string({ required_error: 'A reason is required', invalid_type_error: 'A reason must be text' })
  .trim()
  .min(1, 'A reason is required')
  .max(MAX_REASON_LENGTH)

/**
 * The role and geography half of an account, shared by creation and scope
 * changes. Nulls are accepted so a national account can be stated explicitly
 * rather than by omission; the service rejects any combination the role forbids.
 */
const assignmentFields = {
  role: z.enum(ADMIN_ROLES),
  wilayaId: z.string().min(1).max(100).nullish(),
  communeId: z.string().min(1).max(100).nullish(),
}

/**
 * POST /api/admin/admins.
 *
 * No `isActive`: a new account is active, and an endpoint that could create a
 * disabled one would be a way to reserve a username. No reason field either —
 * creating an account is not a correction, and demanding a sentence for routine
 * work teaches everybody to type one.
 */
export const createAdminSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, 'A username must be at least 3 characters')
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/, 'A username may use letters, digits, dot, underscore and hyphen'),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `A password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(1024),
    ...assignmentFields,
  })
  .strict()

/** PATCH /api/admin/admins/:id/scope — a privilege change, so a reason is required. */
export const changeAdminScopeSchema = z.object({ ...assignmentFields, reason: reasonSchema }).strict()

/** POST /api/admin/admins/:id/deactivate. */
export const deactivateAdminSchema = z.object({ reason: reasonSchema }).strict()
