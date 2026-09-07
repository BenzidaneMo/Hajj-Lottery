import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Logo } from '../../components/Logo'
import { Card, EmptyState } from '../../components/ui'

/** Standalone shell — deliberately outside AdminLayout since there is no session yet. */
export function AdminLogin() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen flex-col bg-stone-50">
      <div className="flex items-center justify-between px-4 py-4 sm:px-6">
        <Logo to="/" />
        <LanguageSwitcher />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="w-full max-w-sm" title={t('admin.login.title')}>
          <EmptyState title={t('common.comingSoon')} />
        </Card>
      </main>
    </div>
  )
}
