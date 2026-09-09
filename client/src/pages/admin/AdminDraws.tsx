import {
  DRAW_YEAR_TRANSITIONS,
  type DrawYearDto,
  type DrawYearStatus,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { PlusIcon } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { ConfirmDialog } from '@/components/admin/dialogs'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/dialog'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { createDrawYear, fetchDrawYears, updateDrawYearStatus } from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatNumber, formatYear } from '@/lib/format'
import { useAction, useAsync } from '@/lib/use-async'

/**
 * The national registration cycle.
 *
 * Every year's status moves along the transitions in
 * `DRAW_YEAR_TRANSITIONS` — the same table the server enforces. This screen
 * offers only the moves that table permits, which is a courtesy rather than a
 * control: an operator who forged a request for any other move would be
 * refused by the service and by the database behind it.
 *
 * There is no free dropdown of statuses, and no route back from
 * `REGISTRATION_CLOSED`. A lock whose value is that it cannot be taken back
 * must not have a button that takes it back.
 */
export function AdminDraws() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const load = useCallback(() => fetchDrawYears(), [])
  const { state, reload } = useAsync(load)

  const [creating, setCreating] = useState(false)
  const [transition, setTransition] = useState<{ year: DrawYearDto; to: DrawYearStatus } | undefined>()

  const transitionAction = useAction(updateDrawYearStatus)

  const columns: Column<DrawYearDto>[] = [
    {
      key: 'year',
      header: t('admin.draws.year'),
      render: (row) => <span className="font-medium tabular-nums">{formatYear(row.year, locale)}</span>,
    },
    {
      key: 'status',
      header: t('admin.draws.status'),
      render: (row) => <StatusBadge kind="drawYear" status={row.status} />,
    },
    {
      key: 'communes',
      header: t('admin.draws.communeDraws'),
      numeric: true,
      render: (row) => formatNumber(row.communeDrawCount, locale),
    },
    {
      key: 'configure',
      header: t('admin.draws.configure'),
      render: (row) => (
        <Link
          to={`/admin/communes?drawYearId=${encodeURIComponent(row.id)}`}
          className="text-primary underline-offset-4 hover:underline"
        >
          {t('admin.draws.openCommunes')}
        </Link>
      ),
    },
  ]

  return (
    <AdminPage
      title={t('admin.pages.draws.title')}
      description={t('admin.draws.description')}
      action={
        isSuperAdmin ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden="true" />
            {t('admin.draws.create')}
          </Button>
        ) : undefined
      }
    >
      {!isSuperAdmin && (
        <Alert>
          <AlertTitle>{t('admin.draws.readOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('admin.draws.readOnlyBody')}</AlertDescription>
        </Alert>
      )}

      <DataTable
        state={state}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.draws.tableLabel')}
        emptyMessage={t('admin.draws.empty')}
        onRetry={reload}
        rowActions={
          isSuperAdmin
            ? (row) => (
                <div className="flex flex-wrap justify-end gap-2">
                  {DRAW_YEAR_TRANSITIONS[row.status].map((next) => (
                    <Button
                      key={next}
                      type="button"
                      size="sm"
                      variant={next === 'ARCHIVED' ? 'outline' : 'secondary'}
                      onClick={() => setTransition({ year: row, to: next })}
                    >
                      {t(`admin.draws.transitions.${next}`)}
                    </Button>
                  ))}
                  {DRAW_YEAR_TRANSITIONS[row.status].length === 0 && (
                    <span className="text-xs text-muted-foreground">{t('admin.draws.terminal')}</span>
                  )}
                </div>
              )
            : undefined
        }
      />

      <CreateDrawYearDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false)
          reload()
        }}
      />

      {transition && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setTransition(undefined)}
          title={t('admin.draws.confirmTitle')}
          description={t(`admin.draws.confirmBody.${transition.to}`)}
          facts={[
            { label: t('admin.draws.year'), value: formatYear(transition.year.year, locale) },
            {
              label: t('admin.draws.from'),
              value: t(`admin.status.drawYear.${transition.year.status}`),
            },
            { label: t('admin.draws.to'), value: t(`admin.status.drawYear.${transition.to}`) },
          ]}
          confirmLabel={t(`admin.draws.transitions.${transition.to}`)}
          destructive={transition.to === 'REGISTRATION_CLOSED' || transition.to === 'ARCHIVED'}
          pending={transitionAction.pending}
          error={transitionAction.error}
          onConfirm={async () => {
            if (await transitionAction.run(transition.year.id, transition.to)) {
              toast.success(t('admin.draws.transitioned'))
              setTransition(undefined)
              reload()
            }
          }}
        />
      )}
    </AdminPage>
  )
}

function CreateDrawYearDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [year, setYear] = useState('')
  const action = useAction(createDrawYear)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = Number(year)
    if (!Number.isInteger(parsed)) return
    if (await action.run(parsed)) {
      toast.success(t('admin.draws.created'))
      setYear('')
      onCreated()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.draws.create')}</DialogTitle>
            {/* A year is always created as a draft; opening registration is a
                separate, deliberate act. */}
            <DialogDescription>{t('admin.draws.createBody')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-draw-year">{t('admin.draws.year')}</Label>
            <Input
              id="new-draw-year"
              value={year}
              inputMode="numeric"
              required
              min={2000}
              max={2200}
              type="number"
              onChange={(event) => setYear(event.target.value)}
            />
          </div>

          {action.error !== undefined && <ErrorNotice error={action.error} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('admin.actions.cancel')}
            </Button>
            <Button type="submit" disabled={action.pending || year === ''}>
              {action.pending ? t('admin.actions.working') : t('admin.draws.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
