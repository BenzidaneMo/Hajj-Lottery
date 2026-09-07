import type { AuthenticatedUserDto } from '@hajj-lottery/shared'
import { createContext, useContext } from 'react'

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated'

export interface AuthContextValue {
  status: AuthStatus
  user: AuthenticatedUserDto | undefined
  /** Resolves on success; throws `ApiError` so the form can show a message. */
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

/** Lives apart from AuthProvider so that file exports only a component. */
export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth() must be used inside <AuthProvider>')
  return context
}
