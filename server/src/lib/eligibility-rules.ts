import type { EligibilityReasonCode, EligibilityResult } from '@hajj-lottery/shared'
import { calculateAgeAt, MAHRAM_OPTIONAL_AGE, MINIMUM_APPLICATION_AGE } from '@hajj-lottery/shared'

/**
 * The eligibility rules themselves — a pure function of a snapshot.
 *
 * No database, no clock, no randomness, no I/O of any kind: everything the
 * rules need is handed to them in the subject. That is what makes the verdict
 * reproducible, so evaluating the same unchanged application twice cannot
 * disagree with itself, and a rule can be tested without a database at all.
 *
 * Loading the snapshot is EligibilityService's job. Keeping the two apart is
 * deliberate — it is the difference between "these are the rules" and "this is
 * how we happen to fetch the data today".
 */

/**
 * A draw year is a calendar year, not an arbitrary integer. The same range is
 * a CHECK constraint on `applications.draw_year`; if these two ever disagree
 * the database wins, so they are kept identical on purpose.
 */
const MIN_DRAW_YEAR = 2000
const MAX_DRAW_YEAR = 2200

/** One applicant, reduced to what eligibility actually depends on. */
export interface ApplicantState {
  participantId: string
  hasWonHajj: boolean
  /** Absent only in legacy pure-rule fixtures; service-built subjects always carry it. */
  dob?: Date
  gender?: 'MALE' | 'FEMALE' | null
  /**
   * Ids of the applications this person already occupies in the subject's draw
   * year — every slot, primary or secondary alike. The subject's own id
   * appearing here is expected when re-evaluating a stored application and is
   * not a duplicate; any *other* id is.
   */
  applicationIdsThisYear: readonly string[]
}

/** The commune an application claims, as stored. */
export interface CommuneState {
  id: string
  wilayaId: string
  isActive: boolean
  wilayaIsActive: boolean
}

/**
 * Everything the rules are allowed to look at.
 *
 * Both callers build one of these: registration from the form plus the
 * participants it just resolved, re-evaluation from the stored record. The
 * rules cannot tell the two apart, which is the point — a citizen's
 * application is judged by the same code whichever door it came through.
 */
export interface EligibilitySubject {
  /** Null while registering: the application does not exist yet. */
  applicationId: string | null
  drawYear: number
  /**
   * The year this application is *required* to be for, when that is a claim
   * rather than a fact. Registration sets the server's open year here. A
   * stored application passes null: its year is history, not a claim, and a
   * past year must not become "invalid" merely because time moved on.
   */
  expectedDrawYear: number | null
  entryType: 'SINGLE' | 'PAIRED'
  /** Null when the commune id matched no commune at all. */
  commune: CommuneState | null
  /**
   * The wilaya the submitter claims the commune belongs to, checked against
   * the commune's stored wilaya. Null when there is no claim to check — a
   * stored application's wilaya is whatever its commune says it is.
   */
  claimedWilayaId: string | null
  /** Null when the primary applicant is not a known participant. */
  primary: ApplicantState | null
  /** Null for a SINGLE application, or when a paired partner is missing. */
  secondary: ApplicantState | null
  /** Server-derived registration instant; never supplied by a browser. */
  registrationDate?: Date
}

/**
 * Applies every rule and returns the verdict.
 *
 * All rules run — evaluation does not stop at the first failure — so an
 * administrator sees everything wrong with an application at once instead of
 * fixing one problem to uncover the next. Reasons come back in this function's
 * own fixed order, never in discovery order, so two runs over identical data
 * produce identical output.
 */
export function evaluateEligibility(subject: EligibilitySubject): EligibilityResult {
  const reasons: EligibilityReasonCode[] = []
  const add = (code: EligibilityReasonCode) => {
    if (!reasons.includes(code)) reasons.push(code)
  }

  // --- Structure: is this application even a coherent thing to judge? ---

  if (!subject.primary) add('PARTICIPANT_NOT_FOUND')

  if (subject.entryType === 'PAIRED' && !subject.secondary) {
    // Ambiguous by nature: the partner is either absent from the record or
    // absent from the registry. Both are reported, since both are true of
    // what we can see and neither reveals anything about a real person.
    add('APPLICATION_INCOMPLETE')
    add('SECONDARY_PARTICIPANT_NOT_FOUND')
  }

  if (subject.entryType === 'SINGLE' && subject.secondary) add('ENTRY_TYPE_MISMATCH')

  if (
    subject.primary &&
    subject.secondary &&
    subject.primary.participantId === subject.secondary.participantId
  ) {
    add('DUPLICATE_APPLICANTS')
  }

  // --- Place and year ---

  const commune = subject.commune
  const communeIsUsable =
    commune !== null &&
    commune.isActive &&
    commune.wilayaIsActive &&
    (subject.claimedWilayaId === null || commune.wilayaId === subject.claimedWilayaId)

  if (!communeIsUsable) add('INVALID_COMMUNE')

  const yearIsPlausible =
    Number.isInteger(subject.drawYear) &&
    subject.drawYear >= MIN_DRAW_YEAR &&
    subject.drawYear <= MAX_DRAW_YEAR
  const yearIsExpected = subject.expectedDrawYear === null || subject.drawYear === subject.expectedDrawYear

  if (!yearIsPlausible || !yearIsExpected) add('DRAW_YEAR_INVALID')

  // --- The people ---

  if (subject.primary?.hasWonHajj) add('PARTICIPANT_HAS_ALREADY_WON')
  if (subject.secondary?.hasWonHajj) add('SECONDARY_PARTICIPANT_HAS_ALREADY_WON')

  if (subject.primary && occupiesAnotherApplication(subject.primary, subject.applicationId)) {
    add('DUPLICATE_ANNUAL_APPLICATION')
  }
  if (subject.secondary && occupiesAnotherApplication(subject.secondary, subject.applicationId)) {
    add('SECONDARY_ALREADY_REGISTERED')
  }

  // --- Official applicant rules ---
  // The reference is the server's actual registration date (the stored
  // application timestamp during re-evaluation), never a draw-year shortcut.
  const primaryAge =
    subject.primary?.dob && subject.registrationDate
      ? calculateAgeAt(subject.primary.dob, subject.registrationDate)
      : null
  const secondaryAge =
    subject.secondary?.dob && subject.registrationDate
      ? calculateAgeAt(subject.secondary.dob, subject.registrationDate)
      : null
  if (primaryAge !== null && primaryAge !== undefined && primaryAge < MINIMUM_APPLICATION_AGE) {
    add('UNDER_MINIMUM_AGE')
  }
  if (secondaryAge !== null && secondaryAge !== undefined && secondaryAge < MINIMUM_APPLICATION_AGE) {
    add('SECONDARY_UNDER_MINIMUM_AGE')
  }

  if (subject.primary && subject.primary.gender === null) add('GENDER_UNAVAILABLE')
  if (subject.secondary && subject.secondary.gender === null) add('GENDER_UNAVAILABLE')

  if (subject.entryType === 'PAIRED' && subject.primary && subject.secondary) {
    // A pair is specifically a woman and her male Mahram. The generic
    // companion model is not an eligible alternative.
    if (subject.primary.gender !== undefined && subject.primary.gender !== 'FEMALE')
      add('INVALID_PAIRED_GENDERS')
    if (subject.secondary.gender !== undefined && subject.secondary.gender !== 'MALE') {
      add('INVALID_MAHRAM_GENDER')
      add('INVALID_PAIRED_GENDERS')
    }
  }

  if (subject.entryType === 'SINGLE' && subject.primary?.gender === 'FEMALE' && primaryAge !== null) {
    if (primaryAge < MAHRAM_OPTIONAL_AGE) add('MAHRAM_REQUIRED')
  }

  return {
    eligible: reasons.length === 0,
    status: reasons.length === 0 ? 'ELIGIBLE' : 'INELIGIBLE',
    reasons,
  }
}

/**
 * True when this person is already taking part in the draw year through some
 * application other than the one being judged.
 *
 * This is a *read*, and reads race. It exists so a citizen gets a clear
 * refusal rather than a constraint violation, not as the guarantee: the
 * `(draw_year, participant_id)` primary key on `application_participants` is
 * what actually makes one-per-year true, including for two requests that pass
 * this check simultaneously.
 */
function occupiesAnotherApplication(applicant: ApplicantState, ownApplicationId: string | null): boolean {
  return applicant.applicationIdsThisYear.some((id) => id !== ownApplicationId)
}
