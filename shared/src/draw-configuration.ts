/**
 * Annual draw configuration.
 *
 * Two lifecycles, deliberately separate:
 *
 *   DrawYear     the national cycle — may citizens apply this year?
 *   CommuneDraw  one commune's own draw — how many places, and is it settled?
 *
 * They move independently. A year can be open for registration while every
 * commune draw is still a draft, and a commune can lock its allocation while
 * the national cycle is still closing. Merging them would force every commune
 * onto the same timetable, which is not how the draw works: the lottery is run
 * per commune.
 */

/** The national registration cycle's states. */
export const DRAW_YEAR_STATUSES = ['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ARCHIVED'] as const

export type DrawYearStatus = (typeof DRAW_YEAR_STATUSES)[number]

/** One commune's draw states. */
export const COMMUNE_DRAW_STATUSES = ['DRAFT', 'READY', 'LOCKED', 'CANCELLED'] as const

export type CommuneDrawStatus = (typeof COMMUNE_DRAW_STATUSES)[number]

/**
 * The bounds on a commune's allocation.
 *
 * The maximum is a guard against a mistyped configuration rather than a policy
 * limit — Algeria's national quota is on the order of tens of thousands spread
 * across 1541 communes, so this is far beyond any legitimate single allocation
 * while still catching an extra keystroke. The same bounds are a CHECK
 * constraint on the column.
 */
export const MIN_ALLOCATED_SPOTS = 1
export const MAX_ALLOCATED_SPOTS = 100000

export interface DrawYearDto {
  id: string
  year: number
  status: DrawYearStatus
  /** How many communes have a draw configured for this year. */
  communeDrawCount: number
  createdAt: string
  updatedAt: string
}

export interface CommuneDrawDto {
  id: string
  drawYear: number
  allocatedSpots: number
  status: CommuneDrawStatus
  commune: { id: string; code: string; nameAr: string; nameFr: string; nameEn: string }
  wilaya: { id: string; code: string; nameAr: string; nameFr: string; nameEn: string }
  createdAt: string
  updatedAt: string
}

/** What the registration form is told about the current cycle. */
export interface RegistrationWindowDto {
  /** Null when no year is open — the form has nothing to apply for. */
  drawYear: number | null
  isOpen: boolean
}
