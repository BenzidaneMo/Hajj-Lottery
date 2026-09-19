import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'

import { isAllowedOrigin, isProduction } from './config/env.js'
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

  // A single hop of trust: whatever connects directly to this process. In
  // local development nothing sits in front, so this is a no-op. Behind a
  // Cloudflare Tunnel (or any reverse proxy), `cloudflared` is the only thing
  // that can reach this port, and it forwards the real visitor IP via
  // X-Forwarded-For — without this, express-rate-limit would key every
  // tunnelled visitor's requests off the same loopback address.
  app.set('trust proxy', 1)

  // Credentialed CORS must name its origins explicitly — `origin: '*'` is
  // rejected by browsers alongside credentials, and would be a serious hole
  // if it were not. `isAllowedOrigin` is the same check `verifyRequestOrigin`
  // uses, so the two never disagree about what is trusted.
  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, !origin || isAllowedOrigin(origin))
      },
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

  // Order matters: unmatched /api routes 404 as JSON before anything below
  // gets a chance to treat them as a client-side route.
  app.use('/api', notFoundHandler)

  // Serving the client's production build from this same origin is what lets
  // a single Cloudflare Tunnel (or any single-port deployment) expose the
  // whole app as one HTTPS host, with the frontend calling `/api/...`
  // same-origin rather than a separate public API hostname — see
  // docs/showcase-tunnel.md. Gated on NODE_ENV=production so the ordinary
  // two-process dev workflow (`dev:client` + `dev:server`) is untouched, and
  // on the build actually existing so an API-only production run (no
  // `client/dist`) still works exactly as before.
  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url))
  if (isProduction && fs.existsSync(clientDist)) {
    app.use(express.static(clientDist))
    // React Router's browser history needs every unmatched GET (a deep link
    // or a refresh on e.g. /admin/dashboard) to still return index.html.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'))
    })
  }

  // Every error — thrown or forwarded — leaves through this single handler.
  app.use(errorHandler)

  return app
}
