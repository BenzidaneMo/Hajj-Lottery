import {
  localizedGeoName,
  MAX_ALLOCATED_SPOTS,
  MIN_ALLOCATED_SPOTS,
  COMMUNE_DRAW_STATUSES,
  type BatchCandidateDto,
  type BatchExecutionResultDto,
  type BatchNotReadyReason,
  type BatchValidationDto,
  type CommuneDrawListItemDto,
  type DrawYearDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { PlayIcon, PlusIcon, SettingsIcon } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage, TablePager } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { FactList } from '@/components/admin/dialogs'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { PlacePicker } from '@/components/admin/PlacePicker'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
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
import { Progress } from '@/components/shadcn/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table'
import {
  createCommuneDraw,
  executeBatchDraws,
  fetchCommuneDraw,
  fetchCommuneDraws,
  fetchDrawYears,
  updateCommuneDraw,
  validateBatchDraws,
} from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatNumber, formatYear } from '@/lib/format'
import { mapAsync, useAction, useAsync } from '@/lib/use-async'

const ANY_YEAR = '__any__'
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const

interface Filters {
  drawYearId: string | undefined
  wilayaId: string | undefined
  communeId: string | undefined
  status: string | undefined
  page: number
  pageSize: number
}

const INITIAL_FILTERS: Filters = {
  drawYearId: undefined,
  wilayaId: undefined,
  communeId: undefined,
  status: undefined,
  page: 1,
  pageSize: 25,
}

/**
 * Which communes have a draw configured, and for how many places.
 *
 * `allocatedSpots` is configuration and nothing else. It is not derived from
 * how many people applied, from population, or from past winners — 843
 * applications for 12 places is normal, and so is 100 places for 20
 * applicants. The column is labelled as allocated places for that reason, and
 * nothing on this screen computes it.
 *
 * Only a SUPER_ADMIN may configure one or edit an allocation. A commune or
 * wilaya administrator awarding places in their own territory is precisely
 * the conflict of interest the roles exist to prevent, so scoped
 * administrators read this screen and open a draw's operations from it.
 */
export function AdminCommunes() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [params, setParams] = useSearchParams()
  const [filters, setFilters] = useState<Filters>({
    ...INITIAL_FILTERS,
    drawYearId: params.get('drawYearId') ?? undefined,
  })
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [batchOpen, setBatchOpen] = useState(false)

  const narrow = (change: Partial<Filters>) => setFilters((current) => ({ ...current, ...change, page: 1 }))

  const loadYears = useCallback(() => fetchDrawYears(), [])
  const years = useAsync(loadYears)

  const loadDraws = useCallback(
    () =>
      fetchCommuneDraws({
        drawYearId: filters.drawYearId,
        communeId: filters.communeId,
        wilayaId: filters.wilayaId,
        status: filters.status as (typeof COMMUNE_DRAW_STATUSES)[number] | undefined,
        page: filters.page,
        pageSize: filters.pageSize,
      }),
    [filters.drawYearId, filters.communeId, filters.wilayaId, filters.status, filters.page, filters.pageSize],
  )
  const { state, reload } = useAsync(loadDraws)
  const page = state.status === 'ready' ? state.data : undefined

  const columns: Column<CommuneDrawListItemDto>[] = [
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
    {
      key: 'wilaya',
      header: t('geo.wilaya.label'),
      render: (row) => localizedGeoName(row.wilaya, locale),
    },
    {
      key: 'year',
      header: t('admin.draws.year'),
      render: (row) => formatYear(row.drawYear, locale),
    },
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
    {
      key: 'pool',
      header: t('admin.communeDraws.poolState'),
      render: (row) => (
        <Badge variant={row.poolFrozen ? 'success' : 'outline'}>
          {t(row.poolFrozen ? 'admin.communeDraws.poolFrozen' : 'admin.communeDraws.poolNotFrozen')}
        </Badge>
      ),
    },
    {
      key: 'execution',
      header: t('admin.communeDraws.executionState'),
      render: (row) => (
        <Badge variant={row.executed ? 'success' : 'outline'}>
          {t(row.executed ? 'admin.communeDraws.executed' : 'admin.communeDraws.notExecuted')}
        </Badge>
      ),
    },
    {
      key: 'publication',
      header: t('admin.communeDraws.publicationState'),
      render: (row) => (
        <Badge variant={row.published ? 'success' : 'outline'}>
          {t(row.published ? 'admin.communeDraws.published' : 'admin.communeDraws.notPublished')}
        </Badge>
      ),
    },
  ]

  return (
    <AdminPage
      title={t('admin.pages.communes.title')}
      description={t('admin.communeDraws.description')}
      action={
        isSuperAdmin ? (
          <Button type="button" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden="true" />
            {t('admin.communeDraws.create')}
          </Button>
        ) : undefined
      }
    >
      {!isSuperAdmin && (
        <Alert>
          <AlertTitle>{t('admin.communeDraws.readOnlyTitle')}</AlertTitle>
          <AlertDescription>{t('admin.communeDraws.readOnlyBody')}</AlertDescription>
        </Alert>
      )}

      {isSuperAdmin && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">{t('admin.batch.title')}</p>
            <p className="text-sm text-muted-foreground">
              {filters.drawYearId ? t('admin.batch.hint') : t('admin.batch.selectYearHint')}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={!filters.drawYearId}
            onClick={() => setBatchOpen(true)}
          >
            <PlayIcon aria-hidden="true" />
            {t('admin.batch.execute')}
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-draw-year">{t('admin.draws.year')}</Label>
          <Select
            value={filters.drawYearId ?? ANY_YEAR}
            onValueChange={(value) => {
              const drawYearId = value === ANY_YEAR ? undefined : value
              narrow({ drawYearId })
              setParams(drawYearId ? { drawYearId } : {})
            }}
          >
            <SelectTrigger id="filter-draw-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_YEAR}>{t('admin.filters.anyYear')}</SelectItem>
              {(years.state.status === 'ready' ? years.state.data : []).map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {formatYear(year.year, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <PlacePicker
          wilayaId={filters.wilayaId}
          communeId={filters.communeId}
          onChange={(next) => narrow(next)}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">{t('admin.communeDraws.status')}</Label>
          <Select
            value={filters.status ?? '__any__'}
            onValueChange={(value) => narrow({ status: value === '__any__' ? undefined : value })}
          >
            <SelectTrigger id="filter-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{t('admin.filters.anyStatus')}</SelectItem>
              {COMMUNE_DRAW_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`admin.status.communeDraw.${status}`)}
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
        label={t('admin.communeDraws.tableLabel')}
        emptyMessage={t('admin.communeDraws.empty')}
        onRetry={reload}
        rowActions={(row) => (
          <div className="flex justify-end gap-2">
            {isSuperAdmin && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditingId(row.id)}
                aria-label={t('admin.communeDraws.editAllocation')}
              >
                <SettingsIcon aria-hidden="true" />
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to={`/admin/communes/${row.id}`}>{t('admin.communeDraws.open')}</Link>
            </Button>
          </div>
        )}
      />

      {page && (
        <TablePager
          page={page.page}
          totalPages={page.totalPages}
          total={page.total}
          pageSize={page.pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(next) => setFilters((current) => ({ ...current, page: next }))}
          onPageSizeChange={(pageSize) => setFilters((current) => ({ ...current, page: 1, pageSize }))}
        />
      )}

      {isSuperAdmin && (
        <CreateCommuneDrawDialog
          open={creating}
          onOpenChange={setCreating}
          years={years.state.status === 'ready' ? years.state.data : []}
          onCreated={() => {
            setCreating(false)
            reload()
          }}
        />
      )}

      {isSuperAdmin && editingId && (
        <EditAllocationDialog
          communeDrawId={editingId}
          onOpenChange={(open) => !open && setEditingId(undefined)}
          onSaved={() => {
            setEditingId(undefined)
            reload()
          }}
        />
      )}

      {isSuperAdmin && filters.drawYearId && (
        <BatchExecutionDialog
          open={batchOpen}
          onOpenChange={setBatchOpen}
          drawYearId={filters.drawYearId}
          onCompleted={reload}
        />
      )}
    </AdminPage>
  )
}

function CreateCommuneDrawDialog({
  open,
  onOpenChange,
  years,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  years: DrawYearDto[]
  onCreated: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [drawYearId, setDrawYearId] = useState('')
  const [place, setPlace] = useState<{ wilayaId?: string; communeId?: string }>({})
  const [spots, setSpots] = useState('')
  const action = useAction(createCommuneDraw)

  const ready = drawYearId !== '' && place.communeId !== undefined && spots !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !place.communeId) return
    const created = await action.run({
      drawYearId,
      communeId: place.communeId,
      allocatedSpots: Number(spots),
    })
    if (created) {
      toast.success(t('admin.communeDraws.created'))
      setSpots('')
      setPlace({})
      onCreated()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.communeDraws.create')}</DialogTitle>
            <DialogDescription>{t('admin.communeDraws.createBody')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-draw-year-select">{t('admin.draws.year')}</Label>
            <Select value={drawYearId} onValueChange={setDrawYearId}>
              <SelectTrigger id="new-draw-year-select">
                <SelectValue placeholder={t('admin.communeDraws.selectYear')} />
              </SelectTrigger>
              <SelectContent>
                {years.map((year) => (
                  <SelectItem key={year.id} value={year.id}>
                    {formatYear(year.year, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PlacePicker
              wilayaId={place.wilayaId}
              communeId={place.communeId}
              onChange={(next) => setPlace(next)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-allocated-spots">{t('admin.communeDraws.allocatedSpots')}</Label>
            <Input
              id="new-allocated-spots"
              type="number"
              inputMode="numeric"
              required
              min={MIN_ALLOCATED_SPOTS}
              max={MAX_ALLOCATED_SPOTS}
              value={spots}
              aria-describedby="new-allocated-spots-hint"
              onChange={(event) => setSpots(event.target.value)}
            />
            <p id="new-allocated-spots-hint" className="text-xs text-muted-foreground">
              {t('admin.communeDraws.allocatedSpotsHint')}
            </p>
          </div>

          {action.error !== undefined && <ErrorNotice error={action.error} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('admin.actions.cancel')}
            </Button>
            <Button type="submit" disabled={action.pending || !ready}>
              {action.pending ? t('admin.actions.working') : t('admin.communeDraws.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Editing a commune's allocation, correctly from the start.
 *
 * Opening this always issues a fresh `fetchCommuneDraw` — it never trusts the
 * row the list last loaded, which could be stale by the time an operator
 * clicks the button. Submitting sends back the `updatedAt` that fetch
 * returned as `expectedUpdatedAt`; the server refuses the write (409) if the
 * record moved in between, which reads as the ordinary "This has already
 * changed" conflict message. Retrying re-fetches rather than resubmitting the
 * same stale value.
 */
function EditAllocationDialog({
  communeDrawId,
  onOpenChange,
  onSaved,
}: {
  communeDrawId: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [spots, setSpots] = useState('')

  const load = useCallback(() => fetchCommuneDraw(communeDrawId), [communeDrawId])
  const { state, reload } = useAsync(load)
  const action = useAction(updateCommuneDraw)

  const record = state.status === 'ready' ? state.data : undefined
  const editable = record ? record.status === 'DRAFT' || record.status === 'READY' : false

  // The input starts empty until the fresh record arrives, then takes its
  // current value exactly once — not on every re-render, so the operator's
  // own typing is never overwritten mid-edit.
  const [seeded, setSeeded] = useState(false)
  if (record && !seeded) {
    setSeeded(true)
    setSpots(String(record.allocatedSpots))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!record || !editable) return
    const updated = await action.run(communeDrawId, {
      allocatedSpots: Number(spots),
      expectedUpdatedAt: record.updatedAt,
    })
    if (updated) {
      toast.success(t('admin.communeDraws.editAllocationSaved'))
      onSaved()
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.communeDraws.editAllocationTitle')}</DialogTitle>
            <DialogDescription>
              {record ? localizedGeoName(record.commune, locale) : t('admin.communeDraws.editAllocationBody')}
            </DialogDescription>
          </DialogHeader>

          {state.status === 'error' && <ErrorNotice error={state.error} onRetry={reload} />}

          {state.status === 'loading' && (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          )}

          {record && !editable && (
            <Alert>
              <AlertTitle>{t('admin.communeDraws.editAllocationLockedTitle')}</AlertTitle>
              <AlertDescription>
                {t('admin.communeDraws.editAllocationLockedBody', {
                  status: t(`admin.status.communeDraw.${record.status}`),
                })}
              </AlertDescription>
            </Alert>
          )}

          {record && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-allocated-spots">{t('admin.communeDraws.allocatedSpots')}</Label>
              <Input
                id="edit-allocated-spots"
                type="number"
                inputMode="numeric"
                required
                disabled={!editable}
                min={MIN_ALLOCATED_SPOTS}
                max={MAX_ALLOCATED_SPOTS}
                value={spots}
                onChange={(event) => setSpots(event.target.value)}
              />
            </div>
          )}

          {action.error !== undefined && <ErrorNotice error={action.error} onRetry={reload} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('admin.actions.cancel')}
            </Button>
            <Button type="submit" disabled={!editable || action.pending || spots === ''}>
              {action.pending ? t('admin.actions.working') : t('admin.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type BatchPhase = 'validating' | 'confirm' | 'results'

/**
 * Execute All Validated Draws — SUPER_ADMIN only, scoped to the page's own
 * draw-year filter.
 *
 * Two requests, always in this order: a validation the server computes fresh
 * every time this opens, then — only on explicit confirmation of exactly
 * what was shown — the execute call, sent the same `ready` ids verbatim.
 * Each named commune still runs through its own independent, atomic
 * `execute()`; this dialog only orchestrates the two requests and renders
 * what came back. There is no live per-commune progress feed — this system
 * has none for anything (see `lib/draw-watch.ts`) — so the wait is a single
 * bounded request, then the full outcome table at once.
 */
function BatchExecutionDialog({
  open,
  onOpenChange,
  drawYearId,
  onCompleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  drawYearId: string
  onCompleted: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [phase, setPhase] = useState<BatchPhase>('validating')
  const [validation, setValidation] = useState<BatchValidationDto | undefined>(undefined)
  const [result, setResult] = useState<BatchExecutionResultDto | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [pending, setPending] = useState(false)

  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setPhase('validating')
      setValidation(undefined)
      setResult(undefined)
      setError(undefined)
      validateBatchDraws(drawYearId)
        .then((data) => {
          setValidation(data)
          setPhase('confirm')
        })
        .catch((caught: unknown) => setError(caught))
    }
  }

  if (!open) return null

  async function runExecution() {
    if (!validation) return
    setPending(true)
    setError(undefined)
    try {
      const readyIds = validation.ready.map((row) => row.communeDrawId)
      const outcome = await executeBatchDraws(drawYearId, readyIds)
      setResult(outcome)
      setPhase('results')
      onCompleted()
    } catch (caught) {
      setError(caught)
    } finally {
      setPending(false)
    }
  }

  const place = (row: BatchCandidateDto) =>
    `${localizedGeoName(row.wilaya, locale)} — ${localizedGeoName(row.commune, locale)}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('admin.batch.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('admin.batch.dialogDescription')}</DialogDescription>
        </DialogHeader>

        {phase === 'validating' && !error && (
          <p className="text-sm text-muted-foreground">{t('admin.batch.validating')}</p>
        )}

        {phase === 'confirm' && pending && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">{t('admin.batch.processing')}</p>
            <Progress value={undefined} className="h-2 animate-pulse" />
            <p className="text-xs text-muted-foreground">{t('admin.batch.processingHint')}</p>
          </div>
        )}

        {error !== undefined && <ErrorNotice error={error} />}

        {phase === 'confirm' && validation && (
          <>
            <FactList
              facts={[
                { label: t('admin.batch.readyCount'), value: formatNumber(validation.ready.length, locale) },
                {
                  label: t('admin.batch.notReadyCount'),
                  value: formatNumber(validation.notReady.length, locale),
                },
                {
                  label: t('admin.batch.alreadyCompletedCount'),
                  value: formatNumber(validation.alreadyCompleted.length, locale),
                },
                { label: t('admin.batch.totalCount'), value: formatNumber(validation.total, locale) },
              ]}
            />

            {validation.ready.length === 0 ? (
              <Alert>
                <AlertTitle>{t('admin.batch.noneReadyTitle')}</AlertTitle>
                <AlertDescription>{t('admin.batch.noneReadyBody')}</AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>{t('admin.batch.warningTitle')}</AlertTitle>
                <AlertDescription>
                  {t('admin.batch.warningBody', { count: validation.ready.length })}
                </AlertDescription>
              </Alert>
            )}

            {validation.notReady.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('geo.commune.label')}</TableHead>
                      <TableHead>{t('admin.batch.reason')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validation.notReady.map((row) => (
                      <TableRow key={row.communeDrawId}>
                        <TableCell>{place(row)}</TableCell>
                        <TableCell>{t(`admin.batch.reasons.${row.reason as BatchNotReadyReason}`)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}

        {phase === 'results' && result && (
          <>
            <FactList
              facts={[
                { label: t('admin.batch.targeted'), value: formatNumber(result.targeted, locale) },
                { label: t('admin.batch.succeeded'), value: formatNumber(result.succeeded, locale) },
                { label: t('admin.batch.failed'), value: formatNumber(result.failed, locale) },
                { label: t('admin.batch.skipped'), value: formatNumber(result.skipped, locale) },
              ]}
            />
            {result.targeted === 0 ? (
              <Alert>
                <AlertDescription>{t('admin.batch.noneReadyBody')}</AlertDescription>
              </Alert>
            ) : result.failed === 0 ? (
              <Alert>
                <AlertTitle>{t('admin.batch.allSucceededTitle')}</AlertTitle>
              </Alert>
            ) : result.succeeded === 0 ? (
              <Alert variant="destructive">
                <AlertTitle>{t('admin.batch.allFailedTitle')}</AlertTitle>
              </Alert>
            ) : (
              <Alert>
                <AlertTitle>{t('admin.batch.partialTitle')}</AlertTitle>
              </Alert>
            )}

            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('geo.commune.label')}</TableHead>
                    <TableHead>{t('admin.communeDraws.status')}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t('admin.table.actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.outcomes.map((row) => (
                    <TableRow key={row.communeDrawId}>
                      <TableCell>{place(row)}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.status === 'completed'
                              ? 'success'
                              : row.status === 'skipped'
                                ? 'outline'
                                : 'destructive'
                          }
                        >
                          {t(`admin.batch.outcome.${row.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/admin/communes/${row.communeDrawId}`}>
                            {t('admin.communeDraws.open')}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {phase === 'results' ? t('admin.batch.done') : t('admin.actions.cancel')}
          </Button>
          {phase === 'confirm' && (
            <Button
              type="button"
              variant="destructive"
              disabled={pending || !validation || validation.ready.length === 0}
              onClick={runExecution}
            >
              {pending
                ? t('admin.actions.working')
                : t('admin.batch.confirmExecute', { count: validation?.ready.length ?? 0 })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
