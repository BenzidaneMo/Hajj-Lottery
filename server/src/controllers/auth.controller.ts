import type { RequestHandler } from 'express'

import {
  clearedSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '../config/session-cookie.js'
import { UnauthorizedError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { authService, toAuthenticatedUserDto } from '../services/auth.service.js'
import { authorizationService } from '../services/authorization.service.js'
import { loginSchema } from '../validation/auth.js'

/**
 * The single message returned for every authentication failure. Whether the
 * username exists, the password was wrong, or the account is deactivated must
 * not be distinguishable from the response.
 */
const AUTHENTICATION_FAILED = 'Invalid username or password'

/** POST /api/auth/login */
export const login: RequestHandler = async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    // Deliberately the same error as bad credentials: a malformed body must
    // not be a cheaper way to probe for valid usernames.
    throw new UnauthorizedError(AUTHENTICATION_FAILED)
  }

  const user = await authService.verifyCredentials(parsed.data.username, parsed.data.password)
  if (!user) {
    throw new UnauthorizedError(AUTHENTICATION_FAILED)
  }

  // Read before startSession(), which overwrites it with the current time.
  const previousLoginAt = user.lastLoginAt

  const session = await authService.startSession(user.id)
  const scope = await authorizationService.describeScope(user)

  res.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions())
  res.json(toAuthenticatedUserDto({ ...user, lastLoginAt: previousLoginAt }, scope))
}

/** GET /api/auth/me */
export const getCurrentUser: RequestHandler = async (req, res) => {
  const user = getAuthenticatedUser(req)
  res.json(toAuthenticatedUserDto(user, await authorizationService.describeScope(user)))
}

/**
 * POST /api/auth/logout — revokes the session server-side, so the cookie is
 * dead even if a copy of it was captured before the request.
 */
export const logout: RequestHandler = async (req, res) => {
  if (req.sessionToken) {
    await authService.endSession(req.sessionToken)
  }
  res.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions())
  res.status(204).end()
}
