/**
 * A concluded draw, as an administrator sees it.
 *
 * The draw is executed once, against a frozen pool, inside one transaction that
 * also records every winner and marks the commune draw complete. What comes back
 * here is that record — never a live recalculation, and never anything a caller
 * could influence.
 *
 * Nothing here is public. What citizens may see is a separate, much narrower set
 * of types in public.ts, released only once an administrator has published the
 * result — `publishedAt` below says whether that has happened.
 */

import type { EntryType } from './application.js'
import type { DrawReserveDto, WinnerAbandonmentDto, WinnerOutcome } from './reserves.js'

/**
 * The identifier of the selection implementation a result was produced by.
 *
 * Stored on every result so a concluded draw forever names the algorithm that
 * ran it. Deliberately a fixed version rather than a moving label like "latest":
 * a result whose algorithm cannot be pinned down is not reproducible, and
 * reproducibility is the whole claim.
 *
 * `capacity-v2` is the pilgrim-capacity draw: the quota is spent in pilgrims
 * and only groups that fit the remaining capacity may be selected. `v1` spent
 * it in application records, which is the defect this replaced — see
 * docs/pilgrim-capacity.md.
 */
export const LOTTERY_ALGORITHM_VERSION = 'weighted-csprng-capacity-v2'

/**
 * The selection implementation that predates pilgrim capacity.
 *
 * Kept named rather than deleted because results produced by it still exist and
 * must stay readable, publishable and auditable exactly as they were recorded.
 * Nothing produces one any more.
 */
export const LEGACY_ENTRY_COUNT_ALGORITHM_VERSION = 'weighted-csprng-v1'

/**
 * Whether a result's algorithm spent its quota in pilgrims rather than in
 * application records.
 *
 * The integrity gate and the database's own capacity trigger both branch on
 * this, so a historical draw is judged by the rules it actually ran under. A
 * v1 result with a paired winner has more winning pilgrims than allocated
 * places; that is a faithful record of what happened, not a fault to report.
 */
export function isPilgrimCapacityAlgorithm(algorithmVersion: string): boolean {
  return algorithmVersion !== LEGACY_ENTRY_COUNT_ALGORITHM_VERSION
}

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
  /**
   * What has happened to this winning entry since — `ACTIVE`, or `ABANDONED`
   * once an official has recorded that they gave up the place.
   *
   * Derived from whether an abandonment record exists, never stored on the
   * winner row: the selection above is immutable evidence of a lottery, and the
   * outcome is a separate administrative fact about a person's circumstances.
   */
  outcome: WinnerOutcome
  /** The recorded abandonment, if there is one. Administrative, never public. */
  abandonment: WinnerAbandonmentDto | null
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
  /**
   * Winning **applications**. Not the allocation: a twelve place commune whose
   * draw selected ten single and one paired application has eleven winning
   * applications and twelve winning pilgrims.
   */
  winnerCount: number
  /**
   * The pilgrims those winning applications place — **equal to
   * `allocatedSpots`** for a completed capacity-aware draw. This is the
   * invariant the quota is about; `winnerCount` is not.
   */
  winnerPilgrimCount: number
  /**
   * Reserve **positions**. A draw fills a reserve pilgrim quota equal to the
   * allocation from the same continuous sample, so this is however many
   * applications that took — not the allocation.
   */
  reserveCount: number
  /** The pilgrims the reserve list covers — equal to `allocatedSpots` too. */
  reservePilgrimCount: number
  /**
   * Winning applications currently holding their place: original winners who
   * have not abandoned, plus reserves who were called and accepted. Equal to
   * `winnerCount` for a draw whose every abandonment has been replaced.
   *
   * Applications, so a place given up by a pair and taken by a single applicant
   * leaves this unchanged while `activePilgrimCount` falls — which is exactly
   * the situation the two numbers exist to keep distinguishable.
   */
  activeWinnerCount: number
  /**
   * Pilgrim places currently held. Equal to `allocatedSpots` while nothing has
   * been given up, and — because a replacement group need not be the same size
   * as the one it replaces — not guaranteed to return to it. See
   * docs/pilgrim-capacity.md on replacement.
   */
  activePilgrimCount: number
  /**
   * People this draw has made lifetime winners: the winning applications'
   * pilgrims, plus anybody promoted from the reserve list since. Equal to
   * `winnerPilgrimCount` until a promotion happens, and above it afterwards —
   * an abandoned winner is still a winner and is never un-archived.
   */
  winningParticipantCount: number
  /** The commune's pilgrim places. The quota the draw was run against. */
  allocatedSpots: number
  /** The pool the draw ran against. */
  entryCount: number
  totalWeightAtDraw: number
  /** The pool's snapshot hash, verified immediately before selection. */
  poolHash: string
  algorithmVersion: string
  startedAt: string
  completedAt: string
  /**
   * When this result was released to the public, or null while it is still
   * internal. A result exists from the moment the draw concludes; publication is
   * a separate, audited act — see docs/public-access.md.
   */
  publishedAt: string | null
  winners: DrawWinnerDto[]
  /** The reserve list, in call order, with each one's lifecycle state. */
  reserves: DrawReserveDto[]
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
