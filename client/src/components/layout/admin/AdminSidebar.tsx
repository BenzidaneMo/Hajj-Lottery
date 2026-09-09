import { canOpenAdminArea, type AdminArea } from '@hajj-lottery/shared'
import {
  ClipboardCheckIcon,
  ClipboardListIcon,
  FileSpreadsheetIcon,
  GaugeIcon,
  HistoryIcon,
  MapPinIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TrophyIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { ScrollArea } from '@/components/shadcn/scroll-area'
import { Separator } from '@/components/shadcn/separator'
import { useAuth } from '@/lib/auth-context'
import { cn } from '@/lib/cn'

import { Logo } from '../../Logo'

interface NavItem {
  to: string
  key: string
  end: boolean
  area: AdminArea
  icon: LucideIcon
}

/**
 * The console's information architecture, in the order operators work through
 * it: what needs attention, then the people and their applications, then the
 * draw itself, then the records and the governance around them.
 */
const ADMIN_NAV_ITEMS: readonly NavItem[] = [
  { to: '/admin', key: 'admin.nav.dashboard', end: true, area: 'dashboard', icon: GaugeIcon },
  {
    to: '/admin/applications',
    key: 'admin.nav.applications',
    end: false,
    area: 'applications',
    icon: ClipboardListIcon,
  },
  {
    to: '/admin/participants',
    key: 'admin.nav.participants',
    end: false,
    area: 'participants',
    icon: UsersIcon,
  },
  { to: '/admin/history', key: 'admin.nav.history', end: false, area: 'history', icon: HistoryIcon },
  { to: '/admin/draws', key: 'admin.nav.draws', end: false, area: 'draws', icon: ClipboardCheckIcon },
  { to: '/admin/communes', key: 'admin.nav.communes', end: false, area: 'communes', icon: MapPinIcon },
  { to: '/admin/winners', key: 'admin.nav.winners', end: false, area: 'winners', icon: TrophyIcon },
  {
    to: '/admin/imports',
    key: 'admin.nav.imports',
    end: false,
    area: 'imports',
    icon: FileSpreadsheetIcon,
  },
  {
    to: '/admin/approvals',
    key: 'admin.nav.approvals',
    end: false,
    area: 'approvals',
    icon: ShieldCheckIcon,
  },
  { to: '/admin/audit', key: 'admin.nav.audit', end: false, area: 'audit', icon: ScrollTextIcon },
  { to: '/admin/admins', key: 'admin.nav.admins', end: false, area: 'admins', icon: UsersIcon },
  { to: '/admin/settings', key: 'admin.nav.settings', end: false, area: 'settings', icon: SettingsIcon },
]

export interface AdminSidebarProps {
  /** Provided by the mobile sheet; closes the panel on navigation. */
  onNavigate?: () => void
}

/**
 * The navigation rail.
 *
 * Composed from primitives rather than shadcn's `sidebar` block, for a reason
 * worth stating: that block persists its collapsed state in a cookie, and
 * nothing in this application writes to browser storage that is not the
 * operator's language. A rail that opens and closes does not need to be
 * remembered across sessions badly enough to start.
 *
 * Which links appear is a courtesy. The server refuses the same request
 * whether or not the link was rendered, and typing the address of a hidden
 * page reaches a screen that reports what the server said.
 */
export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  const { t } = useTranslation()
  const { user } = useAuth()

  const visibleItems = user ? ADMIN_NAV_ITEMS.filter((item) => canOpenAdminArea(user.role, item.area)) : []

  return (
    <div className="flex h-full w-72 flex-col bg-card md:w-64">
      <div className="flex h-16 shrink-0 items-center px-4">
        <Logo to="/admin" />
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <nav aria-label={t('admin.nav.ariaLabel')} className="flex flex-col gap-0.5 p-3">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{t(item.key)}</span>
            </NavLink>
          ))}
        </nav>
      </ScrollArea>
    </div>
  )
}
