import { Router } from 'express'

import { getCurrentUser, login, logout } from '../controllers/auth.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'
import { createLoginRateLimit } from '../middleware/login-rate-limit.js'
import { requireAuthenticatedUser } from '../middleware/require-authenticated-user.js'

/** Built as a factory so each app instance owns its own rate-limit counter. */
export function createAuthRouter(): Router {
  const router = Router()

  router.post('/login', createLoginRateLimit(), asyncHandler(login))

  // `requireAuthenticatedUser` proves identity only. Role checks belong to a
  // separate middleware, added with the RBAC step.
  router.get('/me', requireAuthenticatedUser, asyncHandler(getCurrentUser))
  router.post('/logout', requireAuthenticatedUser, asyncHandler(logout))

  return router
}
