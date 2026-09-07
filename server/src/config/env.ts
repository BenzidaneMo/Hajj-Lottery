import { fileURLToPath } from 'node:url'

import dotenv from 'dotenv'
import { z } from 'zod'

// The server always runs from server/, but the single .env file lives at the
// repository root so client, server, and Prisma share one source of truth.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

/** Treats an empty or whitespace-only value as "not set". */
const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CLIENT_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  /** How long an admin session stays valid without re-authenticating. */
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 30)
    .default(8),

  /**
   * Development-only Super Admin bootstrap credentials, read by
   * `npm run seed:admin`. Never consulted in production, and there is no
   * default — an unset password means no administrator is created.
   */
  DEV_ADMIN_USERNAME: optionalString,
  DEV_ADMIN_PASSWORD: optionalString,

  /** Explicit credentials for the production bootstrap (`npm run admin:create`). */
  ADMIN_USERNAME: optionalString,
  ADMIN_PASSWORD: optionalString,

  /**
   * The draw year citizens are currently registering for. Defaults to the
   * calendar year. This is the server's answer — a draw_year in a request
   * body is ignored — and is a placeholder for the real draw lifecycle.
   */
  DRAW_YEAR: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(2000).max(2200).optional(),
  ),

  /** Whether public registration accepts applications at all. */
  REGISTRATION_OPEN: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() !== 'false' : value),
    z.boolean().default(true),
  ),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // Only the failing variable NAMES are logged — never their values, which
  // may be credentials.
  console.error('Invalid environment configuration:', Object.keys(parsed.error.flatten().fieldErrors))
  throw new Error('Invalid environment configuration')
}

export const env = parsed.data

export const isProduction = env.NODE_ENV === 'production'

/**
 * Browser origins allowed to make credentialed requests. CLIENT_ORIGIN is
 * comma-separated; it is parsed into an explicit allowlist here because
 * credentialed CORS must never be answered with a wildcard.
 */
export const allowedOrigins: readonly string[] = env.CLIENT_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
