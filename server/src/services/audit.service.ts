import type { AuditAction, AuditTargetType } from '@hajj-lottery/shared'
import { Prisma, type AuditLog, type PrismaClient, type User } from '@prisma/client'

import { assertSafePayload, normalizeAuditReason, type AuditPayload } from '../lib/audit-payload.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'

/**
 * The Prisma surface recording an event needs.
 *
 * Widened from `PrismaClient` deliberately: a transaction client satisfies it
 * too, which is what lets an audit record be written inside the same transaction
 * as the mutation it describes.
 */
export type AuditWriter = Pick<PrismaClient, 'auditLog'>

/**
 * Who performed an action, derived from the session and nothing else.
 *
 * A type rather than a bare id so the actor's own scope travels with them: an
 * audit record's geography is derived from the target and the actor, never taken
 * from a request.
 */
export interface AuditActor {
  id: string
  role: User['role']
  wilayaId: string | null
  communeId: string | null
}

/** The geography an action concerned. Both null means national. */
export interface AuditScope {
  wilayaId: string | null
  communeId: string | null
}

/** One event, as a caller describes it. */
export interface AuditEventInput {
  action: AuditAction
  /** Null only where no account was authenticated. */
  actor: AuditActor | null
  targetType: AuditTargetType
  targetId?: string | null
  scope?: AuditScope
  reason?: string | null
  before?: AuditPayload | null
  after?: AuditPayload | null
  metadata?: AuditPayload | null
}

/** The actor as it appears from a request. Never built from a body. */
export function auditActor(user: User): AuditActor {
  return { id: user.id, role: user.role, wilayaId: user.wilayaId, communeId: user.communeId }
}

/**
 * The geography of a commune, for an action that concerned one.
 *
 * Taken from the loaded record rather than from the actor, so a SUPER_ADMIN's
 * national action on a commune is still filed under that commune — the scope
 * describes what was touched, not who touched it.
 */
export function scopeOfCommune(commune: { id: string; wilayaId: string }): AuditScope {
  return { wilayaId: commune.wilayaId, communeId: commune.id }
}

/** A national action: nothing geographic was touched. */
export const NATIONAL_SCOPE: AuditScope = { wilayaId: null, communeId: null }

/**
 * The permanent record of what administrators did.
 *
 * Every privileged mutation goes through here rather than writing its own row,
 * so the rules about reasons, payload safety and actor identity are applied in
 * one place instead of being remembered at each call site.
 *
 * Three things this service will not do:
 *
 * - **Take an actor from a caller's input.** The actor is a `User` resolved from
 *   the session. There is no parameter that accepts an id, so a request body
 *   cannot name somebody else as the person who acted.
 * - **Write anything personal.** National IDs, phone numbers, names, dates of
 *   birth, passwords and tokens are refused outright, not masked — see
 *   lib/audit-payload.ts for why refusing beats redacting.
 * - **Update or delete.** There is no method for either, and the database would
 *   refuse one anyway.
 *
 * Recording is deliberately not fire-and-forget. There is no queue and no
 * background write: an audit insert that failed silently would leave a mutation
 * with no record of who made it, which is exactly the state this exists to
 * prevent. Callers pass their transaction so the two stand or fall together.
 */
export class AuditService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * Writes one event.
   *
   * Pass `db` — a transaction client — for anything that changes state, so the
   * mutation and its record commit together or not at all. Without it the write
   * is its own transaction, which is right for events that describe no mutation
   * of ours: a login, a logout, a failed attempt.
   */
  async record(input: AuditEventInput, db: AuditWriter = this.db): Promise<AuditLog> {
    const reason = normalizeAuditReason(input.action, input.reason)

    assertSafePayload(input.before, 'before')
    assertSafePayload(input.after, 'after')
    assertSafePayload(input.metadata, 'metadata')

    const scope = input.scope ?? NATIONAL_SCOPE

    return db.auditLog.create({
      data: {
        action: input.action,
        actorUserId: input.actor?.id ?? null,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        wilayaId: scope.wilayaId,
        communeId: scope.communeId,
        reason,
        beforeData: toJson(input.before),
        afterData: toJson(input.after),
        metadata: toJson(input.metadata),
      },
    })
  }

  /**
   * Records a security event that describes no mutation of our own.
   *
   * Kept separate because these must never take part in a caller's transaction:
   * a failed login is a fact regardless of what else the request went on to do,
   * and rolling it back with an unrelated failure would erase it.
   */
  async recordSecurityEvent(input: AuditEventInput): Promise<AuditLog> {
    return this.record(input, this.db)
  }
}

/** Prisma distinguishes "no value" from JSON null; a payload we do not have is the former. */
function toJson(payload: AuditPayload | null | undefined): Prisma.InputJsonValue | undefined {
  if (payload === null || payload === undefined) return undefined
  return payload as Prisma.InputJsonValue
}

export const auditService = new AuditService()
