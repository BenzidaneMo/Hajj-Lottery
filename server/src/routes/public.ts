import { Router } from 'express'

import {
  getPublicResult,
  listPublicDrawStatus,
  listPublicResults,
  lookupApplicationStatus,
} from '../controllers/public.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { noStore } from '../middleware/public-cache.js'
import { createStatusLookupRateLimit } from '../middleware/status-lookup-rate-limit.js'

/**
 * The public API: everything a citizen can reach without an account.
 *
 * Grouped under its own prefix rather than scattered among the existing
 * unauthenticated routes, because these are the endpoints a CDN, a WAF and a
 * rate limiter will eventually be pointed at, and "which paths are public?"
 * should have an answer a deployment can be configured from. There is no
 * authentication middleware on this router and there must never be one — the
 * status lookup verifies a receipt, which is not a session.
 *
 * Built as a factory so each app instance owns its own rate-limit counters,
 * which keeps tests isolated from one another.
 */
export function createPublicRouter(): Router {
  const router = Router()

  // Private by default, for every response including errors. The two cacheable
  // routes opt out on their success path only — a route that says nothing, and
  // any failure anywhere, stays out of shared caches. See middleware/public-cache.ts.
  router.use(noStore)

  // The one route here that takes input worth guessing at. Both limiters count
  // failures only, so checking your own application never costs budget.
  router.post('/application-status', ...createStatusLookupRateLimit(), asyncHandler(lookupApplicationStatus))

  // Official results. The listing reads published rows only, so an unannounced
  // result is absent rather than filtered — there is no parameter that reaches it.
  router.get('/results', asyncHandler(listPublicResults))
  // Wilaya and commune both, because a commune code is unique only within its
  // wilaya. Codes throughout: no database id appears in a public URL.
  router.get('/results/:drawYear/:wilayaCode/:communeCode', asyncHandler(getPublicResult))

  router.get('/draw-status', asyncHandler(listPublicDrawStatus))

  return router
}
