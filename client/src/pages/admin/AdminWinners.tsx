import {
  localizedGeoName,
  type CommuneDrawDto,
  type DrawYearDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AdminPage } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { fetchCommuneDraws, fetchDrawYears } from '@/lib/admin-api'
import { formatNumber, formatYear } from '@/lib/format'
import { mapAsync, useAsync } from '@/lib/use-async'

/**
 * Concluded draws, and what still needs announcing.
 *
 * A results index rather than a second copy of the result: the winners,
 * reserves and their lifecycle all live on one commune's operations page,
 * which is the only place any of it can be acted on. This screen answers the
 * question that spans communes — which draws have run, and which of them are
 * still waiting on a publication decision.
 *
 * Winner names are deliberately absent, here as everywhere. Publishing them is
 * an open policy decision, not an omission.
 */
export function AdminWinners() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [drawYearId, setDrawYearId] = useState<string | undefined>(undefined)

  const loadYears = useCallback(() => fetchDrawYears(), [])
  const years = useAsync(loadYears)

  const loadDraws = useCallback(() => fetchCommuneDraws({ drawYearId }), [drawYearId])
  const { state, reload } = useAsync(loadDraws)

  const columns: Column<CommuneDrawDto>[] = [
    {
      key: 'commune',
      header: t('geo.commune.label'),
      render: (row) => (
        <Link
          to={`/admin/communes/${row.id}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {localizedGeoName(row.commune, locale)}
        </Link>
      ),
    },
    { key: 'wilaya', header: t('geo.wilaya.label'), render: (row) => localizedGeoName(row.wilaya, locale) },
    { key: 'year', header: t('admin.draws.year'), render: (row) => formatYear(row.drawYear, locale) },
    {
      key: 'spots',
      header: t('admin.communeDraws.allocatedSpots'),
      numeric: true,
      render: (row) => formatNumber(row.allocatedSpots, locale),
    },
    {
      key: 'status',
      header: t('admin.communeDraws.status'),
      render: (row) => <StatusBadge kind="communeDraw" status={row.status} />,
    },
  ]

  return (
    <AdminPage title={t('admin.pages.winners.title')} description={t('admin.winners.description')}>
      <Alert>
        <AlertTitle>{t('admin.winners.noticeTitle')}</AlertTitle>
        <AlertDescription>{t('admin.winners.noticeBody')}</AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:max-w-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="winners-year">{t('admin.draws.year')}</Label>
          <Select
            value={drawYearId ?? '__any__'}
            onValueChange={(value) => setDrawYearId(value === '__any__' ? undefined : value)}
          >
            <SelectTrigger id="winners-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{t('admin.filters.anyYear')}</SelectItem>
              {(years.state.status === 'ready' ? years.state.data : ([] as DrawYearDto[])).map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {formatYear(year.year, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        state={mapAsync(state, (rows) => rows.filter((row) => row.status === 'COMPLETED'))}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.winners.tableLabel')}
        emptyMessage={t('admin.winners.empty')}
        onRetry={reload}
        rowActions={(row) => (
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/communes/${row.id}`}>{t('admin.winners.openResult')}</Link>
          </Button>
        )}
      />
    </AdminPage>
  )
}
