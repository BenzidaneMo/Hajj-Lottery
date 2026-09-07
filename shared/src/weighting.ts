/**
 * Lottery weighting: how much of a chance an eligible application gets.
 *
 * Three questions, kept apart on purpose:
 *
 *   Eligibility  may this application take part at all?
 *   Weight       how strong is its claim, given what it has been through?
 *   Selection    who actually gets a place?
 *
 * This file covers the middle one. Selection does not exist yet, and weight
 * deliberately knows nothing about it: a weight is a fact derived from
 * history, not a prediction of an outcome.
 */

/** How an application's weight was arrived at. */
export const WEIGHT_RULES = [
  /** One applicant: the weight is theirs. */
  'SINGLE',
  /** Two applicants: the higher of the two, so neither is penalised for the other. */
  'MAX',
] as const

export type WeightRule = (typeof WEIGHT_RULES)[number]

/**
 * The floor for any eligible application.
 *
 * A first-time applicant has no consecutive years behind them, but a weight of
 * zero would make them undrawable — ineligible by arithmetic, which the domain
 * separates carefully from ineligible by rule. So every eligible application
 * starts at one and rises with each year of waiting.
 */
export const MINIMUM_APPLICATION_WEIGHT = 1

/**
 * A weight calculation, kept auditable.
 *
 * The component weights are here so an administrator can see *why* a paired
 * application weighs what it does rather than being handed a number. They are
 * participant-level facts, though, so who may see them is a narrower question
 * than who may see the application — see docs/weighting.md.
 */
export interface ApplicationWeightDto {
  applicationReference: string
  drawYear: number
  entryType: 'SINGLE' | 'PAIRED'
  rule: WeightRule
  /** The weight this calculation arrives at, whether or not it is frozen. */
  calculatedWeight: number
  /**
   * The weight currently stored on the application, or null if never frozen.
   * It can differ from `calculatedWeight` when history changed after freezing
   * — the snapshot stands, and the difference is meant to be visible.
   */
  frozenWeight: number | null
  /** Whether the stored snapshot is what a fresh calculation would produce. */
  matchesFrozen: boolean
  /**
   * Per-applicant contributions. Null for callers whose geographic scope is
   * narrower than a participant's history, since a person's years may span
   * communes the caller does not administer.
   */
  breakdown: WeightBreakdownDto | null
  calculatedAt: string
}

/** Where each applicant's weight came from. National callers only. */
export interface WeightBreakdownDto {
  primaryWeight: number
  /** Null for a SINGLE application. */
  secondaryWeight: number | null
}
