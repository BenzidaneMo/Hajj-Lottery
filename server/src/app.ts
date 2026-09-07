import cors from 'cors'
import express from 'express'

import { env } from './config/env.js'
import { communesRouter } from './routes/communes.js'
import { healthRouter } from './routes/health.js'
import { wilayasRouter } from './routes/wilayas.js'

export function createApp() {
  const app = express()

  app.use(cors({ origin: env.CLIENT_ORIGIN }))
  app.use(express.json())

  app.use('/api/health', healthRouter)
  app.use('/api/wilayas', wilayasRouter)
  app.use('/api/communes', communesRouter)

  return app
}
