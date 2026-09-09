import type { RequestHandler } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

import { normalizeApplicationReference } from '../lib/application-reference.js'

/**
 * Abuse controls for the public application-status lookup.
 *
 * The endpoint verifies a receipt reference against a phone number, which makes
 * it the one place an unauthenticated caller can guess at something. Two
 * different attacks, so two different limits — a single per-IP counter cannot
 * address both, and set tight enough to stop the second it would break the first
 * set of legitimate users behind a carrier NAT.
 *
 * Neither limiter counts successful lookups. A citizen who checks their own
 * application ten times on results day is not the problem, and making them
 * compete for budget with an attacker on the same mobile network would punish
 * exactly the wrong person. Only failures cost anything, which is the same rule
 * the login limiter follows and for the same reason.
 *
 * Both stores are in-memory. Several API instances would each keep their own
 * counters, which weakens the ceiling proportionally; a shared store belongs
 * with that deployment change rather than here, and the distributed case is the
 * production-hardening phase's problem (see docs/public-access.md).
 */

/** Failed lookups one address may make per window before it is cut off. */
const FAILURES_PER_ADDRESS = 120
const ADDRESS_WINDOW_MS = 15 * 60 * 1000

/** Failed attempts against one reference, from anywhere, per window. */
const FAILURES_PER_REFERENCE = 8
const REFERENCE_WINDOW_MS = 60 * 60 * 1000

/**
 * The generic refusal.
 *
 * Says nothing about which limit was reached, how much budget is left, or when
 * it resets — and the `RateLimit` headers are switched off for the same reason.
 * A counter that reports its own state tells an attacker how to pace themselves,
 * and a *per-reference* counter that reported its state would be worse: it would
 * answer questions about a specific reference, which is the one thing this
 * endpoint must never do.
 */
const refuse: RequestHandler = (_req, res) => {
  res.status(429).json({
    error: 'Too many attempts. Please try again later.',
    code: 'TOO_MANY_ATTEMPTS',
  })
}

/**
 * Per-address, and deliberately loose.
 *
 * Algerian mobile networks put very large numbers of subscribers behind shared
 * addresses, so a tight per-IP limit on a results-day endpoint would lock out a
 * whole carrier because of one person. This is a ceiling on automated guessing
 * rather than a usage quota: with only failures counted, 120 in a quarter of an
 * hour is far beyond anything a human does by accident and far below what
 * enumeration needs.
 */
function byAddress(): RequestHandler {
  return rateLimit({
    windowMs: ADDRESS_WINDOW_MS,
    limit: FAILURES_PER_ADDRESS,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    // Normalizes IPv6 to a subnet, so rotating within one's own /64 does not
    // reset the counter.
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ''),
    handler: refuse,
  })
}

/**
 * Per-reference, and deliberately tight.
 *
 * This is the limit that matters. Somebody who has seen a receipt — a neighbour,
 * a clerk, a photograph on social media — knows a valid reference and needs only
 * the phone number, which is nine digits with a known prefix and a great deal of
 * local structure. Eight wrong answers an hour makes that search take longer
 * than the draw year.
 *
 * Keyed by the reference rather than by the caller precisely so it survives an
 * attacker changing address, and it is safe to key on because it reveals
 * nothing: a nonexistent reference and a real one accumulate failures
 * identically, so being refused never implies the reference exists.
 */
function byReference(): RequestHandler {
  return rateLimit({
    windowMs: REFERENCE_WINDOW_MS,
    limit: FAILURES_PER_REFERENCE,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const raw = typeof req.body?.applicationReference === 'string' ? req.body.applicationReference : ''
      // Normalized with the same function the lookup uses, so writing the
      // reference differently does not buy a fresh budget.
      return `reference:${normalizeApplicationReference(raw)}`
    },
    handler: refuse,
  })
}

/**
 * Both limits, address first.
 *
 * Order is not cosmetic. The per-reference store is keyed by a value the caller
 * chooses, so its key space is bounded only by how many distinct references
 * reach it; putting the address limit in front means a single source cannot mint
 * unbounded keys. Returned as a factory so each app instance owns its counters
 * and tests stay isolated from one another.
 */
export function createStatusLookupRateLimit(): RequestHandler[] {
  return [byAddress(), byReference()]
}
