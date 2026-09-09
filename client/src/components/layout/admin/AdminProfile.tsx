import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { LogOutIcon, UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/shadcn/dropdown-menu'
import { useAuth } from '@/lib/auth-context'

/**
 * Who is signed in, what they may reach, and the way out.
 *
 * The role and scope shown here are the server's answer from
 * `GET /api/auth/me`, displayed so an operator can tell at a glance whose
 * territory they are looking at. They are a label, never a permission: nothing
 * in this component decides what the account can do.
 */
export function AdminProfile() {
  const { t, i18n } = useTranslation()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const locale = i18n.language as SupportedLocale

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
      navigate('/admin/login', { replace: true })
    } finally {
      setIsSigningOut(false)
    }
  }

  // Most specific place first: a commune admin is identified by their commune.
  const place = user?.scope.commune ?? user?.scope.wilaya
  const scopeLabel = place ? localizedGeoName(place, locale) : t('admin.profile.scope.national')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto gap-2 px-2 py-1.5">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <UserIcon className="size-4" />
          </span>
          <span className="hidden text-start sm:block">
            <span className="block text-sm font-medium">{user?.username ?? t('admin.profile.role')}</span>
            <span className="block text-xs text-muted-foreground">
              {user ? `${t(`admin.roles.${user.role}`)} · ${scopeLabel}` : null}
            </span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium">{user?.username}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {user ? t(`admin.roles.${user.role}`) : null}
          </span>
          <span className="text-xs font-normal text-muted-foreground">{scopeLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isSigningOut} onSelect={handleSignOut}>
          <LogOutIcon aria-hidden="true" />
          {isSigningOut ? t('admin.profile.signingOut') : t('admin.profile.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
