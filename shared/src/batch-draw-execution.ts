/**
 * Batch draw execution.
 *
 * A SUPER_ADMIN-only orchestration over the existing per-commune atomic
 * `DrawExecutionService.execute` — this introduces no new selection logic,
 * no combined pools, and no seed derived from the batch. Each commune in the
 * batch is executed exactly as it would be one at a time; batching only
 * saves the operator from doing that by hand across an entire draw year.
 *
 * Two requests, always in this order: `validate` discovers what is ready
 * without changing anything, and only an explicit confirmation of exactly
 * that set may then be sent to `execute`.
 */

/** Why a commune draw was excluded from a batch run. */
export const BATCH_NOT_READY_REASONS = ['NOT_LOCKED', 'NO_POOL', 'INSUFFICIENT_ENTRIES'] as const
export type BatchNotReadyReason = (typeof BATCH_NOT_READY_REASONS)[number]

/** One commune draw, as the batch screens need to show it — no more. */
export interface BatchCandidateDto {
  communeDrawId: string
  commune: { id: string; code: string; nameAr: string; nameFr: string; nameEn: string }
  wilaya: { id: string; code: string; nameAr: string; nameFr: string; nameEn: string }
  allocatedSpots: number
}

export interface BatchNotReadyCandidateDto extends BatchCandidateDto {
  reason: BatchNotReadyReason
}

/**
 * What `POST /commune-draws/batch/validate` reports.
 *
 * A preview, not a lock: the same checks run again, per commune, inside
 * `execute()` itself, which remains the final word — a commune reported
 * ready here can still fail at execution if something changed in between.
 */
export interface BatchValidationDto {
  drawYearId: string
  ready: BatchCandidateDto[]
  notReady: BatchNotReadyCandidateDto[]
  alreadyCompleted: BatchCandidateDto[]
  total: number
}

export const BATCH_OUTCOME_STATUSES = ['completed', 'failed', 'skipped'] as const
export type BatchOutcomeStatus = (typeof BATCH_OUTCOME_STATUSES)[number]

export interface BatchExecutionOutcomeDto extends BatchCandidateDto {
  status: BatchOutcomeStatus
  /** The server's own error code, only when `status` is `failed`. */
  code?: string
}

/** What `POST /commune-draws/batch/execute` reports, once every attempt has run. */
export interface BatchExecutionResultDto {
  drawYearId: string
  targeted: number
  succeeded: number
  failed: number
  skipped: number
  outcomes: BatchExecutionOutcomeDto[]
}
