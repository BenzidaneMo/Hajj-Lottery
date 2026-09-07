import { localizedGeoName, type ApplicationReceiptDto, type SupportedLocale } from '@hajj-lottery/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, Button, Card } from '../ui'

export interface ApplicationReceiptProps {
  receipt: ApplicationReceiptDto
}

/**
 * The citizen's proof of registration.
 *
 * Shows only what the server returned — a reference, a place, a year and a
 * status. No names, no national IDs, nothing that would be sensitive if the
 * page were photographed, printed at a shared counter or left on screen.
 */
export function ApplicationReceipt({ receipt }: ApplicationReceiptProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [copied, setCopied] = useState(false)

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(receipt.applicationReference)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    } catch {
      // Clipboard access can be refused (permissions, insecure context, an
      // older browser). The reference is on screen to copy by hand.
      setCopied(false)
    }
  }

  return (
    <Card className="w-full max-w-xl print:border-0 print:shadow-none">
      <Alert variant="success" title={t('register.receipt.title')}>
        {t('register.receipt.subtitle')}
      </Alert>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-stone-500">{t('register.receipt.reference')}</dt>
          <dd className="mt-1 font-mono text-xl font-bold tracking-wider text-stone-900">
            {receipt.applicationReference}
          </dd>
        </div>

        <Field label={t('register.receipt.drawYear')}>{receipt.drawYear}</Field>
        <Field label={t('register.receipt.status')}>{t('register.receipt.statusPending')}</Field>
        <Field label={t('geo.wilaya.label')}>{localizedGeoName(receipt.wilaya, locale)}</Field>
        <Field label={t('geo.commune.label')}>{localizedGeoName(receipt.commune, locale)}</Field>
        <Field label={t('register.receipt.entryType')}>{t(`register.entryType.${receipt.entryType}`)}</Field>
        <Field label={t('register.receipt.submittedAt')}>
          {new Date(receipt.submittedAt).toLocaleString(locale)}
        </Field>
      </dl>

      <p className="mt-6 text-sm text-stone-600">{t('register.receipt.keepReference')}</p>

      <div className="mt-6 flex flex-wrap gap-3 print:hidden">
        <Button onClick={copyReference}>
          {copied ? t('register.receipt.copied') : t('register.receipt.copy')}
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          {t('register.receipt.print')}
        </Button>
      </div>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-stone-500">{label}</dt>
      <dd className="mt-1 text-sm text-stone-900">{children}</dd>
    </div>
  )
}
