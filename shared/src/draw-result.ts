/**
 * A concluded draw, as an administrator sees it.
 *
 * The draw is executed once, against a frozen pool, inside one transaction that
 * also records every winner and marks the commune draw complete. What comes back
 * here is that record — never a live recalculation, and never anything a caller
 * could influence.
 *
 * Nothing here is public. Winner publication is a separate decision with its own
 * consent and notification questions, and none of them have been answered yet.
 */

import type { EntryType } from './application.js'

/**
 * The identifier of the selection implementation a result was produced by.
 *
 * Stored on every result so a concluded draw forever names the algorithm that
 * ran it. Deliberately a fixed version rather than a moving label like "latest":
 * a result whose algorithm cannot be pinned down is not reproducible, and
 * reproducibility is the whole claim.
 */
export const LOTTERY_ALGORITHM_VERSION = 'weighted-csprng-v1'

/**
 * One winning entry.
 *
 * Identified by its citizen-facing reference, never by a name, a national ID or
 * an internal id — the same rule the pool listing follows. `participantCount` is
 * 1 or 2: a paired application is **one** winning entry with **two** winning
 * people.
 */
export interface DrawWinnerDto {
  /** 1-based position in the order the entries were drawn. */
  selectionOrder: number
  applicationReference: string
  entryType: EntryType
  /** The weight this entry carried in the pool. */
  selectedWeight: number
  /** How many individuals this entry wins for: 1 for SINGLE, 2 for PAIRED. */
  participantCount: number
}

/**
 * The random draw behind one selection.
 *
 * `randomValue` came from `[0, activeTotalWeight)`. Together with the pool these
 * let an auditor replay the arithmetic and confirm each winner independently.
 * Administrative only; not published, and never a source of randomness.
 */
export interface DrawSelectionEventDto {
  selectionOrder: number
  activeTotalWeight: number
  randomValue: number
}

/** A concluded draw: its terms, its integrity fingerprint, and its winners. */
export interface DrawResultDto {
  id: string
  drawYear: number
  communeCode: string
  /** Entries selected — equal to the commune's allocated spots. */
  winnerCount: number
  /**
   * People who won, which can exceed `winnerCount`: ten places filled by nine
   * single and one paired application is ten winning entries and eleven winning
   * individuals. Spots count entries, not people.
   */
  winningParticipantCount: number
  allocatedSpots: number
  /** The pool the draw ran against. */
  entryCount: number
  totalWeightAtDraw: number
  /** The pool's snapshot hash, verified immediately before selection. */
  poolHash: string
  algorithmVersion: string
  startedAt: string
  completedAt: string
  winners: DrawWinnerDto[]
  events: DrawSelectionEventDto[]
}

/**
 * What executing a draw reports back.
 *
 * The same result an administrator can read afterwards, plus how the applications
 * in the pool were finalized — because that is the part of the transaction that
 * touched records outside the result itself.
 */
export interface DrawExecutionDto extends DrawResultDto {
  /** Applications in the pool that were not drawn. */
  notSelectedCount: number
  /** Participation records written for everybody who was in the pool. */
  historyRecordsCreated: number
}
