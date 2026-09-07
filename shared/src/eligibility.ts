/**
 * The eligibility vocabulary, shared so the server, the tests and a future
 * admin UI all name the same rules.
 *
 * Eligibility answers "is this application allowed to take part?" — a question
 * about the domain. It is not validation, which asks "is this request even
 * well-formed?", and it is not weighting or selection, which decide how likely
 * an eligible application is to win. Those stay separate operations.
 */

/**
 * Why an application was refused. Typed rather than free text so the reasons
 * can be counted, tested, audited and translated without parsing prose.
 *
 * These are *internal* diagnostics. They are shown to administrators; a
 * citizen only ever sees the deliberately vaguer public error the server maps
 * them to, because naming the exact rule would leak which national IDs exist
 * and who has won before.
 */
export const ELIGIBILITY_REASON_CODES = [
  /** The primary applicant is not a known participant. */
  'PARTICIPANT_NOT_FOUND',
  /** A paired application whose second applicant is not a known participant. */
  'SECONDARY_PARTICIPANT_NOT_FOUND',
  /** PAIRED, but no second applicant is attached. */
  'APPLICATION_INCOMPLETE',
  /** SINGLE, but a second applicant is attached. */
  'ENTRY_TYPE_MISMATCH',
  /** The same person occupies both slots. */
  'DUPLICATE_APPLICANTS',
  /** The primary applicant has been to Hajj through a previous draw. */
  'PARTICIPANT_HAS_ALREADY_WON',
  /** The second applicant has been to Hajj through a previous draw. */
  'SECONDARY_PARTICIPANT_HAS_ALREADY_WON',
  /** The primary applicant already takes part in this draw year. */
  'DUPLICATE_ANNUAL_APPLICATION',
  /** The second applicant already takes part in this draw year. */
  'SECONDARY_ALREADY_REGISTERED',
  /** No such commune, inactive, or not in the wilaya the application claims. */
  'INVALID_COMMUNE',
  /** Not a plausible draw year, or not the year currently being registered. */
  'DRAW_YEAR_INVALID',
] as const

export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number]

/**
 * The outcome of evaluating one application.
 *
 * `reasons` is empty exactly when `eligible` is true, and is ordered by the
 * fixed rule sequence rather than by discovery, so the same inputs always
 * produce a byte-identical result — which is what makes re-evaluation and
 * audit comparison meaningful.
 */
export interface EligibilityResult {
  eligible: boolean
  /** The status this outcome corresponds to, ready to persist. */
  status: EvaluatedApplicationStatus
  reasons: readonly EligibilityReasonCode[]
}

/** The two statuses an evaluation can conclude with. */
export type EvaluatedApplicationStatus = 'ELIGIBLE' | 'INELIGIBLE'

/**
 * What `GET /api/admin/applications/:id/eligibility` returns.
 *
 * Carries no participant identity and no database ids — an administrator
 * reviewing eligibility needs the verdict and the place, not the people. The
 * wider application-management view, when it exists, will decide separately
 * what identity an administrator may see.
 */
export interface ApplicationEligibilityDto {
  applicationReference: string
  drawYear: number
  entryType: 'SINGLE' | 'PAIRED'
  /** The status currently stored on the record. */
  storedStatus: string
  /** The verdict this evaluation just reached, which may differ from it. */
  evaluation: EligibilityResult
  commune: { code: string; nameAr: string; nameFr: string; nameEn: string }
  wilaya: { code: string; nameAr: string; nameFr: string; nameEn: string }
  evaluatedAt: string
}
