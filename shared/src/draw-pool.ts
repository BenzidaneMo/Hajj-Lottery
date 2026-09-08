/**
 * The frozen draw input.
 *
 * The lottery never reads live application rows. Eligibility, weights and
 * participation history all keep moving; a lottery run against data shifting
 * underneath it could not be reproduced or defended afterwards. So the moment
 * a commune locks, exactly what will be drawn from is snapshotted, hashed, and
 * never touched again.
 *
 * Validation and freezing are separate operations. Validation answers "could
 * this be frozen?" and changes nothing; freezing does it, once.
 */

/**
 * Why a commune draw cannot be frozen.
 *
 * Typed rather than prose so an administrator can be shown exactly what is
 * blocking, and so the reasons can be counted and tested. Nothing here reaches
 * a citizen — these are internal diagnostics about the configuration and the
 * applications, not about any individual.
 */
export const POOL_BLOCKER_CODES = [
  // --- The configuration ---
  /** The commune draw is not in the state that precedes freezing. */
  'COMMUNE_DRAW_NOT_READY',
  /** Its draw year is still taking applications. */
  'REGISTRATION_STILL_OPEN',
  /** A pool already exists for this commune draw. */
  'POOL_ALREADY_EXISTS',
  /** Nobody eligible applied. A commune with no applicants is cancelled, not frozen. */
  'NO_ELIGIBLE_APPLICATIONS',

  // --- The applications ---
  /** An application's weight was never frozen. */
  'MISSING_WEIGHT',
  /** A frozen weight is not a usable positive integer. */
  'INVALID_WEIGHT',
  /** A frozen weight no longer matches what the current facts would produce. */
  'STALE_WEIGHT',
  /** An application marked eligible no longer evaluates as eligible. */
  'APPLICATION_NOT_ELIGIBLE',
  /** A participant's winner state changed since the application was accepted. */
  'PARTICIPANT_STATE_CONFLICT',
  /** Entry type and applicants disagree. */
  'INVALID_APPLICATION_STRUCTURE',
  /** An application surfaced that belongs to another commune. */
  'WRONG_COMMUNE',
  /** An application surfaced that belongs to another draw year. */
  'WRONG_DRAW_YEAR',
] as const

export type PoolBlockerCode = (typeof POOL_BLOCKER_CODES)[number]

/**
 * One thing standing in the way, and which application it concerns.
 *
 * The reference rather than the id, so an administrator can act on it without
 * the response carrying internal identifiers around.
 */
export interface PoolBlocker {
  code: PoolBlockerCode
  /** Null for blockers about the configuration rather than one application. */
  applicationReference: string | null
}

/**
 * What a dry run reports. Reads only — validating never freezes.
 *
 * `ready` is true exactly when `blockers` is empty. Every blocker is reported
 * rather than only the first, so an administrator sees the whole picture
 * instead of fixing one problem to uncover the next.
 */
export interface PoolValidationDto {
  ready: boolean
  drawYear: number
  communeCode: string
  allocatedSpots: number
  /** How many applications would enter the pool. */
  applicationCount: number
  /** Their weights summed. */
  totalWeight: number
  blockers: PoolBlocker[]
  validatedAt: string
}

/**
 * A frozen pool, as an administrator sees it.
 *
 * Aggregates and integrity only. The entries themselves are deliberately not
 * here — see PoolEntryDto for what a listing exposes.
 */
export interface DrawPoolSummaryDto {
  id: string
  drawYear: number
  communeCode: string
  entryCount: number
  totalWeight: number
  allocatedSpots: number
  snapshotHash: string
  snapshotVersion: number
  frozenAt: string
  /** True when this call found an existing pool rather than creating one. */
  alreadyFrozen: boolean
}

/**
 * One entry, for administrative inspection.
 *
 * Identified by the citizen-facing reference, never by a name or a national
 * ID: the draw does not need to know who anybody is to choose between them.
 */
export interface PoolEntryDto {
  applicationReference: string
  entryType: 'SINGLE' | 'PAIRED'
  weight: number
}
