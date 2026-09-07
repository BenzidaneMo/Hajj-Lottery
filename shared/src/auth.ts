import type { AdminRole } from './roles.js'
import type { AdminScopeDto } from './scope.js'

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
  isActive: boolean
  /**
   * Where this administrator may act. Informational for the client — the
   * server re-derives it from the database on every request and never reads
   * it back from a response or request body.
   */
  scope: AdminScopeDto
  /** ISO timestamp of the previous sign-in, or null for a first login. */
  lastLoginAt: string | null
}

/** Body of POST /api/auth/login. */
export interface LoginRequest {
  username: string
  password: string
}
