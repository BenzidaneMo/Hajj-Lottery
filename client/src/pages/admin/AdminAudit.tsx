import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  type AuditAction,
  type AuditLogDto,
  type AuditTargetType,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminPage, TablePager } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { FactList } from '@/components/admin/dialogs'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/shadcn/sheet'
import { fetchAuditLogs } from '@/lib/admin-api'
import { formatDateTime } from '@/lib/format'
import { mapAsync, useAsync } from '@/lib/use-async'

const ANY = '__any__'

interface Filters {
  action: AuditAction | undefined
  targetType: AuditTargetType | undefined
  from: string
  to: string
  page: number
}

const INITIAL: Filters = {
  action: undefined,
  targetType: undefined,
  from: '',
  to: '',
  page: 1,
}

/**
 * The trail: what somebody did, and when.
 *
 * Read-only, and there is no other kind. An audit record says what happened,
 * which never stops being what happened — the table is append-only by database
 * trigger, there is no route that writes it, and there are deliberately no
 * edit, delete or "clear" controls anywhere on this screen.
 *
 * What a scoped administrator sees is narrowed by the query, and unlike
 * everywhere else in the system, national events with no territory are
 * withheld from them entirely rather than shown to everyone.
 *
 * The payloads are safe to render because the server refuses to store an
 * unsafe one: `assertSafePayload` throws on any key that looks like a national
 * ID, phone, password, token, secret or date of birth, nested included. This
 * screen therefore does not have to mask anything — there is nothing here that
 * was masked, only things that were never written.
 */
export function AdminAudit() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [filters, setFilters] = useState<Filters>(INITIAL)
  const [viewing, setViewing] = useState<AuditLogDto | undefined>(undefined)

  const load = useCallback(
    () =>
      fetchAuditLogs({
        action: filters.action,
        targetType: filters.targetType,
        from: filters.from || undefined,
        to: filters.to || undefined,
        page: filters.page,
      }),
    [filters.action, filters.targetType, filters.from, filters.to, filters.page],
  )

  const { state, reload } = useAsync(load)

  const narrow = (change: Partial<Filters>) => setFilters((current) => ({ ...current, ...change, page: 1 }))

  const columns: Column<AuditLogDto>[] = [
    {
      key: 'createdAt',
      header: t('admin.audit.timestamp'),
      render: (row) => <span className="whitespace-nowrap">{formatDateTime(row.createdAt, locale)}</span>,
    },
    {
      key: 'action',
      header: t('admin.audit.action'),
      render: (row) => (
        <Badge variant="outline">{t(`admin.auditAction.${row.action}`, { defaultValue: row.action })}</Badge>
      ),
    },
    {
      key: 'actor',
      header: t('admin.audit.actor'),
      // A null actor is not missing data — a bootstrap and a failed login both
      // record no actor on purpose.
      render: (row) => row.actor?.username ?? t('admin.audit.noActor'),
    },
    {
      key: 'target',
      header: t('admin.audit.target'),
      render: (row) => (
        <span className="text-sm">
          {t(`admin.targetType.${row.targetType}`)}
          {row.targetId && (
            <span className="block font-mono text-xs text-muted-foreground">{row.targetId}</span>
          )}
        </span>
      ),
    },
    {
      key: 'scope',
      header: t('admin.audit.scope'),
      render: (row) => row.communeCode ?? row.wilayaCode ?? t('admin.profile.scope.national'),
    },
    { key: 'reason', header: t('admin.audit.reason'), render: (row) => row.reason ?? '—' },
  ]

  const page = state.status === 'ready' ? state.data : undefined

  return (
    <AdminPage title={t('admin.pages.audit.title')} description={t('admin.audit.description')}>
      <Alert>
        <AlertTitle>{t('admin.audit.appendOnlyTitle')}</AlertTitle>
        <AlertDescription>{t('admin.audit.appendOnlyBody')}</AlertDescription>
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-action">{t('admin.audit.action')}</Label>
          <Select
            value={filters.action ?? ANY}
            onValueChange={(value) => narrow({ action: value === ANY ? undefined : (value as AuditAction) })}
          >
            <SelectTrigger id="audit-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.filters.anyAction')}</SelectItem>
              {AUDIT_ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {t(`admin.auditAction.${action}`, { defaultValue: action })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-target-type">{t('admin.audit.target')}</Label>
          <Select
            value={filters.targetType ?? ANY}
            onValueChange={(value) =>
              narrow({ targetType: value === ANY ? undefined : (value as AuditTargetType) })
            }
          >
            <SelectTrigger id="audit-target-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{t('admin.filters.anyTarget')}</SelectItem>
              {AUDIT_TARGET_TYPES.map((target) => (
                <SelectItem key={target} value={target}>
                  {t(`admin.targetType.${target}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/*
          Native date inputs rather than a calendar widget. They are already
          localised and keyboard-operable by the browser, they read correctly
          under RTL, and they save pulling in a date-picker library plus its
          locale data to pick two days.
        */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-from">{t('admin.audit.from')}</Label>
          <Input
            id="audit-from"
            type="date"
            value={filters.from}
            onChange={(event) => narrow({ from: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-to">{t('admin.audit.to')}</Label>
          <Input
            id="audit-to"
            type="date"
            value={filters.to}
            onChange={(event) => narrow({ to: event.target.value })}
          />
        </div>
      </div>

      <div className="flex items-center justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={() => setFilters(INITIAL)}>
          {t('admin.filters.clear')}
        </Button>
      </div>

      <DataTable
        state={mapAsync(state, (result) => result.items)}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.audit.tableLabel')}
        emptyMessage={t('admin.audit.empty')}
        onRetry={reload}
        rowActions={(row) => (
          <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(row)}>
            {t('admin.audit.view')}
          </Button>
        )}
      />

      {page && (
        <TablePager
          page={page.page}
          totalPages={page.totalPages}
          onPageChange={(next) => setFilters((current) => ({ ...current, page: next }))}
        />
      )}

      <Sheet open={viewing !== undefined} onOpenChange={(open) => !open && setViewing(undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('admin.audit.detailTitle')}</SheetTitle>
            <SheetDescription>
              {viewing ? t(`admin.auditAction.${viewing.action}`, { defaultValue: viewing.action }) : null}
            </SheetDescription>
          </SheetHeader>
          {viewing && (
            <div className="flex flex-col gap-4 p-4 pt-0">
              <FactList
                facts={[
                  { label: t('admin.audit.timestamp'), value: formatDateTime(viewing.createdAt, locale) },
                  {
                    label: t('admin.audit.actor'),
                    value: viewing.actor?.username ?? t('admin.audit.noActor'),
                  },
                  { label: t('admin.audit.target'), value: t(`admin.targetType.${viewing.targetType}`) },
                  {
                    label: t('admin.audit.scope'),
                    value: viewing.communeCode ?? viewing.wilayaCode ?? t('admin.profile.scope.national'),
                  },
                ]}
              />
              {viewing.reason && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">{t('admin.audit.reason')}</h3>
                  <p className="text-sm text-muted-foreground">{viewing.reason}</p>
                </div>
              )}
              <PayloadBlock title={t('admin.audit.before')} payload={viewing.before} />
              <PayloadBlock title={t('admin.audit.after')} payload={viewing.after} />
              <PayloadBlock title={t('admin.audit.metadata')} payload={viewing.metadata} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AdminPage>
  )
}

/**
 * One recorded snapshot.
 *
 * Rendered key by key rather than as raw JSON, so a long value wraps instead
 * of pushing the panel sideways. Nothing is filtered out here: a payload that
 * reached the database has already been through `assertSafePayload`, which
 * refuses rather than masks — so anything present is something that was
 * allowed to be recorded.
 */
function PayloadBlock({ title, payload }: { title: string; payload: Record<string, unknown> | null }) {
  const { t } = useTranslation()
  if (!payload || Object.keys(payload).length === 0) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{t('admin.audit.noPayload')}</p>
      </div>
    )
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <dl className="rounded-md border border-border bg-muted/40 p-3 text-sm">
        {Object.entries(payload).map(([key, value]) => (
          <div key={key} className="flex flex-wrap justify-between gap-4 py-0.5">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="min-w-0 break-all font-medium">
              {value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
