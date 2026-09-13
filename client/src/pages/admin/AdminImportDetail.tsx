import { isImportWarning, type ImportRowDto, type SupportedLocale } from '@hajj-lottery/shared'
import { ArrowLeftIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage, TablePager } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { ConfirmDialog, FactList, ReasonDialog } from '@/components/admin/dialogs'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Skeleton } from '@/components/shadcn/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs'
import {
  approveImport,
  executeImport,
  fetchImportConflicts,
  fetchImportRows,
  fetchImportSummary,
  rejectImport,
} from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime, formatNumber } from '@/lib/format'
import { mapAsync, useAction, useAsync } from '@/lib/use-async'

/**
 * Reviewing one staged register, and deciding what happens to it.
 *
 * Nothing on this screen changes a participant, a historical record or
 * anybody's lifetime exclusion until execution. Approval is a decision;
 * execution is the single transaction that applies it, and it re-runs every
 * validation first because a real draw may have concluded in between.
 *
 * Conflicts are never resolved here. Each one is reported and blocks — an
 * identity mismatch or a second lifetime win is evidence that two sources
 * disagree, and preferring one silently would manufacture a fact nobody
 * checked.
 */
export function AdminImportDetail() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { id = '' } = useParams()
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const loadSummary = useCallback(() => fetchImportSummary(id), [id])
  const { state, reload } = useAsync(loadSummary)

  const [deciding, setDeciding] = useState<'approve' | 'reject' | undefined>(undefined)
  const [executingOpen, setExecutingOpen] = useState(false)

  const approveAction = useAction(approveImport)
  const rejectAction = useAction(rejectImport)
  const executeAction = useAction(executeImport)

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link to="/admin/imports">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t('admin.imports.backToList')}
      </Link>
    </Button>
  )

  if (state.status === 'error') {
    return (
      <AdminPage title={t('admin.imports.detailTitle')} action={back}>
        <ErrorNotice error={state.error} onRetry={reload} />
      </AdminPage>
    )
  }

  if (state.status === 'loading') {
    return (
      <AdminPage title={t('admin.imports.detailTitle')} action={back}>
        <Skeleton className="h-72 w-full" />
      </AdminPage>
    )
  }

  const summary = state.data
  const batch = summary.batch
  const awaitingDecision = batch.status === 'READY_FOR_REVIEW'
  const readyToExecute = batch.status === 'APPROVED'
  // The uploader may not decide their own batch — the service refuses it and a
  // CHECK constraint refuses it again. Hiding the button is only the courtesy.
  const isUploader = user?.id === batch.uploadedBy.id

  return (
    <AdminPage title={batch.sourceFilename} action={back}>
      <FactList
        facts={[
          {
            label: t('admin.imports.status'),
            value: <StatusBadge kind="importBatch" status={batch.status} />,
          },
          { label: t('admin.imports.format'), value: batch.sourceFormat },
          { label: t('admin.imports.rows'), value: formatNumber(batch.rowCount, locale) },
          { label: t('admin.imports.uploadedBy'), value: batch.uploadedBy.username },
          { label: t('admin.imports.uploadedAt'), value: formatDateTime(batch.createdAt, locale) },
          { label: t('admin.imports.approvedBy'), value: batch.approvedBy?.username ?? '—' },
        ]}
      />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('admin.imports.checksum')}</span>
        <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
          {batch.sourceChecksum}
        </code>
        <p className="text-xs text-muted-foreground">{t('admin.imports.checksumHint')}</p>
      </div>

      <section aria-labelledby="import-summary">
        <h2 id="import-summary" className="mb-3 text-sm font-semibold">
          {t('admin.imports.summaryTitle')}
        </h2>
        <FactList
          facts={[
            { label: t('admin.imports.valid'), value: formatNumber(summary.valid, locale) },
            { label: t('admin.imports.warnings'), value: formatNumber(summary.warnings, locale) },
            { label: t('admin.imports.conflicts'), value: formatNumber(summary.conflicts, locale) },
            { label: t('admin.imports.invalid'), value: formatNumber(summary.invalid, locale) },
            {
              label: t('admin.imports.newParticipants'),
              value: formatNumber(summary.newParticipants, locale),
            },
            {
              label: t('admin.imports.existingParticipants'),
              value: formatNumber(summary.existingParticipants, locale),
            },
            {
              label: t('admin.imports.historicalRecords'),
              value: formatNumber(summary.historicalRecords, locale),
            },
            { label: t('admin.imports.legacyWinners'), value: formatNumber(summary.winners, locale) },
          ]}
        />
      </section>

      <Alert variant={summary.importable ? 'default' : 'destructive'}>
        <AlertTitle>
          {summary.importable ? t('admin.imports.importableTitle') : t('admin.imports.blockedTitle')}
        </AlertTitle>
        <AlertDescription>
          {summary.importable ? t('admin.imports.importableBody') : t('admin.imports.blockedBody')}
        </AlertDescription>
      </Alert>

      {isSuperAdmin && (awaitingDecision || readyToExecute) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          {awaitingDecision && !isUploader && (
            <>
              <Button type="button" disabled={!summary.importable} onClick={() => setDeciding('approve')}>
                {t('admin.imports.approve')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDeciding('reject')}>
                {t('admin.imports.reject')}
              </Button>
              {!summary.importable && (
                <span className="text-sm text-muted-foreground">{t('admin.imports.cannotApprove')}</span>
              )}
            </>
          )}
          {awaitingDecision && isUploader && (
            <span className="text-sm text-muted-foreground">{t('admin.imports.notYourOwn')}</span>
          )}
          {readyToExecute && (
            <Button type="button" onClick={() => setExecutingOpen(true)}>
              {t('admin.imports.execute')}
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="conflicts">
        <TabsList>
          <TabsTrigger value="conflicts">{t('admin.imports.tabs.conflicts')}</TabsTrigger>
          <TabsTrigger value="rows">{t('admin.imports.tabs.rows')}</TabsTrigger>
        </TabsList>
        <TabsContent value="conflicts" className="pt-4">
          <RowTable batchId={id} conflictsOnly />
        </TabsContent>
        <TabsContent value="rows" className="pt-4">
          <RowTable batchId={id} conflictsOnly={false} />
        </TabsContent>
      </Tabs>

      {deciding && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setDeciding(undefined)}
          title={deciding === 'approve' ? t('admin.imports.approveTitle') : t('admin.imports.rejectTitle')}
          description={
            deciding === 'approve' ? t('admin.imports.approveBody') : t('admin.imports.rejectBody')
          }
          facts={[
            { label: t('admin.imports.filename'), value: batch.sourceFilename },
            { label: t('admin.imports.rows'), value: formatNumber(batch.rowCount, locale) },
          ]}
          reasonLabel={t('admin.imports.reason')}
          submitLabel={deciding === 'approve' ? t('admin.imports.approve') : t('admin.imports.reject')}
          destructive={deciding === 'reject'}
          pending={approveAction.pending || rejectAction.pending}
          error={approveAction.error ?? rejectAction.error}
          onSubmit={async (reason) => {
            const done =
              deciding === 'approve'
                ? await approveAction.run(id, reason)
                : await rejectAction.run(id, reason)
            if (done) {
              toast.success(t('admin.imports.decided'))
              setDeciding(undefined)
              reload()
            }
          }}
        />
      )}

      <ConfirmDialog
        open={executingOpen}
        onOpenChange={setExecutingOpen}
        title={t('admin.imports.executeTitle')}
        description={t('admin.imports.executeBody')}
        facts={[
          { label: t('admin.imports.filename'), value: batch.sourceFilename },
          {
            label: t('admin.imports.historicalRecords'),
            value: formatNumber(summary.historicalRecords, locale),
          },
          { label: t('admin.imports.legacyWinners'), value: formatNumber(summary.winners, locale) },
        ]}
        confirmLabel={t('admin.imports.execute')}
        destructive
        pending={executeAction.pending}
        error={executeAction.error}
        onConfirm={async () => {
          if (await executeAction.run(id)) {
            toast.success(t('admin.imports.executed'))
            setExecutingOpen(false)
            reload()
          }
        }}
      >
        <Alert variant="destructive">
          <AlertTitle>{t('admin.imports.executeWarningTitle')}</AlertTitle>
          {/* A legacy win is a lifetime exclusion, and there is no un-import. */}
          <AlertDescription>{t('admin.imports.executeWarningBody')}</AlertDescription>
        </Alert>
      </ConfirmDialog>
    </AdminPage>
  )
}

/**
 * Staged rows.
 *
 * The national ID is shown as its last four digits only — enough to match a
 * row against the paper register in front of the reviewer, and the most the
 * server will send. A scoped reviewer sees only rows inside their own
 * territory; that filtering happens in the query, so rows elsewhere are absent
 * rather than hidden.
 */
function RowTable({ batchId, conflictsOnly }: { batchId: string; conflictsOnly: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [page, setPage] = useState(1)

  const load = useCallback(
    () => (conflictsOnly ? fetchImportConflicts(batchId, { page }) : fetchImportRows(batchId, { page })),
    [batchId, conflictsOnly, page],
  )
  const { state, reload } = useAsync(load)

  const columns: Column<ImportRowDto>[] = [
    {
      key: 'row',
      header: t('admin.imports.rowNumber'),
      numeric: true,
      render: (row) => formatNumber(row.rowNumber, locale),
    },
    {
      key: 'nameAr',
      header: t('admin.participants.nameAr'),
      render: (row) => (
        <span dir="rtl" lang="ar">
          {row.firstNameAr} {row.lastNameAr}
        </span>
      ),
    },
    {
      key: 'nameLatin',
      header: t('admin.participants.nameLatin'),
      render: (row) => `${row.firstNameLatin} ${row.lastNameLatin}`,
    },
    {
      key: 'nationalId',
      header: t('admin.participants.nationalId'),
      render: (row) => <span className="font-mono text-sm">••••{row.nationalIdSuffix}</span>,
    },
    { key: 'commune', header: t('geo.commune.label'), render: (row) => row.communeCode },
    {
      key: 'year',
      header: t('admin.history.drawYear'),
      render: (row) => (row.drawYear === null ? '—' : formatNumber(row.drawYear, locale)),
    },
    {
      key: 'status',
      header: t('admin.imports.status'),
      render: (row) => <StatusBadge kind="importRow" status={row.status} />,
    },
    {
      key: 'issues',
      header: t('admin.imports.issues'),
      render: (row) =>
        row.issues.length === 0 ? (
          '—'
        ) : (
          <ul className="flex flex-wrap gap-1">
            {row.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                {/* A warning is noted and imports anyway; anything else is a
                    blocker, and the badge must not make the two look alike. */}
                <Badge variant={isImportWarning(issue.code) ? 'warning' : 'destructive'}>
                  {t(`admin.importIssue.${issue.code}`, { defaultValue: issue.code })}
                </Badge>
              </li>
            ))}
          </ul>
        ),
    },
  ]

  const result = state.status === 'ready' ? state.data : undefined

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        state={mapAsync(state, (value) => value.items)}
        columns={columns}
        getRowKey={(row) => row.id}
        label={conflictsOnly ? t('admin.imports.conflictsLabel') : t('admin.imports.rowsLabel')}
        emptyMessage={conflictsOnly ? t('admin.imports.noConflicts') : t('admin.imports.noRows')}
        onRetry={reload}
      />
      {result && <TablePager page={result.page} totalPages={result.totalPages} onPageChange={setPage} />}
    </div>
  )
}
