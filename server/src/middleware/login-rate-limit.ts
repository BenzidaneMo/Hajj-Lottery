import type { RequestHandler } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

/** Failed attempts allowed per window, per IP + username pair. */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

/**
 * Brute-force protection for the login endpoint.
 *
 * Keyed by IP *and* submitted username, so one attacker cannot lock out a
 * real administrator by exhausting that account's budget from elsewhere, and
 * a shared NAT does not lock out everyone behind it. Successful logins do not
 * consume the budget.
 *
 * Built per app instance rather than at module scope so tests get a clean
 * counter. NOTE: the store is in-memory — running multiple API instances
 * would give each its own budget; a shared store belongs with that
 * deployment change.
 */
export function createLoginRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : ''
      // ipKeyGenerator normalizes IPv6 to a subnet, so an attacker cannot
      // sidestep the limit by rotating addresses within their own /64.
      return `${ipKeyGenerator(req.ip ?? '')}:${username}`
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: 'Too many authentication attempts. Please try again later.',
        code: 'TOO_MANY_ATTEMPTS',
      })
    },
  })
}
