import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'

import { allowedOrigins } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { verifyRequestOrigin } from './middleware/verify-request-origin.js'
import { adminRouter } from './routes/admin.js'
import { createApplicationsRouter } from './routes/applications.js'
import { createAuthRouter } from './routes/auth.js'
import { communesRouter } from './routes/communes.js'
import { healthRouter } from './routes/health.js'
import { participantsRouter } from './routes/participants.js'
import { createPublicRouter } from './routes/public.js'
import { wilayasRouter } from './routes/wilayas.js'

export function createApp() {
  const app = express()

  // Credentialed CORS must name its origins explicitly — `origin: '*'` is
  // rejected by browsers alongside credentials, and would be a serious hole
  // if it were not.
  app.use(
    cors({
      origin: [...allowedOrigins],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  )
  // Almost every endpoint here takes a small JSON body — a two-person
  // registration form is typical. The one exception is the batch pool-freeze/
  // draw-execution routes, which send a `communeDrawIds` array that can name
  // every commune in the country at once: 1541 cuids is already ~43kb.
  // Capping globally (rather than per-router) is what actually bounds an
  // oversized request, since the parser runs before any router could impose
  // its own — so the limit has to cover that one legitimate large body,
  // comfortably under Express's own 100kb default.
  app.use(express.json({ limit: '100kb' }))
  app.use(cookieParser())
  app.use(verifyRequestOrigin)

  app.use('/api/health', healthRouter)
  app.use('/api/auth', createAuthRouter())
  // Public geography: the registration form must be able to list every
  // commune, so these stay unrestricted. The administrator's own, scoped view
  // lives under /api/admin.
  app.use('/api/wilayas', wilayasRouter)
  app.use('/api/communes', communesRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/participants', participantsRouter)
  // Public: citizens register without an account, by design.
  app.use('/api/applications', createApplicationsRouter())
  // The citizen-facing read surface — status lookup, official results, draw
  // state. Grouped under one prefix so a CDN and a WAF have a path to point at.
  app.use('/api/public', createPublicRouter())

  // Order matters: unmatched /api routes 404 as JSON, then every error —
  // thrown or forwarded — leaves through the single handler.
  app.use('/api', notFoundHandler)
  app.use(errorHandler)

  return app
}
