/**
 * The audit trail and the approval framework.
 *
 * An audit record is not application data. Application data says what is true
 * now and changes when the truth changes; an audit record says what somebody
 * did, which never stops being what they did. Nothing updates or deletes one.
 *
 * Nothing here is public. The trail names administrators and the changes they
 * made, and publishing it would expose both the operations of the system and
 * the people running it.
 */

/**
 * The closed catalogue of privileged actions.
 *
 * An enum rather than free strings, so an action either exists here or cannot be
 * logged at all — a typo becomes a compile error instead of a category nobody
 * ever queries. Only actions something can actually perform are listed: a
 * catalogue full of events that never fire reads like coverage while providing
 * none.
 */
export const AUDIT_ACTIONS = [
  /** A failure carries no actor — saying whose login failed would answer the
   *  question the login route deliberately refuses to. */
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILURE',
  'AUTH_LOGOUT',

  /** ADMIN_CREATED also covers the bootstrap, where no actor is authenticated:
   *  the first SUPER_ADMIN appearing is precisely the event worth recording. */
  'ADMIN_CREATED',
  'ADMIN_DISABLED',
  'ADMIN_SCOPE_CHANGED',

  /** The transition itself is in the before/after snapshot rather than in
   *  separate OPENED/CLOSED actions, so there is one account of what changed. */
  'DRAW_YEAR_CREATED',
  'DRAW_YEAR_STATUS_CHANGED',
  'COMMUNE_DRAW_CREATED',
  'COMMUNE_DRAW_UPDATED',

  /** Freezing locks the commune draw in the same transaction, so this is the
   *  record of both. */
  'DRAW_POOL_FROZEN',
  'COMMUNE_DRAW_EXECUTED',

  /** Only corrections: a concluded draw writes hundreds of historical records at
   *  once, and the execution event is their provenance. */
  'HISTORICAL_RECORD_CORRECTED',

  /** The legacy import, which writes history in bulk and excludes people from
   *  every future draw for life. Four events rather than one because the four
   *  moments have different actors and different consequences: uploading stages
   *  nothing authoritative, approving still writes nothing, and only completion
   *  changes what the lottery will see. */
  'LEGACY_IMPORT_CREATED',
  'LEGACY_IMPORT_APPROVED',
  'LEGACY_IMPORT_REJECTED',
  'LEGACY_IMPORT_COMPLETED',

  'APPROVAL_CREATED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_CANCELLED',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** What kind of thing an audit record or an approval request is about. */
export const AUDIT_TARGET_TYPES = [
  'USER',
  'DRAW_YEAR',
  'COMMUNE_DRAW',
  'DRAW_POOL',
  'DRAW_RESULT',
  'PARTICIPATION_HISTORY',
  'APPROVAL_REQUEST',
  'IMPORT_BATCH',
] as const

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]

/**
 * Actions that may not be recorded without a human explanation.
 *
 * A correction that nobody had to justify is indistinguishable from a mistake
 * afterwards, so the reason is part of the operation rather than a courtesy.
 * Routine and automatic events are absent: demanding a sentence for a login
 * would train everybody to type one.
 */
export const REASON_REQUIRED_ACTIONS: readonly AuditAction[] = [
  'HISTORICAL_RECORD_CORRECTED',
  'ADMIN_SCOPE_CHANGED',
  'ADMIN_DISABLED',
  /** Accepting or refusing a legacy batch is a judgement about evidence nobody
   *  else can re-examine once the paper register is filed away. */
  'LEGACY_IMPORT_APPROVED',
  'LEGACY_IMPORT_REJECTED',
  'APPROVAL_CREATED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_CANCELLED',
]

export function requiresReason(action: AuditAction): boolean {
  return REASON_REQUIRED_ACTIONS.includes(action)
}

/** Long enough for a paragraph of justification, short enough not to be a file. */
export const MAX_REASON_LENGTH = 1000

/** What a sensitive change can be requested for. */
export const APPROVAL_TYPES = ['HISTORICAL_RECORD_CORRECTION'] as const
export type ApprovalType = (typeof APPROVAL_TYPES)[number]

/** Where a request stands. Terminal in every case but PENDING. */
export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]

/**
 * One recorded action, as an administrator reads it.
 *
 * The actor is named by username rather than by internal id — an audit trail
 * nobody can read is not oversight — but nothing else about them is exposed.
 */
export interface AuditLogDto {
  id: string
  action: AuditAction
  /** Null where no account was authenticated: a failed login, or the bootstrap. */
  actor: { id: string; username: string } | null
  targetType: AuditTargetType
  targetId: string | null
  /** Null on both for a national action. */
  wilayaCode: string | null
  communeCode: string | null
  reason: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

/** A page of the trail. The whole trail is never returned. */
export interface AuditLogPageDto {
  items: AuditLogDto[]
  page: number
  pageSize: number
  /** Matching records, not records returned. */
  total: number
  totalPages: number
}

export const AUDIT_PAGE_SIZE_DEFAULT = 50
export const AUDIT_PAGE_SIZE_MAX = 200

/** A sensitive change somebody asked for, and what was decided. */
export interface ApprovalRequestDto {
  id: string
  type: ApprovalType
  status: ApprovalStatus
  requestedBy: { id: string; username: string }
  /** Null while pending, and for a withdrawal — only the requester may cancel. */
  reviewedBy: { id: string; username: string } | null
  targetType: AuditTargetType
  targetId: string
  wilayaCode: string | null
  communeCode: string | null
  requestedChange: Record<string, unknown>
  reason: string
  reviewReason: string | null
  reviewedAt: string | null
  createdAt: string
}
