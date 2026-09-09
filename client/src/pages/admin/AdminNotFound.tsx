import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AdminPage } from '@/components/admin/AdminPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'

/**
 * An admin address that matches no page.
 *
 * Says only that the address does not exist. It does not say whether some
 * other account would have found something there — the same principle the API
 * follows, where an out-of-scope resource and one that was never created
 * return byte-identical answers.
 */
export function AdminNotFound() {
  const { t } = useTranslation()

  return (
    <AdminPage title={t('admin.notFound.title')}>
      <Alert>
        <AlertTitle>{t('admin.notFound.title')}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{t('admin.notFound.body')}</span>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin">{t('admin.notFound.backToDashboard')}</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </AdminPage>
  )
}
