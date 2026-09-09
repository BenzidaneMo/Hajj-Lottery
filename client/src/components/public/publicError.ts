import type { TFunction } from 'i18next'

import { ApiError } from '../../lib/api'

/**
 * What a citizen is told when a public request fails.
 *
 * Every failure on this surface reaches the screen through here, and the rule
 * is the same one the server follows: say what the person can do, never what
 * the system did. Nothing from the response body is rendered — not the API's
 * `error` string, not its `code`, not a stack, not a proxy's HTML error page.
 * Those are written in one language, they describe internals, and on the status
 * lookup they would undo the whole point of the server answering every failure
 * identically.
 *
 * So this maps a class of failure onto a translation key and stops there.
 */

export type PublicErrorKind =
  /** The API refused the request as malformed. */
  | 'validation'
  /** Nothing here — for a listing, an empty state; for a lookup, a generic miss. */
  | 'notFound'
  /** Rate limited. Deliberately says nothing about why or whose fault it is. */
  | 'rateLimited'
  /** The request never got an answer: offline, timed out, DNS, CORS. */
  | 'network'
  /** The API answered, badly. */
  | 'server'

export function classifyPublicError(error: unknown): PublicErrorKind {
  // Not an ApiError means fetch itself rejected — no response was ever parsed,
  // so the browser is offline, the request timed out, or the origin is
  // unreachable. There is nothing to report but the fact of it.
  if (!(error instanceof ApiError)) return 'network'

  if (error.status === 429) return 'rateLimited'
  if (error.status === 404) return 'notFound'
  if (error.status === 400 || error.status === 422) return 'validation'
  return 'server'
}

/**
 * A translated, safe message for a failed public request.
 *
 * `namespace` picks the wording for the page — the status lookup's "not found"
 * has to be the deliberately unhelpful one, while a results listing's is an
 * ordinary empty state.
 */
export function publicErrorMessage(error: unknown, t: TFunction, namespace = 'public.errors'): string {
  return t(`${namespace}.${classifyPublicError(error)}`)
}
