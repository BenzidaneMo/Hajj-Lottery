import type { ApplicantGender, ApplicationStatus, EntryType } from './application.js'
import type { DrawYearStatus } from './draw-configuration.js'
import type { AdminRole } from './roles.js'
import type { ScopePlaceDto } from './scope.js'

/**
 * The read surface the administrative console needs and nothing else.
 *
 * Every operational endpoint that existed before this file answered a question
 * about one commune, one application or one batch. An operator opening the
 * console asks a different kind of question — "what needs attention?", "which
 * applications are in this commune?" — and answering it by fetching every
 * commune draw and then calling three endpoints per row would be both slow and
 * a way to accumulate more data in the browser than the operator may see.
 *
 * These DTOs are therefore aggregates computed on the server, inside the
 * caller's geographic scope, and nothing here is derived in React.
 */

/** A place named in a console payload. The same shape scope uses. */
export type AdminPlaceDto = ScopePlaceDto

/** The breadth of a console reading, so the UI can say what it is showing. */
export type AdminScopeKind = 'NATIONAL' | 'WILAYA' | 'COMMUNE'

/** The draw year the dashboard's counts are about. */
export interface DashboardDrawYearDto {
  id: string
  year: number
  status: DrawYearStatus
}

/**
 * Operational counts for one draw year, within the caller's territory.
 *
 * Every field answers a question somebody running a draw actually asks. There
 * are no totals here for their own sake: a number nobody acts on is decoration,
 * and on this screen decoration would compete with the numbers that matter.
 */
export interface DashboardCountsDto {
  communeDraws: number
  draftDraws: number
  readyDraws: number
  lockedDraws: number
  completedDraws: number
  cancelledDraws: number
  /** Places configured across those draws — configuration, never derived. */
  allocatedSpots: number
  applications: number
  eligibleApplications: number
  ineligibleApplications: number
  /** Concluded draws whose result has been released to the public. */
  publishedResults: number
  /** Concluded draws still awaiting a publication decision. */
  unpublishedResults: number
  /** Places given up by an original winner, across concluded draws. */
  withdrawnWinners: number
  /** Reserves already called and still waiting for the citizen's answer. */
  reservesAwaitingDecision: number
}

/**
 * Queues that belong to national work.
 *
 * Null for a scoped administrator: approving an import or a correction is
 * SUPER_ADMIN work, and a count of a queue you cannot open is either noise or
 * an invitation to ask why. The server decides this, not the navigation.
 */
export interface DashboardGovernanceDto {
  pendingImports: number
  pendingApprovals: number
}

export interface AdminDashboardDto {
  scope: AdminScopeKind
  wilaya: AdminPlaceDto | null
  commune: AdminPlaceDto | null
  /** The open registration year, or the most recent one when none is open. */
  drawYear: DashboardDrawYearDto | null
  counts: DashboardCountsDto
  governance: DashboardGovernanceDto | null
  generatedAt: string
}

/** One row of the applications table. */
export interface AdminApplicationSummaryDto {
  id: string
  applicationReference: string
  drawYear: number
  entryType: EntryType
  status: ApplicationStatus
  /** 1 for a single entry, 2 for a paired one. */
  participantCount: number
  /** The frozen snapshot, or null when no freeze has happened. */
  calculatedWeight: number | null
  commune: AdminPlaceDto
  wilaya: AdminPlaceDto
  createdAt: string
}

export interface AdminApplicationPageDto {
  items: AdminApplicationSummaryDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/**
 * One applicant on an application, as an administrator sees them.
 *
 * The national ID is reduced to its last four digits, which is enough to
 * confirm you are looking at the person in front of you and not enough to
 * copy an identity out of the screen. `ImportRowDto.nationalIdSuffix` made the
 * same choice for the same reason; the unabridged registry stays SUPER_ADMIN
 * work. Gender and phone are included now that they support the Mahram
 * pairing rule and future contact workflows respectively.
 */
export interface AdminApplicantDto {
  participantId: string
  role: 'PRIMARY' | 'SECONDARY'
  firstNameAr: string
  lastNameAr: string
  firstNameLatin: string
  lastNameLatin: string
  nationalIdSuffix: string
  /** Calendar date, `YYYY-MM-DD`. */
  dob: string
  gender: ApplicantGender
  phoneNumber: string
  hasWonHajj: boolean
}

export interface AdminApplicationDetailDto extends AdminApplicationSummaryDto {
  applicants: AdminApplicantDto[]
  updatedAt: string
}

/** One row of the national identity registry. SUPER_ADMIN only. */
export interface AdminParticipantSummaryDto {
  id: string
  firstNameAr: string
  lastNameAr: string
  firstNameLatin: string
  lastNameLatin: string
  nationalId: string
  dob: string
  gender: ApplicantGender
  phoneNumber: string
  hasWonHajj: boolean
  createdAt: string
}

export interface AdminParticipantPageDto {
  items: AdminParticipantSummaryDto[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** An administrator account, as the account screen shows it. */
export interface AdminUserDto {
  id: string
  username: string
  role: AdminRole
  isActive: boolean
  wilaya: AdminPlaceDto | null
  commune: AdminPlaceDto | null
  lastLoginAt: string | null
  createdAt: string
}

export const ADMIN_PAGE_SIZE_DEFAULT = 25
export const ADMIN_PAGE_SIZE_MAX = 100
