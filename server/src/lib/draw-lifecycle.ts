import type { CommuneDrawStatus, DrawYearStatus } from '@hajj-lottery/shared'

/**
 * Every state transition in the draw configuration, in one place.
 *
 * Pure, and deliberately declarative: the legal moves are data, not a thicket
 * of `if (status === ...)` scattered through controllers where a missing case
 * is invisible. Anything not listed here cannot happen, which is the point —
 * a lifecycle enforced by omission rather than by remembering to check.
 *
 * Only transitions the system can actually perform are present. A state nothing
 * can reach would be an invented lifecycle rather than a recorded one.
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
 * One commune's draw: configure it, settle it, lock it, run it.
 *
 * READY can fall back to DRAFT, because "settled" is a statement about
 * intent and an official may reconsider before the allocation is fixed.
 * LOCKED cannot: it is the promise that the terms of the draw stopped moving,
 * and the whole value of that promise is that it cannot be taken back.
 *
 * COMPLETED is terminal, and there is no route back from it for anybody. A
 * concluded lottery has told people they won; reopening it would take that
 * back, and no correction workflow exists to do so responsibly.
 *
 * There is deliberately no DRAW_IN_PROGRESS between the two. Execution claims
 * COMPLETED and writes every winner in a single transaction, so an intermediate
 * state would be invisible to every other reader and undone by any failure —
 * see docs/winner-processing.md.
 */
const COMMUNE_DRAW_TRANSITIONS: Record<CommuneDrawStatus, readonly CommuneDrawStatus[]> = {
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
 *
 * The database refuses it too, through a deferred constraint trigger. This check
 * exists so the refusal arrives as a sentence rather than as a constraint
 * violation at commit.
 */
const EXECUTION_ONLY_STATUSES: readonly CommuneDrawStatus[] = ['COMPLETED']

export function isAdministrativelySettable(status: CommuneDrawStatus): boolean {
  return !EXECUTION_ONLY_STATUSES.includes(status)
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
