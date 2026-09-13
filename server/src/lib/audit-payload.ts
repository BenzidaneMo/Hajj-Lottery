import {
  MAX_REASON_LENGTH,
  requiresReason,
  type AuditAction,
  type AuditTargetType as SharedAuditTargetType,
} from '@hajj-lottery/shared'
import { AuditAction as PrismaAuditAction, AuditTargetType as PrismaAuditTargetType } from '@prisma/client'

/**
 * What may and may not go into an audit record, as pure functions.
 *
 * The audit trail is read by people investigating something that went wrong, so
 * it has to carry enough to reconstruct the change — and it is a permanent,
 * un-deletable store, which makes it the worst possible place for anything
 * personal. These two pressures pull in opposite directions, so the boundary is
 * enforced here rather than left to each caller's judgement.
 */

/**
 * The action and target vocabularies are declared twice — as PostgreSQL enums in
 * prisma/schema.prisma and as plain unions in shared/, which the browser can
 * import without pulling in Prisma. These assertions fail the build if the two
 * drift, the same way the admin roles do.
 */
type AssertExtends<A extends B, B> = A

type _PrismaActionsAreShared = AssertExtends<PrismaAuditAction, AuditAction>
type _SharedActionsArePrisma = AssertExtends<AuditAction, PrismaAuditAction>
type _PrismaTargetsAreShared = AssertExtends<PrismaAuditTargetType, SharedAuditTargetType>
type _SharedTargetsArePrisma = AssertExtends<SharedAuditTargetType, PrismaAuditTargetType>

/** A limited field snapshot. Built by a service from typed values, never a body. */
export type AuditPayload = Record<string, unknown>

/**
 * Field names that must never reach the trail.
 *
 * Identity and secrets, matched on the shape of the name rather than an exact
 * list, so `nationalId`, `national_id` and `primaryNationalId` are all caught. An
 * audit record outlives the thing it describes and cannot be deleted, so a
 * national ID written here is written for good.
 *
 * Matching is on keys rather than values deliberately: guessing at values would
 * mean either missing things or redacting legitimate ones, and the callers here
 * build small typed payloads where the key is always known.
 */
const FORBIDDEN_KEY_PATTERNS = [
  /national.?id/i,
  /phone/i,
  /password/i,
  /token/i,
  /secret/i,
  /api.?key/i,
  /\bdob\b/i,
  /date.?of.?birth/i,
  /full.?name/i,
  /first.?name/i,
  /last.?name/i,
]

/**
 * A generous ceiling on one snapshot, in serialized characters.
 *
 * Not a performance limit — it is what stops a caller from quietly turning the
 * audit trail into a copy of the database by passing an entire record, or a
 * whole request body, where a handful of changed fields belongs.
 */
export const MAX_PAYLOAD_CHARACTERS = 4000

/**
 * Checks one snapshot and returns it unchanged.
 *
 * **Refuses rather than redacts.** A payload containing a national ID is a
 * programming mistake in a service, not user input to be sanitised, and silently
 * dropping the field would leave an audit record that looks complete while
 * describing something else. Failing loudly means a test catches it; masking
 * means nobody ever finds out.
 */
export function assertSafePayload(payload: AuditPayload | null | undefined, label: string): void {
  if (payload === null || payload === undefined) return

  for (const key of collectKeys(payload)) {
    const forbidden = FORBIDDEN_KEY_PATTERNS.find((pattern) => pattern.test(key))
    if (forbidden) {
      throw new Error(`Refusing to write personal or secret data to the audit trail: ${label}.${key}`)
    }
  }

  const serialized = JSON.stringify(payload)
  if (serialized !== undefined && serialized.length > MAX_PAYLOAD_CHARACTERS) {
    throw new Error(
      `Refusing an audit ${label} of ${serialized.length} characters; the limit is ${MAX_PAYLOAD_CHARACTERS}. ` +
        'Record the fields that changed, not the whole record.',
    )
  }
}

/** Every key in an object, including nested ones. */
function collectKeys(value: unknown, depth = 0): string[] {
  if (depth > 10 || value === null || typeof value !== 'object') return []

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectKeys(item, depth + 1))
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested, depth + 1),
  ])
}

/**
 * The reason a mutation was made, checked against the action that needs it.
 *
 * Whitespace is not a justification, so a blank reason is refused exactly as a
 * missing one is. Returns the trimmed text, or null where the action does not
 * require one and none was given.
 */
export function normalizeAuditReason(action: AuditAction, reason: string | null | undefined): string | null {
  const trimmed = reason?.trim() ?? ''

  if (trimmed.length === 0) {
    if (requiresReason(action)) {
      throw new Error(`Refusing to record ${action} without a reason`)
    }
    return null
  }

  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new Error(`Refusing an audit reason longer than ${MAX_REASON_LENGTH} characters`)
  }

  return trimmed
}

/**
 * The fields that actually changed, as a before/after pair.
 *
 * Only the differences, because a snapshot of everything makes the one field
 * that moved hard to find and copies data the trail has no business holding.
 * Returns nulls when nothing changed, so an audit record never claims a change
 * it cannot show.
 */
export function diffSnapshots<T extends AuditPayload>(
  before: T,
  after: T,
): { before: AuditPayload | null; after: AuditPayload | null } {
  const changedBefore: AuditPayload = {}
  const changedAfter: AuditPayload = {}

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.is(before[key], after[key])) {
      changedBefore[key] = before[key] ?? null
      changedAfter[key] = after[key] ?? null
    }
  }

  if (Object.keys(changedAfter).length === 0) return { before: null, after: null }

  return { before: changedBefore, after: changedAfter }
}
