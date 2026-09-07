import { Router } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import { createApplication, getRegistrationWindow } from '../controllers/application.controller.js'
import { asyncHandler } from '../middleware/error-handler.js'

/** Deliberately generous for a household sharing an address or a print shop
 *  submitting for several people, while still bounding automated abuse.
 *  The body-size cap lives on the global JSON parser in app.ts, which runs
 *  before any router and is therefore the only place it can take effect. */
const SUBMISSIONS_PER_HOUR = 20

/**
 * Built as a factory so each app instance owns its own counter, which keeps
 * tests isolated from one another.
 */
export function createApplicationsRouter(): Router {
  const router = Router()

  router.get('/registration-window', getRegistrationWindow)

  router.post(
    '/',
    rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: SUBMISSIONS_PER_HOUR,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
      handler: (_req, res) => {
        res.status(429).json({
          error: 'Too many registration attempts. Please try again later.',
          code: 'TOO_MANY_ATTEMPTS',
        })
      },
    }),
    asyncHandler(createApplication),
  )

  return router
}
