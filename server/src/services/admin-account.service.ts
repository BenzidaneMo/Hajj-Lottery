import { AdminRole, type PrismaClient, type User } from '@prisma/client'

import { ApiError, ForbiddenError } from '../lib/errors.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'
import { canAccessCommune, canAccessWilaya, resolveScope } from '../lib/scope.js'

/** A requested role/scope assignment, before it has been proven valid. */
export interface ScopeAssignment {
  role: AdminRole
  wilayaId?: string | null
  communeId?: string | null
}

/** A validated assignment, safe to write. */
export interface ValidatedScopeAssignment {
  role: AdminRole
  wilayaId: string | null
  communeId: string | null
}

/**
 * The details a future audit log will need. Returned by mutating operations
 * so the caller can record them; nothing is written yet, and no placeholder
 * audit rows are created.
 */
export interface ScopeChangeRecord {
  actorId: string
  targetUserId: string
  previous: ValidatedScopeAssignment
  next: ValidatedScopeAssignment
  occurredAt: Date
}

function invalid(message: string): ApiError {
  return new ApiError(422, 'INVALID_SCOPE_ASSIGNMENT', message)
}

/**
 * Administrator account rules that must hold regardless of which endpoint or
 * script is doing the work.
 *
 * The administrator management UI is not built yet; this exists so that when
 * it is, the rules are already here and enforced in one place rather than
 * being reinvented per endpoint.
 */
export class AdminAccountService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * Checks a role/scope combination and that the referenced places exist and
   * are related as claimed. The database enforces the same invariants, but
   * failing here produces a clear 422 instead of a constraint violation.
   */
  async validateAssignment(assignment: ScopeAssignment): Promise<ValidatedScopeAssignment> {
    const wilayaId = assignment.wilayaId ?? null
    const communeId = assignment.communeId ?? null

    switch (assignment.role) {
      case AdminRole.SUPER_ADMIN:
        if (wilayaId !== null || communeId !== null) {
          throw invalid('A SUPER_ADMIN is national and must not be assigned a wilaya or commune')
        }
        return { role: assignment.role, wilayaId: null, communeId: null }

      case AdminRole.WILAYA_ADMIN: {
        if (wilayaId === null) throw invalid('A WILAYA_ADMIN must be assigned a wilaya')
        if (communeId !== null) throw invalid('A WILAYA_ADMIN must not be assigned a commune')
        await this.assertWilayaExists(wilayaId)
        return { role: assignment.role, wilayaId, communeId: null }
      }

      case AdminRole.COMMUNE_ADMIN: {
        if (wilayaId === null) throw invalid('A COMMUNE_ADMIN must be assigned a wilaya')
        if (communeId === null) throw invalid('A COMMUNE_ADMIN must be assigned a commune')

        const commune = await this.db.commune.findUnique({ where: { id: communeId } })
        if (!commune) throw invalid('The assigned commune does not exist')
        if (commune.wilayaId !== wilayaId) {
          throw invalid('The assigned commune does not belong to the assigned wilaya')
        }
        return { role: assignment.role, wilayaId, communeId }
      }
    }
  }

  /**
   * Refuses assignments that would grant more reach than the actor has.
   *
   * Only a SUPER_ADMIN can mint another SUPER_ADMIN, and a scoped
   * administrator can only ever assign inside their own territory — so
   * privilege cannot be widened by anyone who does not already hold it.
   */
  assertMayAssign(actor: User, assignment: ValidatedScopeAssignment): void {
    const actorScope = resolveScope(actor)

    if (assignment.role === AdminRole.SUPER_ADMIN && actorScope.kind !== 'national') {
      throw new ForbiddenError('FORBIDDEN_ROLE', 'Only a SUPER_ADMIN may grant national access')
    }

    if (assignment.wilayaId && !canAccessWilaya(actorScope, assignment.wilayaId)) {
      throw new ForbiddenError('FORBIDDEN_SCOPE', 'You cannot assign access outside your own scope')
    }

    if (assignment.communeId && assignment.wilayaId) {
      const target = { id: assignment.communeId, wilayaId: assignment.wilayaId }
      if (!canAccessCommune(actorScope, target)) {
        throw new ForbiddenError('FORBIDDEN_SCOPE', 'You cannot assign access outside your own scope')
      }
    }
  }

  /**
   * Nobody edits their own role or scope, not even a SUPER_ADMIN — the
   * privileged path to change it is another administrator, which keeps a
   * single compromised session from quietly widening itself.
   */
  assertNotSelf(actor: User, targetUserId: string): void {
    if (actor.id === targetUserId) {
      throw new ForbiddenError('FORBIDDEN_SCOPE', 'You cannot change your own role or geographic scope')
    }
  }

  /**
   * Safety invariant: the system must never be left with no way in.
   *
   * Called before deactivating, deleting, or demoting an administrator.
   * Counting inside the caller's transaction would be stronger still; that
   * belongs with the operations themselves, which do not exist yet.
   */
  async assertNotLastSuperAdmin(targetUserId: string): Promise<void> {
    const target = await this.db.user.findUnique({ where: { id: targetUserId } })
    if (!target || target.role !== AdminRole.SUPER_ADMIN || !target.isActive) return

    const remaining = await this.db.user.count({
      where: { role: AdminRole.SUPER_ADMIN, isActive: true, id: { not: targetUserId } },
    })

    if (remaining === 0) {
      throw new ApiError(
        409,
        'LAST_SUPER_ADMIN',
        'This is the last active SUPER_ADMIN and cannot be deactivated, deleted or demoted',
      )
    }
  }

  /**
   * The full guard for changing another administrator's role/scope. Returns
   * the record a future audit log should persist.
   */
  async prepareScopeChange(actor: User, targetUserId: string, requested: ScopeAssignment) {
    this.assertNotSelf(actor, targetUserId)

    const target = await this.db.user.findUnique({ where: { id: targetUserId } })
    if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'Administrator not found')

    const next = await this.validateAssignment(requested)
    this.assertMayAssign(actor, next)

    // Demoting the last SUPER_ADMIN is as damaging as deleting them.
    if (target.role === AdminRole.SUPER_ADMIN && next.role !== AdminRole.SUPER_ADMIN) {
      await this.assertNotLastSuperAdmin(targetUserId)
    }

    const change: ScopeChangeRecord = {
      actorId: actor.id,
      targetUserId,
      previous: { role: target.role, wilayaId: target.wilayaId, communeId: target.communeId },
      next,
      occurredAt: new Date(),
    }

    return change
  }

  private async assertWilayaExists(wilayaId: string): Promise<void> {
    const wilaya = await this.db.wilaya.findUnique({ where: { id: wilayaId } })
    if (!wilaya) throw invalid('The assigned wilaya does not exist')
  }
}

export const adminAccountService = new AdminAccountService()
