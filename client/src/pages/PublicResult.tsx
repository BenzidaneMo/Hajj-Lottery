import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { publicErrorMessage } from '../components/public/publicError'
import { WinnerList } from '../components/public/WinnerList'
import { Alert, Button, Card, ErrorState, Loading, PageHeader } from '../components/ui'
import { useDocumentTitle } from '../lib/document'
import { formatDateTime, formatNumber, formatYear } from '../lib/format'
import { isNotFound, usePublicResult } from '../lib/public'

/**
 * One commune's official result: `/results/:drawYear/:wilayaCode/:communeCode`.
 *
 * Addressed by the codes a citizen already uses, so the URL is one that can be
 * read out over the telephone, printed on a notice and shared — which this page
 * is meant to be, unlike the status lookup. No database id appears in it, and
 * nothing in the address identifies a person.
 *
 * A 404 here carries no information. A commune that never held a draw, one
 * whose result has not been announced, and a code that does not exist all
 * produce the same response from the API, so this page shows the same
 * "nothing announced" state for all three rather than trying to tell them
 * apart — the difference between them is exactly what would be worth knowing in
 * the window before an announcement.
 */
export function PublicResult() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { drawYear, wilayaCode, communeCode } = useParams()

  const { data: result, isLoading, error, refetch } = usePublicResult(drawYear, wilayaCode, communeCode)

  useDocumentTitle(
    result
      ? t('public.results.documentTitle', {
          commune: localizedGeoName(result.commune, locale),
          year: formatYear(result.drawYear, locale),
        })
      : t('public.results.title'),
  )

  const backToResults = (
    <Link to="/winners" className="print:hidden">
      <Button variant="secondary">{t('public.results.backToList')}</Button>
    </Link>
  )

  if (isLoading) return <Loading label={t('common.loading')} />

  if (error) {
    // The unpublished state and the genuinely-missing state are the same
    // response and get the same screen. Nothing about a winner is shown, and
    // nothing hints that there is something here to come back for.
    if (isNotFound(error)) {
      return (
        <div>
          <PageHeader title={t('public.results.title')} actions={backToResults} />
          <Alert variant="info" title={t('public.results.notPublishedTitle')}>
            {t('public.results.notPublishedBody')}
          </Alert>
        </div>
      )
    }

    return (
      <div>
        <PageHeader title={t('public.results.title')} actions={backToResults} />
        <ErrorState title={publicErrorMessage(error, t)} retryLabel={t('common.retry')} onRetry={refetch} />
      </div>
    )
  }

  if (!result) return null

  return (
    <article>
      <PageHeader
        title={t('public.results.communeTitle', {
          commune: localizedGeoName(result.commune, locale),
          year: formatYear(result.drawYear, locale),
        })}
        description={localizedGeoName(result.wilaya, locale)}
        actions={backToResults}
      />

      <div className="flex flex-col gap-6">
        <Card title={t('public.results.summary')}>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Figure label={t('public.results.allocatedSpots')}>
              {formatNumber(result.allocatedSpots, locale)}
            </Figure>
            <Figure label={t('public.results.entryCount')}>{formatNumber(result.entryCount, locale)}</Figure>
            <Figure label={t('public.results.winnerCount')}>
              {formatNumber(result.winnerCount, locale)}
            </Figure>
            <Figure label={t('public.results.winningParticipantCount')}>
              {formatNumber(result.winningParticipantCount, locale)}
            </Figure>
            <Figure label={t('public.results.drawnAt')}>{formatDateTime(result.drawnAt, locale)}</Figure>
            <Figure label={t('public.results.publishedAt')}>
              {formatDateTime(result.publishedAt, locale)}
            </Figure>
          </dl>
        </Card>

        <section aria-labelledby="winners-heading">
          <h2 id="winners-heading" className="mb-3 text-lg font-semibold text-stone-900">
            {t('public.results.winners')}
          </h2>
          <WinnerList winners={result.winners} />
        </section>

        {/*
          The commitment to the frozen input, published so the result can be
          shown to be the one that was drawn. It is a SHA-256 over the pool's
          canonical form and it is emphatically not a seed — the randomness came
          from the operating system, never from who entered — and it reveals
          nothing about any applicant. The two internal numbers a citizen might
          expect beside it, the random value and the total active weight, are
          audit information and are not published.
        */}
        <Card title={t('public.results.verification')} description={t('public.results.verificationHint')}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Figure label={t('public.results.algorithmVersion')}>
              <span className="font-mono text-sm">{result.algorithmVersion}</span>
            </Figure>
            <div>
              <dt className="text-xs font-medium text-stone-500">{t('public.results.poolHash')}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-stone-700">{result.poolHash}</dd>
            </div>
          </dl>
        </Card>

        <div className="print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>
            {t('register.receipt.print')}
          </Button>
        </div>
      </div>
    </article>
  )
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-stone-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-stone-900">{children}</dd>
    </div>
  )
}
