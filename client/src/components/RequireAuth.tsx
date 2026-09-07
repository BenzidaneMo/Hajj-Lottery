import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../lib/auth-context'
import { Loading } from './ui'

/**
 * Keeps unauthenticated visitors out of /admin.
 *
 * This is a **UX guard only**. It stops someone seeing an empty admin shell
 * they have no session for; it is not a security boundary. Every admin API
 * enforces authentication server-side, independently of this component.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label={t('common.loading')} />
      </div>
    )
  }

  if (status === 'unauthenticated') {
    // `from` lets the login page send them back where they were headed.
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
