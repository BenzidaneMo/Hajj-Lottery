import {
  localizedGeoName,
  MAX_ALLOCATED_SPOTS,
  MIN_ALLOCATED_SPOTS,
  type CommuneDrawDto,
  type DrawYearDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { PlusIcon } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { PlacePicker } from '@/components/admin/PlacePicker'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { createCommuneDraw, fetchCommuneDraws, fetchDrawYears } from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatNumber, formatYear } from '@/lib/format'
import { useAction, useAsync } from '@/lib/use-async'

/**
 * Which communes have a draw configured, and for how many places.
 *
 * `allocatedSpots` is configuration and nothing else. It is not derived from
 * how many people applied, from population, or from past winners — 843
 * applications for 12 places is normal, and so is 100 places for 20
 * applicants. The column is labelled as allocated places for that reason, and
 * nothing on this screen computes it.
 *
 * Only a SUPER_ADMIN may configure one. A commune or wilaya administrator
 * awarding places in their own territory is precisely the conflict of interest
 * the roles exist to prevent, so scoped administrators read this screen and
 * open a draw's operations from it.
 */
export function AdminCommunes() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [params, setParams] = useSearchParams()
  const drawYearId = params.get('drawYearId') ?? undefined
  const [place, setPlace] = useState<{ wilayaId?: string; communeId?: string }>({})
  const [creating, setCreating] = useState(false)

  const loadYears = useCallback(() => fetchDrawYears(), [])
  const years = useAsync(loadYears)

  const loadDraws = useCallback(
    () => fetchCommuneDraws({ drawYearId, communeId: place.communeId }),
    [drawYearId, place.communeId],
  )
  const { state, reload } = useAsync(loadDraws)

  // The commune-draws endpoint filters by commune, not by wilaya, so a wilaya
  // choice narrows the rows here. This never widens anything: the server has
  // already limited the response to the caller's own territory.
  const visible = (rows: CommuneDrawDto[]) =>
    place.wilayaId ? rows.filter((row) => row.wilaya.id === place.wilayaId) : rows

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-draw-year">{t('admin.draws.year')}</Label>
          <Select
            value={drawYearId ?? '__any__'}
            onValueChange={(value) => setParams(value === '__any__' ? {} : { drawYearId: value })}
          >
            <SelectTrigger id="filter-draw-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">{t('admin.filters.anyYear')}</SelectItem>
              {(years.state.status === 'ready' ? years.state.data : []).map((year) => (
                <SelectItem key={year.id} value={year.id}>
                  {formatYear(year.year, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <PlacePicker
          wilayaId={place.wilayaId}
          communeId={place.communeId}
          onChange={(next) => setPlace(next)}
        />
      </div>

      <DataTable
        state={state.status === 'ready' ? { status: 'ready', data: visible(state.data) } : state}
        columns={columns}
        getRowKey={(row) => row.id}
        label={t('admin.communeDraws.tableLabel')}
        emptyMessage={t('admin.communeDraws.empty')}
        onRetry={reload}
        rowActions={(row) => (
          <Button asChild variant="outline" size="sm">
            <Link to={`/admin/communes/${row.id}`}>{t('admin.communeDraws.open')}</Link>
          </Button>
        )}
      />

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
