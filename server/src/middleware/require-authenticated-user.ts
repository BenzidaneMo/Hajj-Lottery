import type { User } from '@prisma/client'
import type { Request, RequestHandler } from 'express'

import { SESSION_COOKIE_NAME } from '../config/session-cookie.js'
import { UnauthorizedError } from '../lib/errors.js'
import { authService } from '../services/auth.service.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Set by `requireAuthenticatedUser`. Optional in the type because it is
       * absent on unauthenticated routes; handlers behind the middleware
       * should read it through `getAuthenticatedUser(req)`.
       */
      authenticatedUser?: User
      /** The raw session token, needed by logout to revoke the right row. */
      sessionToken?: string
    }
  }
}

/**
 * Authentication only: proves *who* is calling. It intentionally performs no
 * role or scope checks — authorization arrives as a separate `requireRole`
 * middleware in the RBAC step, so the two concerns can never be conflated at
 * a call site.
 */
export const requireAuthenticatedUser: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE_NAME]

  if (typeof token !== 'string' || token.length === 0) {
    next(new UnauthorizedError('Authentication required'))
    return
  }

  authService
    .authenticate(token)
    .then((session) => {
      if (!session) {
        next(new UnauthorizedError('Authentication required'))
        return
      }
      req.authenticatedUser = session.user
      req.sessionToken = token
      next()
    })
    .catch(next)
}

/**
 * Reads the user attached by `requireAuthenticatedUser`. Throws rather than
 * returning undefined: reaching a handler without a user means the route was
 * wired without the middleware, which is a programming error, not a 401.
 */
export function getAuthenticatedUser(req: Request): User {
  const user = req.authenticatedUser
  if (!user) {
    throw new Error('getAuthenticatedUser() called on a route without requireAuthenticatedUser')
  }
  return user
}
