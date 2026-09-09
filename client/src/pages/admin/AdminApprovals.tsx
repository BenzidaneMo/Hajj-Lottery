import {
  APPROVAL_STATUSES,
  type ApprovalRequestDto,
  type ApprovalStatus,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { FactList, ReasonDialog } from '@/components/admin/dialogs'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/shadcn/sheet'
import { approveRequest, cancelRequest, fetchApprovals, rejectRequest } from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime } from '@/lib/format'
import { mapAsync, useAction, useAsync } from '@/lib/use-async'

type Decision = 'approve' | 'reject' | 'cancel'

/**
 * Requests waiting on somebody else's decision.
 *
 * Approving *is* applying, in one transaction: there is no state where a
 * request is approved but the change has not happened. Which is also why a
 * decision is made once — `PENDING` moves to a decided status and a trigger
 * refuses any move back. A changed mind is a new request, not an edited one.
 *
 * Nobody reviews their own request. This screen hides the decision buttons
 * from the author, the service refuses it, and a CHECK constraint refuses it
 * again — three layers, of which only the last two are protection.
 */
export function AdminApprovals() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [status, setStatus] = useState<ApprovalStatus | undefined>('PENDING')
  const [viewing, setViewing] = useState<ApprovalRequestDto | undefined>(undefined)
  const [deciding, setDeciding] = useState<{ request: ApprovalRequestDto; decision: Decision } | undefined>()

  const load = useCallback(() => fetchApprovals(status), [status])
  const { state, reload } = useAsync(load)

  const approveAction = useAction(approveRequest)
  const rejectAction = useAction(rejectRequest)
  const cancelAction = useAction(cancelRequest)

  const columns: Column<ApprovalRequestDto>[] = [
    {
      key: 'type',
      header: t('admin.approvals.type'),
      render: (row) => <Badge variant="outline">{t(`admin.approvalType.${row.type}`)}</Badge>,
    },
    {
      key: 'requestedBy',
      header: t('admin.approvals.requestedBy'),
      render: (row) => row.requestedBy.username,
    },
    {
      key: 'target',
      header: t('admin.approvals.target'),
      render: (row) => (
        <span className="text-sm">
          {t(`admin.targetType.${row.targetType}`)}
          <span className="block font-mono text-xs text-muted-foreground">{row.targetId}</span>
        </span>
      ),
    },
    {
      key: 'place',
      header: t('admin.approvals.scope'),
      render: (row) => row.communeCode ?? row.wilayaCode ?? t('admin.profile.scope.national'),
    },
    { key: 'reason', header: t('admin.approvals.reason'), render: (row) => row.reason },
    {
      key: 'status',
      header: t('admin.approvals.status'),
      render: (row) => <StatusBadge kind="approval" status={row.status} />,
    },
    {
      key: 'createdAt',
      header: t('admin.approvals.createdAt'),
      render: (row) => formatDateTime(row.createdAt, locale),
    },
  ]

  return (
    <AdminPage title={t('admin.pages.approvals.title')} description={t('admin.approvals.description')}>
      <div className="grid gap-4 sm:max-w-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="approval-status">{t('admin.approvals.status')}</Label>
          <Select
            value={status ?? '__any__'}
            onValueChange={(value) => setStatus(value === '__any__' ? undefined : (value as ApprovalStatus))}
          >
            <SelectTrigger id="approval-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{t('admin.filters.anyStatus')}</SelectItem>
              {APPROVAL_STATUSES.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`admin.status.approval.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        state={mapAsync(state, (result) => result.items)}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.approvals.tableLabel')}
        emptyMessage={t('admin.approvals.empty')}
        onRetry={reload}
        rowActions={(row) => {
          const isAuthor = row.requestedBy.id === user?.id
          const pending = row.status === 'PENDING'
          return (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(row)}>
                {t('admin.approvals.view')}
              </Button>
              {/* Self-review is refused by the service and by a CHECK
                  constraint; not offering it is only a courtesy. */}
              {pending && isSuperAdmin && !isAuthor && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setDeciding({ request: row, decision: 'approve' })}
                  >
                    {t('admin.approvals.approve')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDeciding({ request: row, decision: 'reject' })}
                  >
                    {t('admin.approvals.reject')}
                  </Button>
                </>
              )}
              {pending && isAuthor && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDeciding({ request: row, decision: 'cancel' })}
                >
                  {t('admin.approvals.cancel')}
                </Button>
              )}
            </div>
          )
        }}
      />

      <Sheet open={viewing !== undefined} onOpenChange={(open) => !open && setViewing(undefined)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('admin.approvals.detailTitle')}</SheetTitle>
            <SheetDescription>{viewing ? t(`admin.approvalType.${viewing.type}`) : null}</SheetDescription>
          </SheetHeader>
          {viewing && (
            <div className="flex flex-col gap-4 p-4 pt-0">
              <FactList
                facts={[
                  {
                    label: t('admin.approvals.status'),
                    value: <StatusBadge kind="approval" status={viewing.status} />,
                  },
                  { label: t('admin.approvals.requestedBy'), value: viewing.requestedBy.username },
                  { label: t('admin.approvals.reviewedBy'), value: viewing.reviewedBy?.username ?? '—' },
                  {
                    label: t('admin.approvals.createdAt'),
                    value: formatDateTime(viewing.createdAt, locale),
                  },
                  {
                    label: t('admin.approvals.reviewedAt'),
                    value: viewing.reviewedAt ? formatDateTime(viewing.reviewedAt, locale) : '—',
                  },
                ]}
              />
              <div>
                <h3 className="mb-1 text-sm font-semibold">{t('admin.approvals.reason')}</h3>
                <p className="text-sm text-muted-foreground">{viewing.reason}</p>
              </div>
              {viewing.reviewReason && (
                <div>
                  <h3 className="mb-1 text-sm font-semibold">{t('admin.approvals.reviewReason')}</h3>
                  <p className="text-sm text-muted-foreground">{viewing.reviewReason}</p>
                </div>
              )}
              <div>
                <h3 className="mb-1 text-sm font-semibold">{t('admin.approvals.requestedChange')}</h3>
                <dl className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  {Object.entries(viewing.requestedChange).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-4 py-0.5">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="font-medium">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {deciding && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setDeciding(undefined)}
          title={t(`admin.approvals.${deciding.decision}Title`)}
          description={t(`admin.approvals.${deciding.decision}Body`)}
          facts={[
            { label: t('admin.approvals.type'), value: t(`admin.approvalType.${deciding.request.type}`) },
            { label: t('admin.approvals.requestedBy'), value: deciding.request.requestedBy.username },
          ]}
          reasonLabel={t('admin.approvals.decisionReason')}
          submitLabel={t(`admin.approvals.${deciding.decision}`)}
          destructive={deciding.decision !== 'approve'}
          pending={approveAction.pending || rejectAction.pending || cancelAction.pending}
          error={approveAction.error ?? rejectAction.error ?? cancelAction.error}
          onSubmit={async (reason) => {
            const id = deciding.request.id
            const done =
              deciding.decision === 'approve'
                ? await approveAction.run(id, reason)
                : deciding.decision === 'reject'
                  ? await rejectAction.run(id, reason)
                  : await cancelAction.run(id, reason)
            if (done) {
              toast.success(t('admin.approvals.decided'))
              setDeciding(undefined)
              reload()
            }
          }}
        />
      )}
    </AdminPage>
  )
}
