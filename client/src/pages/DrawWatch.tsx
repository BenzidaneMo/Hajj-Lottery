import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { DrawStage } from '../components/public/DrawStage'
import { publicErrorMessage } from '../components/public/publicError'
import { Button, ErrorState, Loading, PageHeader } from '../components/ui'
import { useDocumentTitle } from '../lib/document'
import { useDrawWatch } from '../lib/draw-watch'
import { formatYear } from '../lib/format'
import { usePublicResult } from '../lib/public'

/**
 * Watching one commune's draw: `/draw/:drawYear/:wilayaCode/:communeCode`.
 *
 * Two requests, composed. The draw status is polled — see `lib/draw-watch.ts`
 * for why polling and not a socket — and the full result is fetched exactly
 * once, and only after the status says a result has been announced. Polling a
 * result endpoint for a 404 while waiting would put load on the origin for an
 * answer already available in the cheaper, cacheable response next door.
 *
 * The page observes. There is no request it can make that runs, advances,
 * influences or reveals a draw ahead of the server: `/api/public/draw-status`
 * and `/api/public/results/...` are reads, executing a draw is a SUPER_ADMIN
 * POST behind a session on an entirely different router, and no number of
 * people opening this page amounts to anything but GETs on two cached
 * endpoints.
 */
export function DrawWatch() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { drawYear, wilayaCode, communeCode } = useParams()

  const addressable = drawYear !== undefined && wilayaCode !== undefined && communeCode !== undefined
  const watch = useDrawWatch(addressable ? { drawYear, wilayaCode, communeCode } : undefined)

  // Held back until the release gate has actually opened. `resultsPublished` is
  // the server's own flag; nothing here infers it from the phase.
  const published = watch.status?.resultsPublished === true
  const { data: result, isLoading: isResultLoading } = usePublicResult(
    drawYear,
    wilayaCode,
    communeCode,
    published,
  )

  const placeName = watch.status ? localizedGeoName(watch.status.commune, locale) : ''
  useDocumentTitle(
    watch.status
      ? t('public.draw.documentTitle', {
          commune: placeName,
          year: formatYear(watch.status.drawYear, locale),
        })
      : t('public.draw.title'),
  )

  const backToDraws = (
    <Link to="/draw">
      <Button variant="secondary">{t('public.draw.backToList')}</Button>
    </Link>
  )

  if (watch.isLoading) return <Loading label={t('common.loading')} />

  // A failed status read with nothing to fall back on. Distinguished from an
  // absent draw, which is a settled answer the stage renders as UNAVAILABLE.
  if (watch.error && !watch.status) {
    return (
      <div>
        <PageHeader title={t('public.draw.title')} actions={backToDraws} />
        <ErrorState
          title={publicErrorMessage(watch.error, t)}
          retryLabel={t('common.retry')}
          onRetry={watch.refetch}
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={
          watch.status
            ? t('public.draw.communeTitle', {
                commune: placeName,
                year: formatYear(watch.status.drawYear, locale),
              })
            : t('public.draw.title')
        }
        description={watch.status ? localizedGeoName(watch.status.wilaya, locale) : undefined}
        actions={backToDraws}
      />

      <DrawStage
        phase={watch.phase}
        status={watch.status}
        result={result}
        isResultLoading={published && isResultLoading}
      />

      {/*
        Says plainly whether the page is still watching. A citizen who leaves
        this open should be able to tell that it has stopped asking — after a
        published result there is nothing left to ask for, and pretending
        otherwise would invite them to sit on a page that will never change.
      */}
      <p className="mt-6 text-xs text-stone-500">
        {watch.isPolling ? t('public.draw.watching') : t('public.draw.notWatching')}
      </p>

      {published && (
        <div className="mt-4">
          <Link to={`/results/${drawYear}/${wilayaCode}/${communeCode}`}>
            <Button variant="secondary">{t('public.draw.viewOfficialResult')}</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
