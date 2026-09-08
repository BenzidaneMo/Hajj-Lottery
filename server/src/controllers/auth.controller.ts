import type { RequestHandler } from 'express'

import {
  clearedSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '../config/session-cookie.js'
import { UnauthorizedError } from '../lib/errors.js'
import { getAuthenticatedUser } from '../middleware/require-authenticated-user.js'
import { auditActor, auditService } from '../services/audit.service.js'
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
    // No actor, and nothing identifying the attempt. Recording the username
    // would turn the trail into a list of guessed account names, and recording
    // whether it matched would answer through the audit log the very question
    // the generic 401 refuses to answer through the response.
    //
    // This fires only for attempts that reached credential checking; ones the
    // rate limiter already rejected are not recorded, since a flood of them
    // would bury everything else. Correlating attempts is the limiter's job.
    await auditService.recordSecurityEvent({
      action: 'AUTH_LOGIN_FAILURE',
      actor: null,
      targetType: 'USER',
      targetId: null,
    })

    throw new UnauthorizedError(AUTHENTICATION_FAILED)
  }

  // Read before startSession(), which overwrites it with the current time.
  const previousLoginAt = user.lastLoginAt

  const session = await authService.startSession(user.id)
  const scope = await authorizationService.describeScope(user)

  // The actor is the user the credentials resolved to, never anything from the
  // body. No token, no session id, no password — a successful sign-in is a fact
  // about who and when, and nothing else belongs in a permanent record.
  await auditService.recordSecurityEvent({
    action: 'AUTH_LOGIN_SUCCESS',
    actor: auditActor(user),
    targetType: 'USER',
    targetId: user.id,
  })

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
  const user = getAuthenticatedUser(req)

  if (req.sessionToken) {
    await authService.endSession(req.sessionToken)
  }

  await auditService.recordSecurityEvent({
    action: 'AUTH_LOGOUT',
    actor: auditActor(user),
    targetType: 'USER',
    targetId: user.id,
  })

  res.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions())
  res.status(204).end()
}
