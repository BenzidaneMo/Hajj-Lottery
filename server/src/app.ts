import cors from 'cors'
import express from 'express'

import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { communesRouter } from './routes/communes.js'
import { healthRouter } from './routes/health.js'
import { participantsRouter } from './routes/participants.js'
import { wilayasRouter } from './routes/wilayas.js'

export function createApp() {
  const app = express()

  app.use(cors({ origin: env.CLIENT_ORIGIN }))
  app.use(express.json())

  app.use('/api/health', healthRouter)
  app.use('/api/wilayas', wilayasRouter)
  app.use('/api/communes', communesRouter)
  app.use('/api/participants', participantsRouter)

  // Order matters: unmatched /api routes 404 as JSON, then every error —
  // thrown or forwarded — leaves through the single handler.
  app.use('/api', notFoundHandler)
  app.use(errorHandler)

  return app
}
