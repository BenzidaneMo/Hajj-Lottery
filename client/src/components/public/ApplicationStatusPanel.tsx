import { localizedGeoName, type PublicApplicationStatusDto, type SupportedLocale } from '@hajj-lottery/shared'
import { CheckIcon, CopyIcon, PrinterIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDateTime, formatYear } from '../../lib/format'
import { Alert, Button, Card } from '../ui'
import { Field } from './DescriptionField'
import { ApplicationStatusBadge, DrawPhaseBadge } from './PublicStatusBadge'

/**
 * One citizen's application, as the lookup answered it.
 *
 * Every field rendered here is named explicitly, and the list is the whole of
 * what this panel will ever show. That is deliberate rather than incidental:
 * rendering the DTO by iterating its keys would mean a field added to the API
 * later appears on this page without anybody deciding it should. The server
 * builds its public DTOs the same way, field by field, for the same reason.
 *
 * What is *not* here is the point. No name, no national ID, no date of birth,
 * no phone number — not even the one just used to verify the request, which the
 * server does not return and this component would have nowhere to get. No
 * weight, no participation history, no eligibility reason code, no internal id.
 *
 * Nothing is written to storage. There is no citizen session to create, so
 * closing the tab ends the visit, and the next person on a shared machine finds
 * an empty form rather than somebody's result.
 */
export function ApplicationStatusPanel({ status }: { status: PublicApplicationStatusDto }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [copied, setCopied] = useState(false)

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(status.applicationReference)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    } catch {
      // Clipboard access can be refused (permissions, an insecure context, an
      // older browser). The reference is on screen to copy by hand.
      setCopied(false)
    }
  }

  return (
    <Card className="print:border-0 print:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-stone-900">{t('public.lookup.resultTitle')}</h2>
        <ApplicationStatusBadge status={status.status} />
      </div>

      <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium text-primary-800">{t('public.results.reference')}</p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-stone-900 select-all">
            {status.applicationReference}
          </p>
        </div>
        <Button variant="secondary" onClick={copyReference} className="print:hidden">
          {copied ? (
            <CheckIcon aria-hidden="true" className="size-4" />
          ) : (
            <CopyIcon aria-hidden="true" className="size-4" />
          )}
          {copied ? t('register.receipt.copied') : t('register.receipt.copy')}
        </Button>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label={t('public.results.drawYear')}>{formatYear(status.drawYear, locale)}</Field>
        <Field label={t('public.results.publishedAt')}>
          {status.resultsPublished
            ? t('public.drawStatus.resultsPublished')
            : t('public.drawStatus.resultsPending')}
        </Field>
        <Field label={t('geo.wilaya.label')}>{localizedGeoName(status.wilaya, locale)}</Field>
        <Field label={t('geo.commune.label')}>{localizedGeoName(status.commune, locale)}</Field>
        <Field label={t('public.results.entryType')}>
          {t(`public.entryType.${status.entryType}`)}
          {status.applicantCount === 2 ? ` — ${t('public.lookup.twoApplicants')}` : ''}
        </Field>
        <Field label={t('public.drawStatus.phase')}>
          <DrawPhaseBadge phase={status.drawPhase} />
        </Field>
        <Field label={t('public.lookup.submittedAt')}>{formatDateTime(status.submittedAt, locale)}</Field>
      </dl>

      {/*
        Read from `resultsPublished`, never inferred from the status value. The
        server collapses SELECTED and NOT_SELECTED onto AWAITING_RESULTS until a
        national administrator publishes the commune's result, so there is no
        outcome to reveal here and nothing on this page could reconstruct one.
      */}
      {!status.resultsPublished && (
        <div className="mt-6">
          <Alert variant="info" title={t('public.lookup.resultsPendingTitle')}>
            {t('public.lookup.resultsPending')}
          </Alert>
        </div>
      )}

      {status.status === 'SELECTED' && (
        <div className="mt-6">
          <Alert variant="success" title={t('public.lookup.selectedTitle')}>
            {t('public.lookup.selectedBody')}
          </Alert>
        </div>
      )}

      {/* Says what a reserve position is and, deliberately, nothing about where
          this one stands: whether anybody has been called is administrative,
          and a page that counted down would be reporting on other people's
          circumstances. */}
      {status.status === 'RESERVE' && (
        <div className="mt-6">
          <Alert variant="info" title={t('public.lookup.reserveTitle')}>
            {t('public.lookup.reserveBody')}
          </Alert>
        </div>
      )}

      {status.status === 'NOT_SELECTED' && (
        <div className="mt-6">
          <Alert variant="info" title={t('public.lookup.notSelectedTitle')}>
            {t('public.lookup.notSelectedBody')}
          </Alert>
        </div>
      )}

      {status.status === 'NOT_ELIGIBLE' && (
        <div className="mt-6">
          {/* No reason. The server never sends one publicly — naming it would
              confirm which national IDs exist or who has won before. */}
          <Alert variant="warning" title={t('public.lookup.notEligibleTitle')}>
            {t('public.lookup.notEligibleBody')}
          </Alert>
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
