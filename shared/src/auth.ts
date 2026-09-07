import type { AdminRole } from './roles.js'

/**
 * The only administrator information that leaves the server.
 *
 * Password hashes, session tokens and internal bookkeeping are absent by
 * construction — this type is what `GET /api/auth/me` and a successful login
 * return, and nothing else about a `User` is ever serialized.
 */
export interface AuthenticatedUserDto {
  id: string
  username: string
  role: AdminRole
  /** ISO timestamp of the previous sign-in, or null for a first login. */
  lastLoginAt: string | null
}

/** Body of POST /api/auth/login. */
export interface LoginRequest {
  username: string
  password: string
}
