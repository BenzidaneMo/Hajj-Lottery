import { localizedGeoName, type ApplicationReceiptDto, type SupportedLocale } from '@hajj-lottery/shared'
import { CheckIcon, CopyIcon, PrinterIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Field } from '../public/DescriptionField'
import { Alert, Button, Card } from '../ui'

export interface ApplicationReceiptProps {
  receipt: ApplicationReceiptDto
  /**
   * Whether a mobile number was submitted, and therefore whether the status
   * lookup can ever work for this application.
   *
   * A prop rather than a field on the receipt: the server deliberately does not
   * echo anything about the phone number back, and the form already knows
   * whether one was typed. Telling somebody at the counter that they will not be
   * able to check online is worth far more than discovering it in three months.
   */
  canCheckOnline: boolean
}

/**
 * The citizen's proof of registration.
 *
 * Shows only what the server returned — a reference, a place, a year and a
 * status. No names, no national IDs, nothing that would be sensitive if the
 * page were photographed, printed at a shared counter or left on screen.
 *
 * It also has to carry the one instruction the whole receipt exists for: what to
 * do with the reference later. Without an account to log into, this page is the
 * only moment anybody explains how to check an application, so the two values
 * the lookup needs are named here explicitly.
 */
export function ApplicationReceipt({ receipt, canCheckOnline }: ApplicationReceiptProps) {
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

      <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-primary-800">{t('register.receipt.reference')}</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-stone-900 select-all">
            {receipt.applicationReference}
          </p>
        </div>
        <Button onClick={copyReference} className="print:hidden">
          {copied ? (
            <CheckIcon aria-hidden="true" className="size-4" />
          ) : (
            <CopyIcon aria-hidden="true" className="size-4" />
          )}
          {copied ? t('register.receipt.copied') : t('register.receipt.copy')}
        </Button>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label={t('register.receipt.drawYear')}>{receipt.drawYear}</Field>
        {/* Keyed by the status the server returned, not by assuming one: the
            citizen sees the verdict their application actually carries. */}
        <Field label={t('register.receipt.status')}>{t(`register.receipt.statuses.${receipt.status}`)}</Field>
        <Field label={t('geo.wilaya.label')}>{localizedGeoName(receipt.wilaya, locale)}</Field>
        <Field label={t('geo.commune.label')}>{localizedGeoName(receipt.commune, locale)}</Field>
        <Field label={t('register.receipt.entryType')}>{t(`register.entryType.${receipt.entryType}`)}</Field>
        <Field label={t('register.receipt.submittedAt')}>
          {new Date(receipt.submittedAt).toLocaleString(locale)}
        </Field>
      </dl>

      <p className="mt-6 text-sm text-stone-600">{t('register.receipt.keepReference')}</p>

      <section className="mt-6 rounded-md bg-stone-50 p-4 text-sm text-stone-700">
        <h2 className="font-medium text-stone-900">{t('register.receipt.checkStatus')}</h2>
        <p className="mt-1">{t('register.receipt.checkStatusHint')}</p>
      </section>

      {!canCheckOnline && (
        <div className="mt-4">
          <Alert variant="warning">{t('register.receipt.noPhoneWarning')}</Alert>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          <PrinterIcon aria-hidden="true" className="size-4" />
          {t('register.receipt.print')}
        </Button>
      </div>
    </Card>
  )
}
