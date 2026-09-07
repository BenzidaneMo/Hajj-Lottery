import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { CloseIcon } from '../../icons'
import { Logo } from '../../Logo'
import { IconButton } from '../../ui'

const ADMIN_NAV_ITEMS = [
  { to: '/admin', key: 'admin.nav.dashboard', end: true },
  { to: '/admin/participants', key: 'admin.nav.participants', end: false },
  { to: '/admin/applications', key: 'admin.nav.applications', end: false },
  { to: '/admin/communes', key: 'admin.nav.communes', end: false },
  { to: '/admin/draws', key: 'admin.nav.draws', end: false },
  { to: '/admin/winners', key: 'admin.nav.winners', end: false },
  { to: '/admin/history', key: 'admin.nav.history', end: false },
  { to: '/admin/imports', key: 'admin.nav.imports', end: false },
  { to: '/admin/approvals', key: 'admin.nav.approvals', end: false },
  { to: '/admin/audit', key: 'admin.nav.audit', end: false },
  { to: '/admin/admins', key: 'admin.nav.admins', end: false },
  { to: '/admin/settings', key: 'admin.nav.settings', end: false },
] as const

export interface AdminSidebarProps {
  /** Provided only for the mobile overlay variant; closes the panel on navigation. */
  onNavigate?: () => void
}

export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const { t } = useTranslation()

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
        {ADMIN_NAV_ITEMS.map((item) => (
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
