import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Comparing a submitted verification value without leaking it through timing.
 *
 * The public status lookup is the only place in this system where an
 * unauthenticated caller submits a value that is compared against a stored one.
 * A plain `===` on two strings returns as soon as the first byte differs, and
 * its running time depends on the length of both — enough, over many requests,
 * to distinguish "no such application" from "wrong number" and to narrow down
 * what the right number starts with.
 *
 * Both sides are hashed to a fixed 32 bytes first. That is not for secrecy —
 * a phone number has far too little entropy for a digest to hide it, and nothing
 * here pretends otherwise. It is so the comparison always runs over the same
 * number of bytes regardless of what was submitted, which is what
 * `timingSafeEqual` needs (it throws on mismatched lengths) and what stops the
 * *length* of the input from being a side channel of its own.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}
