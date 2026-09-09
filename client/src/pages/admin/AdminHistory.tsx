import { localizedGeoName, type ParticipationHistoryDto, type SupportedLocale } from '@hajj-lottery/shared'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { DataTable, type Column } from '@/components/admin/DataTable'
import { ReasonDialog } from '@/components/admin/dialogs'
import { FactList } from '@/components/admin/dialogs'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Input } from '@/components/shadcn/input'
import { Label } from '@/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/shadcn/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/tooltip'
import { correctHistory, fetchParticipantHistory, requestHistoryCorrection } from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatNumber, formatYear } from '@/lib/format'
import { mapAsync, useAction, useAsync } from '@/lib/use-async'

/** Tri-state control value: leave the field as it is. */
const UNCHANGED = '__unchanged__'

/**
 * The participation ledger for one person.
 *
 * Addressed by participant id, which arrives from the applications screen or
 * the registry — there is no free-text person search here, because a
 * participant has no commune and a search across all of them is national work.
 *
 * What comes back is already filtered to the records this administrator may
 * see. A COMMUNE_ADMIN asking about somebody who also took part elsewhere is
 * shown only their own commune's years and is not told the others exist: the
 * record is the unit of ownership, not the person.
 *
 * The streak is withheld from scoped administrators entirely — it spans
 * communes by definition, so a single number would summarise territory they
 * cannot read.
 */
export function AdminHistory() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const participantId = params.get('participantId') ?? ''
  const [draft, setDraft] = useState(participantId)
  const [correcting, setCorrecting] = useState<ParticipationHistoryDto | undefined>(undefined)

  const load = useCallback(
    () => (participantId ? fetchParticipantHistory(participantId) : Promise.resolve(undefined)),
    [participantId],
  )
  const { state, reload } = useAsync(load)

  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const columns: Column<ParticipationHistoryDto>[] = [
    {
      key: 'year',
      header: t('admin.history.drawYear'),
      render: (row) => formatYear(row.drawYear, locale),
    },
    {
      key: 'commune',
      header: t('geo.commune.label'),
      render: (row) => (
        <span className="whitespace-nowrap">
          {localizedGeoName(row.commune, locale)}
          <span className="block text-xs text-muted-foreground">{localizedGeoName(row.wilaya, locale)}</span>
        </span>
      ),
    },
    {
      key: 'participated',
      header: t('admin.history.participated'),
      render: (row) => <BooleanBadge value={row.participated} />,
    },
    { key: 'won', header: t('admin.history.won'), render: (row) => <BooleanBadge value={row.won} /> },
    {
      key: 'source',
      header: t('admin.history.source'),
      render: (row) => <Badge variant="outline">{t(`admin.historySource.${row.source}`)}</Badge>,
    },
    {
      key: 'verified',
      header: t('admin.history.verified'),
      render: (row) =>
        row.verified ? (
          <Badge variant="success">{t('admin.history.isVerified')}</Badge>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="warning">{t('admin.history.notVerified')}</Badge>
            </TooltipTrigger>
            <TooltipContent>{t('admin.history.notVerifiedHint')}</TooltipContent>
          </Tooltip>
        ),
    },
    { key: 'notes', header: t('admin.history.notes'), render: (row) => row.notes ?? '—' },
  ]

  return (
    <AdminPage title={t('admin.pages.history.title')} description={t('admin.history.description')}>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          setParams(draft.trim() ? { participantId: draft.trim() } : {})
        }}
      >
        <div className="flex min-w-64 flex-col gap-1.5">
          <Label htmlFor="participant-id">{t('admin.history.participantId')}</Label>
          <Input
            id="participant-id"
            value={draft}
            autoComplete="off"
            className="font-mono"
            placeholder={t('admin.history.participantIdPlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <Button type="submit">{t('admin.history.lookUp')}</Button>
      </form>

      {!participantId && (
        <Alert>
          <AlertTitle>{t('admin.history.noSelection')}</AlertTitle>
          <AlertDescription>{t('admin.history.noSelectionHint')}</AlertDescription>
        </Alert>
      )}

      {participantId && state.status === 'ready' && state.data?.streak && (
        <FactList
          facts={[
            {
              label: t('admin.history.streak'),
              value: formatNumber(state.data.streak.consecutiveNonWinningYears, locale),
            },
            {
              label: t('admin.history.streakTargetYear'),
              value: formatYear(state.data.streak.targetDrawYear, locale),
            },
            {
              label: t('admin.history.streakStopped'),
              value: t(`admin.streakStop.${state.data.streak.stoppedBecause}`),
            },
          ]}
        />
      )}

      {participantId && state.status === 'ready' && state.data && !state.data.streak && (
        <p className="text-sm text-muted-foreground">{t('admin.history.streakWithheld')}</p>
      )}

      {participantId && (
        <DataTable
          state={mapAsync(state, (result) => result?.records ?? [])}
          columns={columns}
          getRowKey={(row) => row.id}
          label={t('admin.history.tableLabel')}
          emptyMessage={t('admin.history.empty')}
          onRetry={reload}
          rowActions={(row) => (
            <Button type="button" variant="outline" size="sm" onClick={() => setCorrecting(row)}>
              {isSuperAdmin ? t('admin.history.correct') : t('admin.history.requestCorrection')}
            </Button>
          )}
        />
      )}

      {correcting && (
        <CorrectionDialog
          record={correcting}
          direct={isSuperAdmin}
          onClose={() => setCorrecting(undefined)}
          onDone={() => {
            setCorrecting(undefined)
            reload()
          }}
        />
      )}
    </AdminPage>
  )
}

/**
 * A stored boolean, never a blank.
 *
 * The ledger distinguishes "we know they did not take part" from "we have no
 * record", and this table must not turn the second into the first. There is no
 * third value in a `ParticipationHistoryDto` — a missing year is a missing
 * row — so the badge only ever says yes or no, and the absence shows up as the
 * year not being listed at all.
 */
function BooleanBadge({ value }: { value: boolean }) {
  const { t } = useTranslation()
  return (
    <Badge variant={value ? 'success' : 'secondary'}>
      {value ? t('admin.history.yes') : t('admin.history.no')}
    </Badge>
  )
}

interface CorrectionDialogProps {
  record: ParticipationHistoryDto
  /** SUPER_ADMIN corrects in place; everybody else asks. */
  direct: boolean
  onClose: () => void
  onDone: () => void
}

/**
 * Proposing a change to one ledger row.
 *
 * A scoped administrator's submission creates an approval request and changes
 * nothing; a SUPER_ADMIN's applies immediately. Both carry a mandatory reason,
 * which becomes the record's note — so the justification and the note cannot
 * drift apart, and there is no correction nobody had to account for.
 *
 * Each field is tri-state, with "unchanged" as the default. A form that
 * submitted its current values would silently re-assert facts nobody meant to
 * touch.
 */
function CorrectionDialog({ record, direct, onClose, onDone }: CorrectionDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [participated, setParticipated] = useState(UNCHANGED)
  const [won, setWon] = useState(UNCHANGED)
  const [verified, setVerified] = useState(UNCHANGED)

  const asBoolean = (value: string) => (value === UNCHANGED ? undefined : value === 'true')
  const change = {
    participated: asBoolean(participated),
    won: asBoolean(won),
    verified: asBoolean(verified),
  }
  const nothingChanged = Object.values(change).every((value) => value === undefined)

  const action = useAction(async (reason: string) => {
    const body = { ...change, reason }
    if (direct) return correctHistory(record.id, body)
    return requestHistoryCorrection(record.id, body)
  })

  return (
    <ReasonDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={direct ? t('admin.history.correctTitle') : t('admin.history.requestTitle')}
      description={direct ? t('admin.history.correctBody') : t('admin.history.requestBody')}
      facts={[
        { label: t('admin.history.drawYear'), value: formatYear(record.drawYear, locale) },
        { label: t('geo.commune.label'), value: localizedGeoName(record.commune, locale) },
      ]}
      reasonLabel={t('admin.history.reason')}
      submitLabel={direct ? t('admin.history.correct') : t('admin.history.requestCorrection')}
      pending={action.pending}
      error={action.error}
      disabled={nothingChanged}
      onSubmit={async (reason) => {
        if (await action.run(reason)) {
          toast.success(direct ? t('admin.history.corrected') : t('admin.history.requested'))
          onDone()
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <TriStateField
          id="correct-participated"
          label={t('admin.history.participated')}
          value={participated}
          onChange={setParticipated}
        />
        <TriStateField id="correct-won" label={t('admin.history.won')} value={won} onChange={setWon} />
        <TriStateField
          id="correct-verified"
          label={t('admin.history.verified')}
          value={verified}
          onChange={setVerified}
        />
      </div>
      {nothingChanged && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('admin.history.selectAtLeastOne')}
        </p>
      )}
    </ReasonDialog>
  )
}

function TriStateField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNCHANGED}>{t('admin.history.unchanged')}</SelectItem>
          <SelectItem value="true">{t('admin.history.yes')}</SelectItem>
          <SelectItem value="false">{t('admin.history.no')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
