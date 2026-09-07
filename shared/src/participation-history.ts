/**
 * The participation ledger: what happened to a person in previous draw years.
 *
 * Distinct from both other records in the model, and deliberately so:
 *
 *   Participant           who is this person?
 *   Application           how are they taking part this year?
 *   ParticipationHistory  what happened to them across previous years?
 *
 * This is the future input to priority weighting. It holds facts only — no
 * streak counter, no weight — so nothing stored can drift from what the rows
 * actually say.
 */

/** Where a historical fact came from. Provenance is half of trust. */
export const PARTICIPATION_SOURCES = ['LEGACY_IMPORT', 'APPLICATION', 'ADMIN_CORRECTION'] as const
export type ParticipationSource = (typeof PARTICIPATION_SOURCES)[number]

/**
 * One year of one person's history, as an administrator sees it.
 *
 * Carries no participant identity — no name, national ID or date of birth.
 * Those live on Participant and are never copied here.
 */
export interface ParticipationHistoryDto {
  id: string
  drawYear: number
  participated: boolean
  won: boolean
  source: ParticipationSource
  verified: boolean
  notes: string | null
  commune: { code: string; nameAr: string; nameFr: string; nameEn: string }
  wilaya: { code: string; nameAr: string; nameFr: string; nameEn: string }
  createdAt: string
  updatedAt: string
}

/**
 * Why a consecutive-participation streak stopped where it did.
 *
 * Returned alongside the count because the number alone is not reviewable: an
 * administrator looking at a streak of 3 needs to know whether the fourth year
 * back was a win, a known absence, or simply a hole in the ledger.
 */
export const STREAK_STOP_REASONS = [
  /** The ledger has nothing authoritative for that year. Not the same as absence. */
  'NO_AUTHORITATIVE_RECORD',
  /** A record exists but has not been verified, so it is not counted. */
  'UNVERIFIED_RECORD',
  /** A record positively states the person did not take part. */
  'DID_NOT_PARTICIPATE',
  /** A record states the person won, which ends any non-winning streak. */
  'WON',
  /** The walk reached the earliest year the ledger can express. */
  'REACHED_EARLIEST_YEAR',
] as const

export type StreakStopReason = (typeof STREAK_STOP_REASONS)[number]

/**
 * The consecutive non-winning participation streak immediately preceding a
 * target draw year.
 *
 * Deliberately not a bare number: `stoppedAt` and `stoppedBecause` make the
 * count auditable, and keep "we know they did not take part" visibly different
 * from "we have no idea".
 */
export interface ParticipationStreakDto {
  participantId: string
  targetDrawYear: number
  /** Count of contiguous verified, participating, non-winning years. */
  consecutiveNonWinningYears: number
  /** The first year the walk refused to count, or null if it never stopped. */
  stoppedAt: number | null
  stoppedBecause: StreakStopReason
}

/** What GET /api/admin/participants/:id/history returns. */
export interface ParticipantHistoryDto {
  /**
   * Only the records the caller is authorized to see. A participant has no
   * geographic owner, so the *records* are filtered by scope rather than the
   * participant being authorized as a whole — an administrator never learns
   * that someone took part elsewhere.
   */
  records: ParticipationHistoryDto[]
  /**
   * The streak, or null when the caller's view is geographically narrower than
   * the calculation. A streak spans communes by nature, so reporting one to a
   * scoped administrator would disclose participation outside their territory.
   */
  streak: ParticipationStreakDto | null
}
