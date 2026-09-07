import { canOpenAdminArea, type AdminArea } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { useAuth } from '../../../lib/auth-context'
import { CloseIcon } from '../../icons'
import { Logo } from '../../Logo'
import { IconButton } from '../../ui'

const ADMIN_NAV_ITEMS: ReadonlyArray<{ to: string; key: string; end: boolean; area: AdminArea }> = [
  { to: '/admin', key: 'admin.nav.dashboard', end: true, area: 'dashboard' },
  { to: '/admin/participants', key: 'admin.nav.participants', end: false, area: 'participants' },
  { to: '/admin/applications', key: 'admin.nav.applications', end: false, area: 'applications' },
  { to: '/admin/communes', key: 'admin.nav.communes', end: false, area: 'communes' },
  { to: '/admin/draws', key: 'admin.nav.draws', end: false, area: 'draws' },
  { to: '/admin/winners', key: 'admin.nav.winners', end: false, area: 'winners' },
  { to: '/admin/history', key: 'admin.nav.history', end: false, area: 'history' },
  { to: '/admin/imports', key: 'admin.nav.imports', end: false, area: 'imports' },
  { to: '/admin/approvals', key: 'admin.nav.approvals', end: false, area: 'approvals' },
  { to: '/admin/audit', key: 'admin.nav.audit', end: false, area: 'audit' },
  { to: '/admin/admins', key: 'admin.nav.admins', end: false, area: 'admins' },
  { to: '/admin/settings', key: 'admin.nav.settings', end: false, area: 'settings' },
]

export interface AdminSidebarProps {
  /** Provided only for the mobile overlay variant; closes the panel on navigation. */
  onNavigate?: () => void
}

export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()

  // Hiding a link the caller cannot use is a courtesy, not a control: the
  // server refuses the same request whether or not the link was rendered.
  const visibleItems = user ? ADMIN_NAV_ITEMS.filter((item) => canOpenAdminArea(user.role, item.area)) : []

  return (
    <div className="flex h-full w-72 flex-col border-e border-stone-200 bg-white md:w-64">
      <div className="flex h-16 items-center justify-between gap-2 border-b border-stone-200 px-4">
        <Logo to="/admin" />
        {onNavigate && (
          <IconButton
            icon={<CloseIcon className="h-5 w-5" />}
            label={t('common.closeMenu')}
            variant="ghost"
            onClick={onNavigate}
          />
        )}
      </div>
      <nav aria-label={t('admin.nav.ariaLabel')} className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 ${
                isActive
                  ? 'bg-primary-50 text-primary-800'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`
            }
          >
            {t(item.key)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
