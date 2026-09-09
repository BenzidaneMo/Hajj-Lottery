import { localizedGeoName, type PublicDrawStatusDto, type SupportedLocale } from '@hajj-lottery/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { DrawPhaseBadge } from '../components/public/PublicStatusBadge'
import { EMPTY_FILTERS, toQueryFilters, type PublicFilterValues } from '../components/public/filters'
import { PublicFilterBar } from '../components/public/PublicFilterBar'
import { publicErrorMessage } from '../components/public/publicError'
import { Badge, EmptyState, ErrorState, Loading, PageHeader, Pagination, Table } from '../components/ui'
import { formatNumber, formatYear } from '../lib/format'
import { usePublicDrawStatus } from '../lib/public'

/**
 * Where every commune's draw stands: `/draw`.
 *
 * The transparency page. It answers "has my commune drawn yet?" without
 * answering anything else — there is no applicant count on it, no eligible
 * list, no pool, no entry, no weight and no random value, because the endpoint
 * behind it carries none of those. What it shows is a commune, its allocated
 * places, which phase it is in, and whether its result has been announced.
 *
 * `winnerCount` is null rather than zero until publication, and is rendered as
 * "not yet announced" rather than as a number, so a commune that has drawn
 * cannot be distinguished from one that has drawn and had nobody win.
 */
export function Draw() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const [filters, setFilters] = useState<PublicFilterValues>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  const { data, isLoading, error, refetch } = usePublicDrawStatus(toQueryFilters(filters), page)

  const changeFilters = (next: PublicFilterValues) => {
    setFilters(next)
    setPage(1)
  }

  const columns = [
    {
      key: 'drawYear',
      header: t('public.results.drawYear'),
      render: (row: PublicDrawStatusDto) => formatYear(row.drawYear, locale),
    },
    {
      key: 'wilaya',
      header: t('geo.wilaya.label'),
      render: (row: PublicDrawStatusDto) => localizedGeoName(row.wilaya, locale),
    },
    {
      key: 'commune',
      header: t('geo.commune.label'),
      render: (row: PublicDrawStatusDto) => (
        // Codes, not ids — the same address the results pages use.
        <Link
          className="font-medium text-primary-800 underline underline-offset-2 hover:text-primary-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
          to={`/draw/${row.drawYear}/${row.wilaya.code}/${row.commune.code}`}
        >
          {localizedGeoName(row.commune, locale)}
        </Link>
      ),
    },
    {
      key: 'allocatedSpots',
      header: t('public.results.allocatedSpots'),
      render: (row: PublicDrawStatusDto) => formatNumber(row.allocatedSpots, locale),
    },
    {
      key: 'phase',
      header: t('public.drawStatus.phase'),
      render: (row: PublicDrawStatusDto) => <DrawPhaseBadge phase={row.phase} />,
    },
    {
      key: 'results',
      header: t('public.results.winnerCount'),
      render: (row: PublicDrawStatusDto) =>
        row.resultsPublished && row.winnerCount !== null ? (
          formatNumber(row.winnerCount, locale)
        ) : (
          <Badge variant="warning">{t('public.drawStatus.resultsPending')}</Badge>
        ),
    },
  ]

  return (
    <div>
      <PageHeader title={t('public.drawStatus.title')} description={t('public.drawStatus.intro')} />

      <PublicFilterBar value={filters} onChange={changeFilters} disabled={isLoading} />

      {error ? (
        <ErrorState title={publicErrorMessage(error, t)} retryLabel={t('common.retry')} onRetry={refetch} />
      ) : isLoading ? (
        <Loading label={t('common.loading')} />
      ) : data && data.items.length === 0 ? (
        <EmptyState title={t('public.drawStatus.empty')} description={t('public.drawStatus.emptyHint')} />
      ) : (
        data && (
          <div className="flex flex-col gap-6">
            <Table
              columns={columns}
              rows={data.items}
              getRowKey={(row) => `${row.drawYear}-${row.wilaya.code}-${row.commune.code}`}
              emptyMessage={t('public.drawStatus.empty')}
            />
            {/* `total`, not i18next's reserved `count` — see Winners.tsx. */}
            <p className="text-sm text-stone-600">
              {t('public.drawStatus.total', { total: formatNumber(data.total, locale) })}
            </p>
            {data.totalPages > 1 && (
              <Pagination page={data.page} totalPages={data.totalPages} onPageChange={setPage} />
            )}
          </div>
        )
      )}
    </div>
  )
}
