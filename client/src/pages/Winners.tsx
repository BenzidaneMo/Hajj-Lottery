import { localizedGeoName, type PublicResultSummaryDto, type SupportedLocale } from '@hajj-lottery/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EMPTY_FILTERS, toQueryFilters, type PublicFilterValues } from '../components/public/filters'
import { PublicFilterBar } from '../components/public/PublicFilterBar'
import { publicErrorMessage } from '../components/public/publicError'
import { EmptyState, ErrorState, Loading, PageHeader, Pagination, Table } from '../components/ui'
import { formatDate, formatNumber, formatYear } from '../lib/format'
import { usePublicResults } from '../lib/public'

/**
 * Every officially announced result, most recently announced first.
 *
 * The listing reads `/api/public/results`, which is served from the publication
 * table rather than from draw results — a commune that has drawn but whose
 * result no national administrator has published yet is *absent* here, not
 * filtered out, and there is no combination of filters on this page that
 * reaches one. That is the release gate, and this page has no way around it.
 *
 * A row names a commune and counts; it does not name a person. Winner
 * references live one level down, on the result page for that commune.
 */
export function Winners() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const [filters, setFilters] = useState<PublicFilterValues>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  // Page size is the app's bounded default and is not settable from this
  // screen. There is no "show all" — the whole point of a paginated public
  // endpoint is that no single request can be made expensive.
  const { data, isLoading, error, refetch } = usePublicResults(toQueryFilters(filters), page)

  const changeFilters = (next: PublicFilterValues) => {
    setFilters(next)
    // Back to the first page: page 4 of the old filter is not page 4 of the new
    // one, and landing on an empty page reads as "no results" rather than as
    // "you are past the end".
    setPage(1)
  }

  const columns = [
    {
      key: 'drawYear',
      header: t('public.results.drawYear'),
      render: (row: PublicResultSummaryDto) => formatYear(row.drawYear, locale),
    },
    {
      key: 'wilaya',
      header: t('geo.wilaya.label'),
      render: (row: PublicResultSummaryDto) => localizedGeoName(row.wilaya, locale),
    },
    {
      key: 'commune',
      header: t('geo.commune.label'),
      render: (row: PublicResultSummaryDto) => (
        // Addressed by year and codes. No database id appears in a public URL,
        // and this one stays valid whatever the database does underneath.
        <Link
          className="font-medium text-primary-800 underline underline-offset-2 hover:text-primary-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
          to={`/results/${row.drawYear}/${row.wilaya.code}/${row.commune.code}`}
        >
          {localizedGeoName(row.commune, locale)}
        </Link>
      ),
    },
    {
      key: 'winnerCount',
      header: t('public.results.winnerCount'),
      render: (row: PublicResultSummaryDto) => formatNumber(row.winnerCount, locale),
    },
    {
      key: 'winningParticipantCount',
      header: t('public.results.winningParticipantCount'),
      render: (row: PublicResultSummaryDto) => formatNumber(row.winningParticipantCount, locale),
    },
    {
      key: 'publishedAt',
      header: t('public.results.publishedAt'),
      render: (row: PublicResultSummaryDto) => formatDate(row.publishedAt, locale),
    },
  ]

  return (
    <div>
      <PageHeader title={t('public.results.title')} description={t('public.results.intro')} />

      <div className="print:hidden">
        <PublicFilterBar value={filters} onChange={changeFilters} disabled={isLoading} />
      </div>

      {error ? (
        <ErrorState title={publicErrorMessage(error, t)} retryLabel={t('common.retry')} onRetry={refetch} />
      ) : isLoading ? (
        <Loading label={t('common.loading')} />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={t('public.results.empty')} description={t('public.results.emptyHint')} />
      ) : (
        data && (
          <div className="flex flex-col gap-6">
            <Table
              columns={columns}
              rows={data.items}
              getRowKey={(row) => `${row.drawYear}-${row.wilaya.code}-${row.commune.code}`}
              emptyMessage={t('public.results.empty')}
            />
            {/* `total` rather than i18next's reserved `count`: Arabic has six
                plural categories and this line needs none of them, so the
                number is interpolated as a locale-formatted value instead. */}
            <p className="text-sm text-stone-600">
              {t('public.results.total', { total: formatNumber(data.total, locale) })}
            </p>
            {data.totalPages > 1 && (
              <div className="print:hidden">
                <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
