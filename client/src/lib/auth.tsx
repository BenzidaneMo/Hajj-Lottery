import type { AuthenticatedUserDto } from '@hajj-lottery/shared'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ApiError, apiGet, apiPost, setUnauthenticatedHandler } from './api'
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context'

/**
 * Holds the admin session for the app.
 *
 * There is no token here and nothing in localStorage: the session lives in an
 * HttpOnly cookie the browser attaches automatically. This state is only a
 * cached answer to "is the cookie currently valid?", refreshed from
 * `GET /api/auth/me`. The server remains the authority — these values drive
 * UX, never access.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [user, setUser] = useState<AuthenticatedUserDto | undefined>(undefined)

  // A session that expires while the tab is open shows up as a 401 on the
  // next call; reflect that here so the route guard can redirect.
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setUser(undefined)
      setStatus('unauthenticated')
    })
    return () => setUnauthenticatedHandler(undefined)
  }, [])

  useEffect(() => {
    let cancelled = false

    apiGet<AuthenticatedUserDto>('/api/auth/me')
      .then((me) => {
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setUser(undefined)
        setStatus('unauthenticated')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    const me = await apiPost<AuthenticatedUserDto>('/api/auth/login', { username, password })
    setUser(me)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    try {
      await apiPost<void>('/api/auth/logout')
    } catch (error) {
      // A session the server already considers gone is still signed out here.
      if (!(error instanceof ApiError) || error.status !== 401) throw error
    } finally {
      setUser(undefined)
      setStatus('unauthenticated')
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signIn, signOut }),
    [status, user, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
