import { Suspense } from 'react'
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
 *
 * It is also where the console's code arrives. The admin shell and its pages
 * are loaded lazily so the citizen pages never download them, and this is the
 * natural boundary for that wait: it is already the point where a visitor
 * without a session is turned away, so the chunk is fetched only for somebody
 * who is going to use it.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()

  const waiting = (
    <div className="flex min-h-screen items-center justify-center">
      <Loading label={t('common.loading')} />
    </div>
  )

  if (status === 'checking') return waiting

  if (status === 'unauthenticated') {
    // `from` lets the login page send them back where they were headed.
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }

  return <Suspense fallback={waiting}>{<Outlet />}</Suspense>
}
