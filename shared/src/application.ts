/** How a citizen takes part in a given year's draw. */
export const ENTRY_TYPES = ['SINGLE', 'PAIRED'] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

/**
 * Lifecycle states an application can be in.
 *
 * `PENDING` is intake: received, not yet evaluated. `ELIGIBLE`/`INELIGIBLE` are
 * verdicts of the eligibility engine — see docs/eligibility.md. `SELECTED` and
 * `NOT_SELECTED` are outcomes of a concluded draw, written only by winner
 * processing and only for applications that were in the frozen pool.
 *
 * All five are written by the server alone. `NOT_SELECTED` is deliberately not a
 * refusal: that application took full part in the lottery and was not drawn,
 * which is a different fact from `INELIGIBLE` and feeds the participation ledger
 * differently.
 */
export const APPLICATION_STATUSES = ['PENDING', 'ELIGIBLE', 'INELIGIBLE', 'SELECTED', 'NOT_SELECTED'] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

/** One applicant, as submitted by the registration form. */
export interface ApplicantInput {
  nationalId: string
  fullName: string
  /** Calendar date, `YYYY-MM-DD`. */
  dob: string
  phoneNumber?: string
}

/**
 * Body of POST /api/applications.
 *
 * `drawYear` is deliberately absent: the server decides which year an
 * application belongs to, and would ignore the field if it were sent.
 */
export interface CreateApplicationRequest {
  entryType: EntryType
  wilayaId: string
  communeId: string
  primary: ApplicantInput
  /** Required when `entryType` is PAIRED, absent otherwise. */
  secondary?: ApplicantInput
}

/**
 * The citizen's receipt — everything shown after a successful registration.
 *
 * Carries no participant identity at all: no names, no national IDs, no dates
 * of birth, no phone numbers, and no database ids. The reference is the only
 * handle a citizen needs, and it is safe to print, photograph or read aloud.
 */
export interface ApplicationReceiptDto {
  applicationReference: string
  drawYear: number
  entryType: EntryType
  status: ApplicationStatus
  /** Whether this application covers one applicant or two. */
  applicantCount: number
  commune: {
    code: string
    nameAr: string
    nameFr: string
    nameEn: string
  }
  wilaya: {
    code: string
    nameAr: string
    nameFr: string
    nameEn: string
  }
  submittedAt: string
}

// RegistrationWindowDto lives in draw-configuration.ts: what the form may
// apply for is a property of the annual cycle, not of one application.
