import type { CommuneDrawStatus, DrawYearStatus } from '@hajj-lottery/shared'

/**
 * Every state transition in the draw configuration, in one place.
 *
 * Pure, and deliberately declarative: the legal moves are data, not a thicket
 * of `if (status === ...)` scattered through controllers where a missing case
 * is invisible. Anything not listed here cannot happen, which is the point —
 * a lifecycle enforced by omission rather than by remembering to check.
 *
 * Only transitions this phase can actually perform are present. Draw
 * execution, and the states that would come with it, are deferred; adding them
 * now would be inventing a lifecycle rather than recording one.
 */

/**
 * The national cycle: draft it, open it, close it, file it away.
 *
 * There is no route back from REGISTRATION_CLOSED. Reopening intake after
 * closing it would let applications arrive after everyone has been told the
 * year is settled, and whether that is ever permitted is a policy decision
 * nobody has made. Until someone does, the system cannot do it.
 */
const DRAW_YEAR_TRANSITIONS: Record<DrawYearStatus, readonly DrawYearStatus[]> = {
  DRAFT: ['REGISTRATION_OPEN', 'ARCHIVED'],
  REGISTRATION_OPEN: ['REGISTRATION_CLOSED'],
  REGISTRATION_CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
}

/**
 * One commune's draw: configure it, settle it, lock it.
 *
 * READY can fall back to DRAFT, because "settled" is a statement about
 * intent and an official may reconsider before the allocation is fixed.
 * LOCKED cannot: it is the promise that the terms of the draw stopped moving,
 * and the whole value of that promise is that it cannot be taken back.
 *
 * COMPLETED is absent. It belongs to a draw having been executed, and no code
 * can execute one yet.
 */
const COMMUNE_DRAW_TRANSITIONS: Record<CommuneDrawStatus, readonly CommuneDrawStatus[]> = {
  DRAFT: ['READY', 'CANCELLED'],
  READY: ['DRAFT', 'LOCKED', 'CANCELLED'],
  LOCKED: [],
  CANCELLED: [],
}

export function canTransitionDrawYear(from: DrawYearStatus, to: DrawYearStatus): boolean {
  return DRAW_YEAR_TRANSITIONS[from].includes(to)
}

export function canTransitionCommuneDraw(from: CommuneDrawStatus, to: CommuneDrawStatus): boolean {
  return COMMUNE_DRAW_TRANSITIONS[from].includes(to)
}

/**
 * Whether the allocation may still be changed.
 *
 * The locked state exists precisely to stop this. Once a commune's terms are
 * fixed, changing how many places it has would silently alter a draw people
 * have already been told about — so it is refused for everyone, including the
 * administrator who set it.
 */
export function allowsSpotChanges(status: CommuneDrawStatus): boolean {
  return status === 'DRAFT' || status === 'READY'
}

/**
 * Whether citizens may register into this commune's draw.
 *
 * The national cycle decides *whether* registration is running at all; this
 * only asks whether this particular commune is still accepting entries. A
 * locked draw has stopped taking them — its pool is settled — and a cancelled
 * one is not running.
 */
export function acceptsRegistrations(status: CommuneDrawStatus): boolean {
  return status === 'DRAFT' || status === 'READY'
}

/** Whether the national cycle is currently taking applications. */
export function isRegistrationOpen(status: DrawYearStatus): boolean {
  return status === 'REGISTRATION_OPEN'
}
