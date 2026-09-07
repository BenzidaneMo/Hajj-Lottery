import type { RequestHandler } from 'express'

import { allowedOrigins } from '../config/env.js'
import { ApiError } from '../lib/errors.js'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Defence in depth against CSRF, alongside the session cookie's
 * `SameSite=Lax` attribute (see docs/authentication.md for the full
 * rationale).
 *
 * Browsers send `Origin` on every cross-origin request and on all
 * state-changing same-origin ones — including form posts, which CORS does
 * not preflight and therefore does not stop. Rejecting an unrecognized
 * `Origin` closes that gap without a token framework.
 *
 * A missing `Origin` is allowed: non-browser callers (curl, server-to-server,
 * the test suite) omit it, and they are not subject to CSRF, which depends on
 * a browser attaching cookies automatically.
 */
export const verifyRequestOrigin: RequestHandler = (req, _res, next) => {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next()
    return
  }

  const origin = req.get('origin')
  if (origin && !allowedOrigins.includes(origin)) {
    next(new ApiError(403, 'FORBIDDEN_ORIGIN', 'Request origin is not allowed'))
    return
  }

  next()
}
