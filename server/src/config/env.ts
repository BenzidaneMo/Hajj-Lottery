import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { z } from 'zod'

// The server always runs from server/, but the single .env file lives at the
// repository root so client, server, and Prisma share one source of truth.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  /**
   * Shared secret gating the participant API until admin authentication
   * exists. Optional on purpose — when unset those routes fail closed (503)
   * instead of the server refusing to boot, so the public geographic API
   * still runs. An empty value counts as unset, so the commented-out
   * placeholder in .env.example cannot break startup.
   */
  INTERNAL_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment configuration')
}

export const env = parsed.data
