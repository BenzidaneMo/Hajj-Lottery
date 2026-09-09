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

/**
 * One commune's draw states.
 *
 * `COMPLETED` is terminal and cannot be set administratively — only winner
 * processing reaches it, in the transaction that records the winners, and the
 * database refuses to commit it without a result. See docs/winner-processing.md.
 */
export const COMMUNE_DRAW_STATUSES = ['DRAFT', 'READY', 'LOCKED', 'COMPLETED', 'CANCELLED'] as const

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

/**
 * Every legal move in the two lifecycles, in one place.
 *
 * Declarative on purpose: the legal moves are data, not a thicket of
 * `if (status === ...)` where a missing case is invisible. Anything not listed
 * cannot happen.
 *
 * These live in `shared` because the console has to offer the operator a
 * choice, and offering one the server will refuse is a worse interface than
 * offering none. It is emphatically not a second implementation — the server
 * imports these same tables (`server/src/lib/draw-lifecycle.ts`) and remains
 * the only thing that decides. A console rendering a button is not permission
 * to press it.
 */

/**
 * The national cycle: draft it, open it, close it, file it away.
 *
 * There is no route back from REGISTRATION_CLOSED. Reopening intake after
 * closing it would let applications arrive after everyone has been told the
 * year is settled, and whether that is ever permitted is a policy decision
 * nobody has made. Until someone does, the system cannot do it.
 */
export const DRAW_YEAR_TRANSITIONS: Record<DrawYearStatus, readonly DrawYearStatus[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'ARCHIVED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
}

/**
 * One commune's draw: configure it, settle it, lock it, run it.
 *
 * READY can fall back to DRAFT, because "settled" is a statement about intent
 * and an official may reconsider before the allocation is fixed. LOCKED
 * cannot: it is the promise that the terms of the draw stopped moving, and the
 * whole value of that promise is that it cannot be taken back.
 *
 * COMPLETED is terminal, and there is no route back from it for anybody. A
 * concluded lottery has told people they won; reopening it would take that
 * back, and no correction workflow exists to do so responsibly.
 */
export const COMMUNE_DRAW_TRANSITIONS: Record<CommuneDrawStatus, readonly CommuneDrawStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['DRAFT', 'LOCKED', 'CANCELLED'],
  LOCKED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
}

/**
 * States an administrator may never write by hand.
 *
 * LOCKED → COMPLETED is a legal transition, but only winner processing may
 * perform it, and only alongside the result and winners it commits with. An
 * administrator setting it directly would produce a draw that claims to have
 * concluded with no winners to show — the worst state this system could reach.
 */
export const EXECUTION_ONLY_COMMUNE_DRAW_STATUSES: readonly CommuneDrawStatus[] = ['COMPLETED']

/** The transitions an administrator may actually offer to perform. */
export function administrativeCommuneDrawTransitions(from: CommuneDrawStatus): readonly CommuneDrawStatus[] {
  return COMMUNE_DRAW_TRANSITIONS[from].filter(
    (status) => !EXECUTION_ONLY_COMMUNE_DRAW_STATUSES.includes(status),
  )
}

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
