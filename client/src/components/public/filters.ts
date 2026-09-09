import type { PlaceCodes } from '../geo'

/**
 * The filter values the two public listings share, and how they reach the API.
 *
 * Separate from `PublicFilterBar.tsx` for the reason `registration/applicant.ts`
 * is separate from its fields component: a module that exports both a component
 * and plain values breaks Fast Refresh, and the values are wanted by pages that
 * do not render the bar.
 */

export interface PublicFilterValues extends PlaceCodes {
  drawYear: string
}

export const EMPTY_FILTERS: PublicFilterValues = {
  drawYear: '',
  wilayaCode: undefined,
  communeCode: undefined,
}

/**
 * The draw-year bounds the server enforces, mirrored so the field agrees with it.
 *
 * The same range `applications.draw_year`'s CHECK constraint allows and
 * `lib/eligibility-rules.ts` checks, so a year this field accepts is a year the
 * public endpoints accept.
 */
export const DRAW_YEAR_MIN = 2000
export const DRAW_YEAR_MAX = 2200

/**
 * The filter values as the API takes them.
 *
 * A year outside the accepted range is dropped rather than sent: the server
 * would answer `400` for it, and a validation error is not a useful reply to
 * somebody halfway through typing "20".
 */
export function toQueryFilters(value: PublicFilterValues): {
  drawYear?: number | undefined
  wilayaCode?: string | undefined
  communeCode?: string | undefined
} {
  const year = Number.parseInt(value.drawYear, 10)
  const inRange = Number.isInteger(year) && year >= DRAW_YEAR_MIN && year <= DRAW_YEAR_MAX

  return {
    ...(inRange ? { drawYear: year } : {}),
    ...(value.wilayaCode ? { wilayaCode: value.wilayaCode } : {}),
    ...(value.communeCode ? { communeCode: value.communeCode } : {}),
  }
}
