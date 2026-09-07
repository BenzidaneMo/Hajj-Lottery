import type { CookieOptions } from 'express'

import { env, isProduction } from './env.js'

export const SESSION_COOKIE_NAME = 'hajj_admin_session'

export const SESSION_TTL_MS = env.SESSION_TTL_HOURS * 60 * 60 * 1000

/**
 * Cookie attributes for the session cookie.
 *
 * - `httpOnly` — unreadable from JavaScript, so an XSS cannot exfiltrate the
 *   session. This is also why the token is never put in localStorage.
 * - `secure` in production only, so plain-HTTP local development still works.
 * - `sameSite: 'lax'` — the browser will not attach this cookie to
 *   cross-site requests, which is the project's primary CSRF defence.
 *   NOTE: this requires the admin client and the API to be same-site in
 *   production (e.g. app.example.dz and api.example.dz, or one origin behind
 *   a reverse proxy). See docs/authentication.md.
 * - `path: '/api'` — the cookie is only ever sent to the API surface.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api',
    maxAge: SESSION_TTL_MS,
  }
}

/** Same attributes minus `maxAge`, as required for a reliable cookie clear. */
export function clearedSessionCookieOptions(): CookieOptions {
  const { maxAge: _maxAge, ...rest } = sessionCookieOptions()
  return rest
}
