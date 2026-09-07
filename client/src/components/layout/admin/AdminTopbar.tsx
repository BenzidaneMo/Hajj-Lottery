import { useTranslation } from 'react-i18next'

import { MenuIcon } from '../../icons'
import { LanguageSwitcher } from '../../LanguageSwitcher'
import { IconButton } from '../../ui'
import { AdminProfile } from './AdminProfile'

export interface AdminTopbarProps {
  onOpenSidebar: () => void
}

export function AdminTopbar({ onOpenSidebar }: AdminTopbarProps) {
  const { t } = useTranslation()

  return (
    <header className="flex h-16 items-center gap-4 border-b border-stone-200 bg-white px-4 sm:px-6 lg:px-8">
      <IconButton
        icon={<MenuIcon className="h-5 w-5" />}
        label={t('common.openMenu')}
        variant="ghost"
        className="md:hidden"
        onClick={onOpenSidebar}
      />
      <div className="flex flex-1 items-center justify-end gap-4">
        <LanguageSwitcher />
        <AdminProfile />
      </div>
    </header>
  )
}
