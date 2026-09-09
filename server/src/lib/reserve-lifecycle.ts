import type { ReserveStatus } from '@hajj-lottery/shared'

/**
 * The reserve lifecycle, as data.
 *
 * Pure and declarative, exactly like `draw-lifecycle.ts`: the legal moves are a
 * lookup table rather than a thicket of `if (status === ...)` in a service,
 * because anything not listed here cannot happen and a missing case is visible
 * instead of invisible.
 *
 * This is the only mutable state in a concluded draw, which is why the table is
 * so small. Everything else about a reserve — which entry, which position, where
 * in the selection order — was decided by the lottery and cannot move at all.
 * The database enforces the same transitions in a trigger, so a service is not
 * the last line of defence; this exists so the refusal arrives as a sentence
 * rather than as a constraint violation.
 */

/**
 * Waiting, then called, then answered.
 *
 * There is no route back from ACCEPTED or DECLINED. Accepting makes somebody a
 * lifetime winner in the same transaction, and there is no un-win; declining is
 * an answer a citizen gave, and the next reserve may already have been called on
 * the strength of it. A changed mind is a new administrative act against a
 * different reserve, not a rewrite of this one.
 *
 * Nothing moves a reserve out of WAITING except being called, and nothing calls
 * a reserve out of turn — the order comes from the lottery, so choosing within
 * it would be choosing a winner.
 */
const RESERVE_TRANSITIONS: Record<ReserveStatus, readonly ReserveStatus[]> = {
  WAITING: ['CALLED'],
  CALLED: ['ACCEPTED', 'DECLINED'],
  ACCEPTED: [],
  DECLINED: [],
}

export function canTransitionReserve(from: ReserveStatus, to: ReserveStatus): boolean {
  return RESERVE_TRANSITIONS[from].includes(to)
}

/**
 * Whether this reserve is still available to be called.
 *
 * A declined reserve is *not* available again. They were asked and they refused;
 * asking again because nobody further down the list accepted would make the
 * order meaningless in exactly the situation it exists to govern.
 */
export function isAwaitingCall(status: ReserveStatus): boolean {
  return status === 'WAITING'
}

/**
 * Whether this reserve currently holds a place.
 *
 * Only acceptance. Being called is being asked, and a question is not a place —
 * counting CALLED here would make the occupied-spot total move on an offer
 * nobody has answered.
 */
export function holdsAPlace(status: ReserveStatus): boolean {
  return status === 'ACCEPTED'
}
