import { MenuIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/shadcn/button'
import { Separator } from '@/components/shadcn/separator'

import { LanguageSwitcher } from '../../LanguageSwitcher'
import { AdminProfile } from './AdminProfile'

export interface AdminTopbarProps {
  onOpenSidebar: () => void
}

export function AdminTopbar({ onOpenSidebar }: AdminTopbarProps) {
  const { t } = useTranslation()

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenSidebar}
        aria-label={t('common.openMenu')}
      >
        <MenuIcon className="size-5" aria-hidden="true" />
      </Button>
      <div className="flex flex-1 items-center justify-end gap-3">
        <LanguageSwitcher />
        <Separator orientation="vertical" className="h-8" />
        <AdminProfile />
      </div>
    </header>
  )
}
