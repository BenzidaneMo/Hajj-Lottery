import cors from 'cors'
import express from 'express'

import { env } from './config/env.js'
import { healthRouter } from './routes/health.js'

export function createApp() {
  const app = express()

  app.use(cors({ origin: env.CLIENT_ORIGIN }))
  app.use(express.json())

  app.use('/api/health', healthRouter)

  return app
}
