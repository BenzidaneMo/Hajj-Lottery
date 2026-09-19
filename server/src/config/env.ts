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
  /**
   * Opt-in, comma-separated hostname suffixes (e.g. ".trycloudflare.com")
   * trusted in addition to the exact CLIENT_ORIGIN allowlist. Exists for a
   * temporary Cloudflare Quick Tunnel, whose hostname is a random subdomain
   * chosen at start time and cannot be listed in CLIENT_ORIGIN in advance.
   * Unset by default, so the allowlist stays exact-match-only unless an
   * operator deliberately opts in. Only ever matched against HTTPS origins —
   * see `isAllowedOrigin` below.
   */
  TRUSTED_ORIGIN_SUFFIXES: optionalString,
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

  // DRAW_YEAR and REGISTRATION_OPEN are gone. Which year is running, and
  // whether it accepts applications, are now the DrawYear table's answer —
  // configuration an administrator changes at runtime, not a value baked into
  // a deployment. See docs/draw-configuration.md.
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

const trustedOriginSuffixes: readonly string[] = (env.TRUSTED_ORIGIN_SUFFIXES ?? '')
  .split(',')
  .map((suffix) => suffix.trim())
  .filter((suffix) => suffix.length > 0)

/**
 * The server's own loopback origin — always allowed, independent of
 * CLIENT_ORIGIN. This is what a browser sends as `Origin` when it loaded the
 * page from this same process (see app.ts's production static-file serving),
 * so testing a production build at http://localhost:<PORT> works without
 * editing CLIENT_ORIGIN for it. Trusting it is safe: a browser cannot be made
 * to *send* this Origin unless it is genuinely running on this machine and
 * talking to this port directly — a remote visitor's "localhost" never
 * reaches here, tunnelled or not.
 */
const localOrigins: readonly string[] = [`http://localhost:${env.PORT}`, `http://127.0.0.1:${env.PORT}`]

/**
 * Whether a browser-supplied `Origin` header may make a credentialed request.
 * Used both by the CORS middleware and by `verifyRequestOrigin`'s CSRF check,
 * so the two can never disagree about what is trusted.
 *
 * An exact match against `allowedOrigins` or `localOrigins` always passes.
 * `trustedOriginSuffixes` additionally allows any HTTPS origin whose hostname
 * ends with a configured suffix — e.g. a Cloudflare Quick Tunnel's
 * `https://<random>.trycloudflare.com`. `trycloudflare.com` is itself on the
 * public suffix list, so browsers treat each random subdomain as its own
 * site: SameSite=Lax still stops one tunnel's origin from riding along with
 * another's session cookie, which is what makes trusting the whole suffix
 * safe rather than a blanket wildcard.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true
  if (localOrigins.includes(origin)) return true
  if (trustedOriginSuffixes.length === 0) return false

  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:') return false
    return trustedOriginSuffixes.some((suffix) => url.hostname.endsWith(suffix))
  } catch {
    return false
  }
}
