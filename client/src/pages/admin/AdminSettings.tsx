import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { AdminPage } from '@/components/admin/AdminPage'
import { FactList } from '@/components/admin/dialogs'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime } from '@/lib/format'

/**
 * The session an operator is working in.
 *
 * Read-only, and deliberately so. There is no configuration here because none
 * of what governs this system is client-side preference: the draw year comes
 * from `draw_years`, allocations from each commune draw, roles and geographic
 * reach from the account record, and none of it is something a settings screen
 * should be able to nudge.
 *
 * What it does show is who the server currently believes you are — useful when
 * a page refuses something and the operator needs to see the scope that
 * refused it.
 */
export function AdminSettings() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()

  const place = user?.scope.commune ?? user?.scope.wilaya

  return (
    <AdminPage title={t('admin.pages.settings.title')} description={t('admin.settings.description')}>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('admin.settings.sessionTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FactList
            facts={[
              { label: t('admin.admins.username'), value: user?.username ?? '—' },
              { label: t('admin.admins.role'), value: user ? t(`admin.roles.${user.role}`) : '—' },
              {
                label: t('admin.admins.scope'),
                value: place ? localizedGeoName(place, locale) : t('admin.profile.scope.national'),
              },
              {
                label: t('admin.admins.lastLogin'),
                value: user?.lastLoginAt ? formatDateTime(user.lastLoginAt, locale) : '—',
              },
            ]}
          />
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>{t('admin.settings.authorityTitle')}</AlertTitle>
        <AlertDescription>{t('admin.settings.authorityBody')}</AlertDescription>
      </Alert>

      <Alert>
        <AlertTitle>{t('admin.settings.sessionSecurityTitle')}</AlertTitle>
        {/* Worth stating where an operator will look for it: the session is a
            cookie the browser holds, not a token this app stores. */}
        <AlertDescription>{t('admin.settings.sessionSecurityBody')}</AlertDescription>
      </Alert>
    </AdminPage>
  )
}
