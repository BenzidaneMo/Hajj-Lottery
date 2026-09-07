import type { AuthenticatedUserDto } from '@hajj-lottery/shared'
import type { PrismaClient, Session, User } from '@prisma/client'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { SESSION_TTL_MS } from '../config/session-cookie.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { prisma as defaultPrisma } from '../lib/prisma.js'

/**
 * A password digest for a user that does not exist. Verified against on every
 * failed lookup so that "unknown username" and "wrong password" take the same
 * amount of work — otherwise response timing would reveal which usernames are
 * registered, defeating the generic error message.
 */
let absentUserDigest: string | undefined

async function getAbsentUserDigest(): Promise<string> {
  absentUserDigest ??= await hashPassword(randomBytes(32).toString('hex'))
  return absentUserDigest
}

/** Login identifiers are compared case-insensitively. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

/** Only the digest of a session token is stored, never the token itself. */
function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface EstablishedSession {
  /** The opaque value to put in the cookie. Never persisted anywhere. */
  token: string
  expiresAt: Date
}

/**
 * Administrator identity and session lifecycle.
 *
 * Deliberately knows nothing about roles beyond carrying one: this step
 * establishes *who* a request is from, not *what* they may do.
 */
export class AuthService {
  private readonly db: PrismaClient

  constructor(db: PrismaClient = defaultPrisma) {
    this.db = db
  }

  /**
   * Checks credentials. Returns null for every failure mode — unknown user,
   * wrong password, deactivated account — so callers cannot accidentally
   * turn the distinction into a user-visible message.
   */
  async verifyCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.db.user.findUnique({
      where: { username: normalizeUsername(username) },
    })

    if (!user) {
      // Equalize timing against the "user exists" path before giving up.
      await verifyPassword(await getAbsentUserDigest(), password)
      return null
    }

    const passwordMatches = await verifyPassword(user.passwordHash, password)
    if (!passwordMatches) return null

    // Checked after the password so a deactivated account is not detectable
    // by response timing alone.
    if (!user.isActive) return null

    return user
  }

  /** Issues a fresh session and records the successful sign-in. */
  async startSession(userId: string): Promise<EstablishedSession> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)

    await this.db.$transaction([
      this.db.session.create({
        data: { tokenHash: hashSessionToken(token), userId, expiresAt },
      }),
      this.db.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      }),
    ])

    return { token, expiresAt }
  }

  /**
   * Resolves a cookie token to its user, or null if the session is unknown,
   * expired, or belongs to an account that has since been deactivated.
   * Expired rows are deleted on sight rather than left to accumulate.
   */
  async authenticate(token: string): Promise<(Session & { user: User }) | null> {
    const session = await this.db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    })

    if (!session) return null

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.endSessionById(session.id)
      return null
    }

    if (!session.user.isActive) {
      await this.endSessionsForUser(session.user.id)
      return null
    }

    return session
  }

  /** Revokes one session. Safe to call with a token that no longer exists. */
  async endSession(token: string): Promise<void> {
    await this.db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } })
  }

  private async endSessionById(id: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id } })
  }

  /** Revokes every session for a user — used when an account is deactivated. */
  async endSessionsForUser(userId: string): Promise<void> {
    await this.db.session.deleteMany({ where: { userId } })
  }

  /** Housekeeping for expired rows; safe to call at any time. */
  async purgeExpiredSessions(): Promise<number> {
    const { count } = await this.db.session.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    })
    return count
  }
}

/**
 * The only shape of a user that may leave the server. Password hash, session
 * data and internal timestamps are omitted by construction rather than by
 * remembering to delete them.
 */
export function toAuthenticatedUserDto(user: User): AuthenticatedUserDto {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }
}

/** Constant-time string comparison for secrets of equal expected length. */
export function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  if (providedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(providedBytes, expectedBytes)
}

export const authService = new AuthService()
