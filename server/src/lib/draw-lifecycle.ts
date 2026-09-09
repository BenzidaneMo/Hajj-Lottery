import {
  COMMUNE_DRAW_TRANSITIONS,
  DRAW_YEAR_TRANSITIONS,
  EXECUTION_ONLY_COMMUNE_DRAW_STATUSES,
  type CommuneDrawStatus,
  type DrawYearStatus,
} from '@hajj-lottery/shared'

/**
 * Every state transition in the draw configuration, enforced in one place.
 *
 * The tables themselves live in `shared/src/draw-configuration.ts` — one
 * definition, imported here and read by the administrative console, so the
 * console can offer only moves that exist rather than discovering them by
 * being refused. A mirrored copy would be two lifecycles waiting to disagree.
 *
 * This module is where the tables are *applied*. The console rendering a
 * button is not permission to press it: every mutation still comes through
 * these predicates, and through the database constraints behind them.
 *
 * There is deliberately no DRAW_IN_PROGRESS between LOCKED and COMPLETED.
 * Execution claims COMPLETED and writes every winner in a single transaction,
 * so an intermediate state would be invisible to every other reader and undone
 * by any failure — see docs/winner-processing.md.
 */

/**
 * States an administrator may never write by hand.
 *
 * The database refuses them too, through a deferred constraint trigger. This
 * check exists so the refusal arrives as a sentence rather than as a
 * constraint violation at commit.
 */
export function isAdministrativelySettable(status: CommuneDrawStatus): boolean {
  return !EXECUTION_ONLY_COMMUNE_DRAW_STATUSES.includes(status)
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
