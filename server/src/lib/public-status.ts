import type {
  ApplicationStatus,
  CommuneDrawStatus,
  PublicApplicationStatus,
  PublicDrawPhase,
} from '@hajj-lottery/shared'

/**
 * The translation from what the system knows to what the public is told.
 *
 * Pure: no database, no clock, no randomness. Everything these functions need
 * arrives as arguments, so the mapping is the same wherever it is applied and a
 * test can enumerate it exhaustively. The loading belongs to the services.
 *
 * This is the narrowest part of the public surface and the easiest to get
 * quietly wrong, which is why it is one function rather than a `switch` repeated
 * in each controller: a new internal status must be given a public meaning here,
 * once, instead of falling through to whichever default the nearest caller
 * happened to pick.
 */

/**
 * An application's public state, gated on whether its commune's result is out.
 *
 * The gate is the reason this takes two arguments. A draw concludes in one
 * transaction that writes `SELECTED` and `NOT_SELECTED` onto every pooled
 * application — the outcome is settled and stored long before anybody may be
 * told it. Returning it straight through would make the status lookup an early
 * results feed for anyone willing to poll their own reference, which is both
 * unfair to everyone who waits for the announcement and a way to learn the
 * result of a draw that officials have not finished checking.
 *
 * So before publication both outcomes collapse onto `AWAITING_RESULTS` — the
 * *same* value, not two similar ones, so watching for a change reveals nothing
 * either.
 */
export function toPublicApplicationStatus(
  status: ApplicationStatus,
  resultsPublished: boolean,
): PublicApplicationStatus {
  switch (status) {
    case 'PENDING':
      return 'SUBMITTED'
    case 'ELIGIBLE':
      return 'IN_DRAW'
    case 'INELIGIBLE':
      return 'NOT_ELIGIBLE'
    case 'SELECTED':
      return resultsPublished ? 'SELECTED' : 'AWAITING_RESULTS'
    case 'NOT_SELECTED':
      return resultsPublished ? 'NOT_SELECTED' : 'AWAITING_RESULTS'
  }
}

/**
 * A commune draw's public phase.
 *
 * `DRAFT` and `READY` collapse to one value: the difference between them is
 * whether an official has finished configuring the allocation, which is internal
 * preparation and not something a citizen can act on. Everything else maps
 * one-to-one, because "entries are closed", "it has been drawn" and "it was
 * called off" are all facts people need.
 *
 * Note that `DRAWN` says nothing about publication — that is a separate flag on
 * every public payload. A drawn-but-unpublished draw is honestly reported as
 * drawn; withholding even that would mean lying about a fact the draw-status
 * endpoint exists to report, while revealing nothing about who won.
 */
export function toPublicDrawPhase(status: CommuneDrawStatus): PublicDrawPhase {
  switch (status) {
    case 'DRAFT':
    case 'READY':
      return 'ACCEPTING'
    case 'LOCKED':
      return 'ENTRIES_CLOSED'
    case 'COMPLETED':
      return 'DRAWN'
    case 'CANCELLED':
      return 'CANCELLED'
  }
}
