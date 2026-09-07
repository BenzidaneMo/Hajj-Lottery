import type { RequestHandler } from 'express'
import { timingSafeEqual } from 'node:crypto'

import { env } from '../config/env.js'
import { NotConfiguredError, UnauthorizedError } from '../lib/errors.js'

export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key'

/**
 * TEMPORARY access gate for routes that expose personal data.
 *
 * Admin authentication is a later step; until it lands, participant routes
 * must still not be publicly enumerable. This requires a shared secret and
 * fails closed: if INTERNAL_API_KEY is unset the routes are unavailable
 * rather than open. Replace this with the real admin session/role check
 * (SUPER_ADMIN / WILAYA_ADMIN / COMMUNE_ADMIN) once it exists.
 */
export const requireInternalApiKey: RequestHandler = (req, _res, next) => {
  const expected = env.INTERNAL_API_KEY
  if (!expected) {
    throw new NotConfiguredError('This endpoint is unavailable because INTERNAL_API_KEY is not configured')
  }

  const provided = req.get(INTERNAL_API_KEY_HEADER)
  if (!provided || !matchesSecret(provided, expected)) {
    throw new UnauthorizedError('A valid internal API key is required')
  }

  next()
}

/** Constant-time comparison, so a wrong key leaks nothing through timing. */
function matchesSecret(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  if (providedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(providedBytes, expectedBytes)
}
