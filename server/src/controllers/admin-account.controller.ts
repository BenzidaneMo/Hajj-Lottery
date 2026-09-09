import type { AdminUserDto } from '@hajj-lottery/shared'
import type { RequestHandler } from 'express'

import { BadRequestError, NotFoundError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { adminAccountService, type UserWithPlaces } from '../services/admin-account.service.js'
import {
  changeAdminScopeSchema,
  createAdminSchema,
  deactivateAdminSchema,
} from '../validation/admin-console.js'
import { toPlaceDto } from './admin-console.controller.js'

/**
 * Administrator accounts.
 *
 * SUPER_ADMIN-only at the route, and unscoped: an administrator's authority is
 * not a property of a territory even when it names one. The account rules —
 * no self-editing, no granting reach you do not hold, no removing the last way
 * in — live in `AdminAccountService` and are enforced there, so this layer only
 * validates shapes and maps DTOs.
 *
 * There is no password reset here. Changing somebody else's credential is a
 * different operation with different safeguards, and none of them exist yet;
 * an endpoint that quietly overwrote a password would be a backdoor with a
 * form in front of it.
 */

/** GET /api/admin/admins */
export const listAdmins: RequestHandler = async (_req, res) => {
  const admins = await adminAccountService.list()
  res.json({ items: admins.map(toAdminUserDto) })
}

/** POST /api/admin/admins */
export const createAdmin: RequestHandler = async (req, res) => {
  const parsed = createAdminSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the account details',
      parsed.error.flatten().fieldErrors,
    )
  }

  const created = await adminAccountService.create(getAuthenticatedUser(req), parsed.data)
  res.status(201).json(toAdminUserDto(created))
}

/**
 * PATCH /api/admin/admins/:id/scope
 *
 * A reason is mandatory, and the trail records both the previous and the new
 * assignment. A widened reach with no account of who widened it is the one
 * state nobody could investigate afterwards.
 */
export const changeAdminScope: RequestHandler = async (req, res) => {
  const targetId = requireId(req.params.id)

  const parsed = changeAdminScopeSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError(
      'VALIDATION_FAILED',
      'Please check the role and scope',
      parsed.error.flatten().fieldErrors,
    )
  }

  const { reason, ...assignment } = parsed.data
  await adminAccountService.changeScope(getAuthenticatedUser(req), targetId, assignment, reason)

  res.json(toAdminUserDto(await readAdmin(targetId)))
}

/**
 * POST /api/admin/admins/:id/deactivate
 *
 * Not a DELETE: the account is the actor on audit records that must outlive it.
 * Their sessions go with it, inside the service's transaction — an account
 * disabled only for future sign-ins is not disabled.
 */
export const deactivateAdmin: RequestHandler = async (req, res) => {
  const targetId = requireId(req.params.id)

  const parsed = deactivateAdminSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new BadRequestError('VALIDATION_FAILED', 'A reason is required', parsed.error.flatten().fieldErrors)
  }

  await adminAccountService.deactivate(getAuthenticatedUser(req), targetId, parsed.data.reason)

  res.json(toAdminUserDto(await readAdmin(targetId)))
}

function requireId(value: string | undefined): string {
  if (!value) throw new NotFoundError('USER_NOT_FOUND', 'Administrator not found')
  return value
}

/** Re-reads the account with its places, so the response reflects what was written. */
async function readAdmin(id: string): Promise<UserWithPlaces> {
  const found = await adminAccountService.findById(id)
  if (!found) throw new NotFoundError('USER_NOT_FOUND', 'Administrator not found')
  return found
}

function toAdminUserDto(user: UserWithPlaces): AdminUserDto {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    wilaya: user.wilaya ? toPlaceDto(user.wilaya) : null,
    commune: user.commune ? toPlaceDto(user.commune) : null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}
