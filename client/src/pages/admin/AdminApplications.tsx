import {
  APPLICATION_STATUSES,
  ENTRY_TYPES,
  localizedGeoName,
  type AdminApplicationSummaryDto,
  type ApplicationStatus,
  type EntryType,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AdminPage, TablePager } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { PlacePicker } from '@/components/admin/PlacePicker'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Button } from '@/components/shadcn/button'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { fetchApplications } from '@/lib/admin-api'
import { formatDate, formatNumber, formatYear } from '@/lib/format'
import { mapAsync, useAsync, useDebounced } from '@/lib/use-async'

/** Sentinel for "no filter" — a Select item cannot carry an empty value. */
const ANY = '__any__'

interface Filters {
  wilayaId: string | undefined
  communeId: string | undefined
  status: ApplicationStatus | undefined
  entryType: EntryType | undefined
  reference: string
  page: number
}

const INITIAL: Filters = {
  wilayaId: undefined,
  communeId: undefined,
  status: undefined,
  entryType: undefined,
  reference: '',
  page: 1,
}

/**
 * The applications table.
 *
 * Filtering and paging happen on the server. Fetching every application and
 * narrowing it here would put a whole wilaya's records in a browser to show
 * twenty-five of them, and the geographic ceiling would then be a decision
 * this page made rather than one the query enforced.
 *
 * The reference box is matched exactly by the API — it is a lookup, not a
 * search. A receipt is deliberately unguessable, and a prefix search over
 * receipts would undo that.
 */
export function AdminApplications() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [filters, setFilters] = useState<Filters>(INITIAL)

  // Typing a reference must not fire a request per keystroke.
  const reference = useDebounced(filters.reference)

  const load = useCallback(
    () =>
      fetchApplications({
        wilayaId: filters.wilayaId,
        communeId: filters.communeId,
        status: filters.status,
        entryType: filters.entryType,
        applicationReference: reference.trim() || undefined,
        page: filters.page,
      }),
    [filters.wilayaId, filters.communeId, filters.status, filters.entryType, reference, filters.page],
  )

  const { state, reload } = useAsync(load)

  // Any change to what is being asked for returns to the first page: page 3 of
  // the previous filter is not page 3 of this one.
  const narrow = (change: Partial<Filters>) => setFilters((current) => ({ ...current, ...change, page: 1 }))

  const rows: Column<AdminApplicationSummaryDto>[] = [
    {
      key: 'reference',
      header: t('admin.applications.reference'),
      render: (row) => (
        <Link
          to={`/admin/applications/${row.id}`}
          className="font-mono text-sm tracking-wider text-primary underline-offset-4 hover:underline"
        >
          {row.applicationReference}
        </Link>
      ),
    },
    {
      key: 'year',
      header: t('admin.applications.drawYear'),
      render: (row) => formatYear(row.drawYear, locale),
    },
    {
      key: 'place',
      header: t('geo.commune.label'),
      render: (row) => (
        <span className="whitespace-nowrap">
          {localizedGeoName(row.commune, locale)}
          <span className="block text-xs text-muted-foreground">{localizedGeoName(row.wilaya, locale)}</span>
        </span>
      ),
    },
    {
      key: 'entryType',
      header: t('admin.applications.entryType'),
      render: (row) => t(`admin.entryType.${row.entryType}`),
    },
    {
      key: 'participants',
      header: t('admin.applications.participants'),
      numeric: true,
      render: (row) => formatNumber(row.participantCount, locale),
    },
    {
      key: 'weight',
      header: t('admin.applications.weight'),
      numeric: true,
      render: (row) =>
        row.calculatedWeight === null ? (
          <span className="text-muted-foreground">{t('admin.applications.notFrozen')}</span>
        ) : (
          formatNumber(row.calculatedWeight, locale)
        ),
    },
    {
      key: 'status',
      header: t('admin.applications.status'),
      render: (row) => <StatusBadge kind="application" status={row.status} />,
    },
    {
      key: 'createdAt',
      header: t('admin.applications.submitted'),
      render: (row) => formatDate(row.createdAt, locale),
    },
  ]

  const page = state.status === 'ready' ? state.data : undefined

  return (
    <AdminPage title={t('admin.pages.applications.title')} description={t('admin.applications.description')}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <PlacePicker
          wilayaId={filters.wilayaId}
          communeId={filters.communeId}
          onChange={(next) => narrow(next)}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">{t('admin.applications.status')}</Label>
          <Select
            value={filters.status ?? ANY}
            onValueChange={(value) =>
              narrow({ status: value === ANY ? undefined : (value as ApplicationStatus) })
            }
          >
            <SelectTrigger id="filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.filters.anyStatus')}</SelectItem>
              {APPLICATION_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`admin.status.application.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-entry-type">{t('admin.applications.entryType')}</Label>
          <Select
            value={filters.entryType ?? ANY}
            onValueChange={(value) => narrow({ entryType: value === ANY ? undefined : (value as EntryType) })}
          >
            <SelectTrigger id="filter-entry-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.filters.anyEntryType')}</SelectItem>
              {ENTRY_TYPES.map((entryType) => (
                <SelectItem key={entryType} value={entryType}>
                  {t(`admin.entryType.${entryType}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-reference">{t('admin.applications.reference')}</Label>
          <Input
            id="filter-reference"
            value={filters.reference}
            placeholder={t('admin.applications.referencePlaceholder')}
            autoComplete="off"
            onChange={(event) => narrow({ reference: event.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {page ? t('admin.applications.total', { total: formatNumber(page.total, locale) }) : ' '}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(INITIAL)}>
          {t('admin.filters.clear')}
        </Button>
      </div>

      <DataTable
        state={mapAsync(state, (result) => result.items)}
        columns={rows}
        getRowKey={(row) => row.id}
        label={t('admin.applications.tableLabel')}
        emptyMessage={t('admin.applications.empty')}
        onRetry={reload}
      />

      {page && (
        <TablePager
          page={page.page}
          totalPages={page.totalPages}
          onPageChange={(next) => setFilters((current) => ({ ...current, page: next }))}
        />
      )}
    </AdminPage>
  )
}
