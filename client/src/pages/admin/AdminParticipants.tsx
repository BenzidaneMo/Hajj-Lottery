import {
  NATIONAL_ID_LENGTH,
  limitToDigits,
  type AdminParticipantSummaryDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AdminPage, TablePager } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { fetchParticipants } from '@/lib/admin-api'
import { formatDate, formatNumber } from '@/lib/format'
import { mapAsync, useAsync, useDebounced } from '@/lib/use-async'

interface Filters {
  name: string
  nationalId: string
  page: number
}

const INITIAL: Filters = { name: '', nationalId: '', page: 1 }

/**
 * The national identity registry. SUPER_ADMIN only, enforced at the route.
 *
 * A participant belongs to no commune, so there is no geographic filter that
 * could narrow this — which is why a scoped administrator has no version of
 * this screen at all, and reaches a person through their own commune's
 * applications or ledger instead.
 *
 * Two rules about the national ID, both of which the server also enforces.
 * It is only ever matched whole — a prefix search would answer "which IDs
 * exist?" one digit at a time. And it never reaches a route: this page has no
 * `/participants/:nationalId` address, so an ID cannot end up in browser
 * history, a bookmark, a referrer header or a screen-share of the address bar.
 */
export function AdminParticipants() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [filters, setFilters] = useState<Filters>(INITIAL)

  const name = useDebounced(filters.name)
  const nationalId = useDebounced(filters.nationalId)

  // Sent only when whole; a partial entry filters nothing rather than
  // returning everything that starts with it.
  const completeNationalId = nationalId.length === NATIONAL_ID_LENGTH ? nationalId : undefined
  const usableName = name.trim().length >= 2 ? name.trim() : undefined

  const load = useCallback(
    () => fetchParticipants({ name: usableName, nationalId: completeNationalId, page: filters.page }),
    [usableName, completeNationalId, filters.page],
  )
  const { state, reload } = useAsync(load)

  const columns: Column<AdminParticipantSummaryDto>[] = [
    { key: 'name', header: t('admin.participants.fullName'), render: (row) => row.fullName },
    {
      key: 'nationalId',
      header: t('admin.participants.nationalId'),
      render: (row) => <span className="font-mono text-sm">{row.nationalId}</span>,
    },
    {
      key: 'dob',
      header: t('admin.participants.dob'),
      render: (row) => formatDate(row.dob, locale),
    },
    {
      key: 'phone',
      header: t('admin.participants.phone'),
      render: (row) => <span className="font-mono text-sm">{row.phoneNumber ?? '—'}</span>,
    },
    {
      key: 'hasWonHajj',
      header: t('admin.participants.hasWonHajj'),
      render: (row) =>
        row.hasWonHajj ? (
          <Badge variant="warning">{t('admin.participants.pastWinner')}</Badge>
        ) : (
          <Badge variant="outline">{t('admin.participants.noPastWin')}</Badge>
        ),
    },
    {
      key: 'history',
      header: t('admin.participants.history'),
      render: (row) => (
        <Link
          to={`/admin/history?participantId=${encodeURIComponent(row.id)}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t('admin.participants.viewHistory')}
        </Link>
      ),
    },
  ]

  const page = state.status === 'ready' ? state.data : undefined

  return (
    <AdminPage title={t('admin.pages.participants.title')} description={t('admin.participants.description')}>
      <Alert>
        <AlertTitle>{t('admin.participants.privacyTitle')}</AlertTitle>
        <AlertDescription>{t('admin.participants.privacyBody')}</AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="participant-name">{t('admin.participants.fullName')}</Label>
          <Input
            id="participant-name"
            value={filters.name}
            autoComplete="off"
            placeholder={t('admin.participants.namePlaceholder')}
            onChange={(event) => setFilters((f) => ({ ...f, name: event.target.value, page: 1 }))}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="participant-national-id">{t('admin.participants.nationalId')}</Label>
          <Input
            id="participant-national-id"
            value={filters.nationalId}
            inputMode="numeric"
            autoComplete="off"
            className="font-mono"
            aria-describedby="participant-national-id-hint"
            placeholder={t('admin.participants.nationalIdPlaceholder')}
            // Folds Arabic-Indic digits and caps the length as the operator
            // types, by the same rules the server will apply.
            onChange={(event) =>
              setFilters((f) => ({
                ...f,
                nationalId: limitToDigits(event.target.value, NATIONAL_ID_LENGTH),
                page: 1,
              }))
            }
          />
          <p id="participant-national-id-hint" className="text-xs text-muted-foreground">
            {t('admin.participants.nationalIdHint', { length: NATIONAL_ID_LENGTH })}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {page ? t('admin.participants.total', { total: formatNumber(page.total, locale) }) : ' '}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(INITIAL)}>
          {t('admin.filters.clear')}
        </Button>
      </div>

      <DataTable
        state={mapAsync(state, (result) => result.items)}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.participants.tableLabel')}
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
