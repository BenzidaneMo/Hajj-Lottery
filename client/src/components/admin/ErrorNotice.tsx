import { AlertTriangleIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'
import { errorMessageKey } from '@/lib/error-message'

/**
 * Turns a failed request into something an operator can act on.
 *
 * The wording comes from `errorMessageKey`, which maps a status onto a fixed
 * set of translated sentences — the server's own message never reaches the
 * screen.
 */
export interface ErrorNoticeProps {
  error: unknown
  onRetry?: () => void
}

export function ErrorNotice({ error, onRetry }: ErrorNoticeProps) {
  const { t } = useTranslation()

  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>{t('admin.errors.title')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{t(errorMessageKey(error))}</span>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}
