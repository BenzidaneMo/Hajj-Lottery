import type { RequestHandler, Response } from 'express'

/**
 * Cache policy for the public API.
 *
 * These endpoints exist to survive the four moments when everybody in the
 * country loads the same page at once: registration opening, registration
 * closing, a draw being run, and results being announced. The application cannot
 * absorb that on its own and is not being asked to — a CDN in front of it can,
 * but only if the responses say what may be cached and for how long. So the
 * headers are part of the design rather than a deployment detail.
 *
 * The distinction that matters is between the two kinds of response:
 *
 * - **Official results and draw states are public facts.** Everybody gets the
 *   same bytes, and a published result never changes, so they are cached hard
 *   and shared freely.
 * - **An application status is one citizen's.** It is behind a verification
 *   value rather than a session, which means no shared cache can tell one
 *   caller's response from another's — so it must never enter one at all.
 *
 * Getting that second case wrong would serve one applicant's status to the next
 * person through the same proxy. `no-store` is therefore the *default* applied
 * to the whole public router, and the cacheable responses opt out of it
 * explicitly on their success path. A route that forgets to say anything is
 * private, and a failure — a 404, a 429, a validation error — stays private even
 * on a route whose successful responses are public.
 */

/** A published result never changes, so a client may hold it and a CDN longer. */
const PUBLISHED_RESULT_MAX_AGE = 300
const PUBLISHED_RESULT_SHARED_MAX_AGE = 86_400

/** Listings gain rows as communes publish, so they go stale in a way a result does not. */
const LISTING_MAX_AGE = 60
const LISTING_SHARED_MAX_AGE = 300

/**
 * The default for every public route: private, uncacheable, unstorable.
 *
 * Applied at the router so it covers error responses too. `no-store` rather than
 * `no-cache` — the latter permits storage and merely requires revalidation,
 * which is not the same promise.
 */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
}

/**
 * Marks a response as a public fact anybody may be served from a shared cache.
 *
 * Called on the success path only, so a 404 for an unpublished result keeps the
 * router's `no-store` and cannot be cached as "this commune has nothing" for a
 * day after it is announced.
 *
 * `stale-while-revalidate` lets a CDN keep serving the last good copy while it
 * refreshes, which is precisely the behaviour wanted during a spike: the origin
 * sees one request per interval instead of the whole country's.
 */
export function cachePublishedResult(res: Response): void {
  res.set(
    'Cache-Control',
    `public, max-age=${PUBLISHED_RESULT_MAX_AGE}, s-maxage=${PUBLISHED_RESULT_SHARED_MAX_AGE}, stale-while-revalidate=${PUBLISHED_RESULT_SHARED_MAX_AGE}`,
  )
}

/** The same, with the shorter lifetime a listing needs. */
export function cachePublicListing(res: Response): void {
  res.set(
    'Cache-Control',
    `public, max-age=${LISTING_MAX_AGE}, s-maxage=${LISTING_SHARED_MAX_AGE}, stale-while-revalidate=${LISTING_SHARED_MAX_AGE}`,
  )
}
