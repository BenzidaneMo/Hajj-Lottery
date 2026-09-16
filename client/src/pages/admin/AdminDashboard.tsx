import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import {
  ArmchairIcon,
  CalendarDaysIcon,
  CalendarOffIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  FileSpreadsheetIcon,
  LockIcon,
  PhoneCallIcon,
  ShieldCheckIcon,
  TrophyIcon,
  UserMinusIcon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AdminPage, Metric } from '@/components/admin/AdminPage'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { Separator } from '@/components/shadcn/separator'
import { fetchDashboard } from '@/lib/admin-api'
import { formatNumber, formatYear } from '@/lib/format'
import { useAsync } from '@/lib/use-async'

/**
 * What needs attention, in this administrator's territory.
 *
 * Every number here answers an operational question — how many draws are still
 * unfrozen, how many results are waiting to be announced, how many reserves
 * have been called and not yet answered. There are no totals for their own
 * sake and no charts: on a screen an operator opens to decide what to do next,
 * decoration competes with the figures that decide it.
 *
 * The counts arrive already scoped. A WILAYA_ADMIN's page is not the national
 * page with rows removed — the server counted only their wilaya, so there is
 * no national figure in the response to leak.
 */
export function AdminDashboard() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const load = useCallback(() => fetchDashboard(), [])
  const { state, reload } = useAsync(load)

  const loading = state.status === 'loading'
  const data = state.status === 'ready' ? state.data : undefined
  const counts = data?.counts
  const number = (value: number | undefined) => (value === undefined ? '—' : formatNumber(value, locale))

  const place = data?.commune ?? data?.wilaya
  const scopeLabel = data
    ? place
      ? localizedGeoName(place, locale)
      : t('admin.dashboard.scope.national')
    : undefined

  if (state.status === 'error') {
    return (
      <AdminPage title={t('admin.pages.dashboard.title')}>
        <ErrorNotice error={state.error} onRetry={reload} />
      </AdminPage>
    )
  }

  return (
    <AdminPage
      title={t('admin.pages.dashboard.title')}
      description={scopeLabel ? t('admin.dashboard.subtitle', { scope: scopeLabel }) : undefined}
    >
      {data && !data.drawYear && (
        <Alert>
          <CalendarOffIcon aria-hidden="true" />
          <AlertTitle>{t('admin.dashboard.noDrawYear')}</AlertTitle>
          <AlertDescription>{t('admin.dashboard.noDrawYearHint')}</AlertDescription>
        </Alert>
      )}

      {data?.drawYear && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDaysIcon className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('admin.dashboard.activeYear')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">
              {formatYear(data.drawYear.year, locale)}
            </span>
            <StatusBadge kind="drawYear" status={data.drawYear.status} />
            <Separator orientation="vertical" className="hidden h-6 sm:block" />
            <p className="text-sm text-muted-foreground">{t('admin.dashboard.activeYearHint')}</p>
            <Button asChild variant="outline" size="sm" className="ms-auto">
              <Link to="/admin/draws">{t('admin.dashboard.manageYears')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="dashboard-registration">
        <h2
          id="dashboard-registration"
          className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <ClipboardListIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('admin.dashboard.sections.registration')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t('admin.dashboard.metrics.applications')}
            value={number(counts?.applications)}
            hint={t('admin.dashboard.metrics.applicationsHint')}
            loading={loading}
            icon={ClipboardListIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.eligible')}
            value={number(counts?.eligibleApplications)}
            hint={t('admin.dashboard.metrics.eligibleHint')}
            loading={loading}
            icon={CheckCircle2Icon}
          />
          <Metric
            label={t('admin.dashboard.metrics.ineligible')}
            value={number(counts?.ineligibleApplications)}
            hint={t('admin.dashboard.metrics.ineligibleHint')}
            loading={loading}
            icon={XCircleIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.allocatedSpots')}
            value={number(counts?.allocatedSpots)}
            hint={t('admin.dashboard.metrics.allocatedSpotsHint')}
            loading={loading}
            icon={ArmchairIcon}
          />
        </div>
      </section>

      <section aria-labelledby="dashboard-draws">
        <h2
          id="dashboard-draws"
          className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <ClipboardCheckIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('admin.dashboard.sections.draws')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t('admin.dashboard.metrics.communeDraws')}
            value={number(counts?.communeDraws)}
            hint={t('admin.dashboard.metrics.communeDrawsHint')}
            loading={loading}
            icon={ClipboardCheckIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.readyDraws')}
            value={number(counts?.readyDraws)}
            hint={t('admin.dashboard.metrics.readyDrawsHint')}
            loading={loading}
            icon={ClockIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.lockedDraws')}
            value={number(counts?.lockedDraws)}
            hint={t('admin.dashboard.metrics.lockedDrawsHint')}
            loading={loading}
            icon={LockIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.completedDraws')}
            value={number(counts?.completedDraws)}
            hint={t('admin.dashboard.metrics.completedDrawsHint')}
            loading={loading}
            icon={CheckCircle2Icon}
          />
        </div>
      </section>

      <section aria-labelledby="dashboard-results">
        <h2
          id="dashboard-results"
          className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <TrophyIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t('admin.dashboard.sections.results')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t('admin.dashboard.metrics.unpublished')}
            value={number(counts?.unpublishedResults)}
            hint={t('admin.dashboard.metrics.unpublishedHint')}
            loading={loading}
            icon={EyeOffIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.published')}
            value={number(counts?.publishedResults)}
            hint={t('admin.dashboard.metrics.publishedHint')}
            loading={loading}
            icon={EyeIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.withdrawn')}
            value={number(counts?.withdrawnWinners)}
            hint={t('admin.dashboard.metrics.withdrawnHint')}
            loading={loading}
            icon={UserMinusIcon}
          />
          <Metric
            label={t('admin.dashboard.metrics.reservesCalled')}
            value={number(counts?.reservesAwaitingDecision)}
            hint={t('admin.dashboard.metrics.reservesCalledHint')}
            loading={loading}
            icon={PhoneCallIcon}
          />
        </div>
      </section>

      {/* Withheld from scoped administrators by the server, not by this
          condition: `governance` is null in their response, so there is no
          national figure here to hide. */}
      {data?.governance && (
        <section aria-labelledby="dashboard-governance">
          <h2
            id="dashboard-governance"
            className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"
          >
            <ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {t('admin.dashboard.sections.governance')}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric
              label={t('admin.dashboard.metrics.pendingImports')}
              value={formatNumber(data.governance.pendingImports, locale)}
              hint={t('admin.dashboard.metrics.pendingImportsHint')}
              icon={FileSpreadsheetIcon}
            />
            <Metric
              label={t('admin.dashboard.metrics.pendingApprovals')}
              value={formatNumber(data.governance.pendingApprovals, locale)}
              hint={t('admin.dashboard.metrics.pendingApprovalsHint')}
              icon={ShieldCheckIcon}
            />
          </div>
        </section>
      )}
    </AdminPage>
  )
}
