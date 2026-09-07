import type { AdminRole } from '@prisma/client'
import type { RequestHandler } from 'express'

import { ForbiddenError } from '../lib/errors.js'
import { getAuthenticatedUser } from './require-authenticated-user.js'

/**
 * Authorization by role. Always mounted *after* `requireAuthenticatedUser`,
 * which stays responsible for identity alone.
 *
 * Using this instead of `if (user.role === '...')` inside handlers keeps every
 * rule visible at the route definition, and keeps role strings out of
 * controller bodies where a typo would silently grant access.
 */
export function requireRole(...roles: [AdminRole, ...AdminRole[]]): RequestHandler {
  return (req, _res, next) => {
    const user = getAuthenticatedUser(req)

    if (!roles.includes(user.role)) {
      // Deliberately does not name the roles that would have worked.
      next(new ForbiddenError('FORBIDDEN_ROLE', 'You do not have permission to perform this action'))
      return
    }

    next()
  }
}
