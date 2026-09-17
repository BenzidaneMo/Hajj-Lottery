import type { BatchCandidateDto, BatchOutcomeStatus } from './batch-draw-execution.js'
import type { PoolBlockerCode } from './draw-pool.js'

/**
 * Batch pool freezing.
 *
 * A SUPER_ADMIN-only orchestration over the existing per-commune
 * `DrawPoolService.freeze` — this introduces no new validation and no
 * combined pools. Each commune in the batch freezes exactly as it would one
 * at a time; batching only saves the operator from doing that by hand across
 * an entire draw year before running `BatchDrawExecutionService`'s own
 * "Execute All Validated Draws", which otherwise has nothing locked to run.
 *
 * Two requests, always in this order: `validate` discovers what can freeze
 * without changing anything, and only an explicit confirmation of exactly
 * that set may then be sent to `freeze`.
 */

/**
 * One commune draw a batch freeze considered, and why it cannot freeze yet.
 *
 * `blockers` are the deduplicated `PoolBlockerCode`s `DrawPoolService.validate`
 * reported — not per-application detail, since a batch preview names
 * commune-level problems, not individual applications.
 */
export interface BatchFreezeNotReadyCandidateDto extends BatchCandidateDto {
  blockers: PoolBlockerCode[]
}

/**
 * What `POST /commune-draws/batch/freeze/validate` reports.
 *
 * A preview, not a lock: `freeze()` re-validates every candidate again on its
 * own, which remains the final word — a commune reported ready here can
 * still fail to freeze if something changed in between.
 */
export interface BatchFreezeValidationDto {
  drawYearId: string
  ready: BatchCandidateDto[]
  notReady: BatchFreezeNotReadyCandidateDto[]
  alreadyFrozen: BatchCandidateDto[]
  total: number
}

export interface BatchFreezeOutcomeDto extends BatchCandidateDto {
  status: BatchOutcomeStatus
  /** The server's own error code, only when `status` is `failed`. */
  code?: string
}

/** What `POST /commune-draws/batch/freeze/execute` reports, once every attempt has run. */
export interface BatchFreezeResultDto {
  drawYearId: string
  targeted: number
  succeeded: number
  failed: number
  skipped: number
  outcomes: BatchFreezeOutcomeDto[]
}
