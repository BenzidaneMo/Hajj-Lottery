import {
  ABANDONMENT_REASONS,
  localizedGeoName,
  type AbandonmentReason,
  type CommuneDrawDto,
  type DrawReserveDto,
  type DrawResultDto,
  type DrawWinnerDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Label } from '@/components/shadcn/label'
import { RadioGroup, RadioGroupItem } from '@/components/shadcn/radio-group'
import { ScrollArea } from '@/components/shadcn/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/shadcn/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs'
import { abandonWinner, acceptReserve, callReserve, declineReserve } from '@/lib/admin-api'
import { formatNumber } from '@/lib/format'
import { useAction } from '@/lib/use-async'

import { ConfirmDialog, FactList, ReasonDialog } from './dialogs'
import { StatusBadge } from './StatusBadge'

/**
 * A concluded draw: what the lottery decided, and what has happened since.
 *
 * The two are kept apart deliberately, on separate tabs and in separate
 * tables. `draw_winners` and `draw_reserves` say what the lottery did and
 * never move; a promoted reserve stays reserve #1 forever and *separately*
 * becomes a winner. Merging the lists would turn the record of a lottery into
 * a record of who holds a place today.
 *
 * Both lists are rendered in the order the server sent them. Nothing here
 * sorts, filters or renumbers — the order came from the draw, and rearranging
 * it on screen would misrepresent what the draw produced.
 */

export interface ResultPanelProps {
  draw: CommuneDrawDto
  result: DrawResultDto
  /** Only a national administrator may move any of this. */
  canOperate: boolean
  onChanged: (result: DrawResultDto) => void
}

export function ResultPanel({ draw, result, canOperate, onChanged }: ResultPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  return (
    <div className="flex flex-col gap-4">
      <FactList
        facts={[
          { label: t('admin.result.winners'), value: formatNumber(result.winnerCount, locale) },
          { label: t('admin.result.reserves'), value: formatNumber(result.reserveCount, locale) },
          {
            label: t('admin.result.activeWinners'),
            value: formatNumber(result.activeWinnerCount, locale),
          },
          {
            label: t('admin.result.winningParticipants'),
            value: formatNumber(result.winningParticipantCount, locale),
          },
          { label: t('admin.pool.entries'), value: formatNumber(result.entryCount, locale) },
          {
            label: t('admin.pool.totalWeight'),
            value: formatNumber(result.totalWeightAtDraw, locale),
          },
          { label: t('admin.result.algorithmVersion'), value: result.algorithmVersion },
        ]}
      />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('admin.result.poolHash')}</span>
        <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
          {result.poolHash}
        </code>
      </div>

      <Tabs defaultValue="winners">
        <TabsList>
          <TabsTrigger value="winners">{t('admin.result.tabs.winners')}</TabsTrigger>
          <TabsTrigger value="reserves">{t('admin.result.tabs.reserves')}</TabsTrigger>
          <TabsTrigger value="events">{t('admin.result.tabs.events')}</TabsTrigger>
        </TabsList>

        <TabsContent value="winners" className="pt-4">
          <WinnerTable
            draw={draw}
            result={result}
            canOperate={canOperate}
            locale={locale}
            onChanged={onChanged}
          />
        </TabsContent>

        <TabsContent value="reserves" className="pt-4">
          <ReserveTable
            draw={draw}
            result={result}
            canOperate={canOperate}
            locale={locale}
            onChanged={onChanged}
          />
        </TabsContent>

        <TabsContent value="events" className="pt-4">
          <SelectionEvents result={result} locale={locale} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

interface ListProps {
  draw: CommuneDrawDto
  result: DrawResultDto
  canOperate: boolean
  locale: SupportedLocale
  onChanged: (result: DrawResultDto) => void
}

/** The original winners, in the order drawn, with their current outcome. */
function WinnerTable({ draw, result, canOperate, locale, onChanged }: ListProps) {
  const { t } = useTranslation()
  const [abandoning, setAbandoning] = useState<DrawWinnerDto | undefined>(undefined)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('admin.result.winnersHint')}</p>

      <div className="w-full overflow-x-auto rounded-lg border border-border">
        <Table aria-label={t('admin.result.winnersLabel')}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-end">{t('admin.result.selectionOrder')}</TableHead>
              <TableHead>{t('admin.applications.reference')}</TableHead>
              <TableHead>{t('admin.applications.entryType')}</TableHead>
              <TableHead className="text-end">{t('admin.applications.participants')}</TableHead>
              <TableHead>{t('admin.result.outcome')}</TableHead>
              {canOperate && <TableHead className="text-end">{t('admin.table.actions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Exactly as the server sent them. */}
            {result.winners.map((winner) => (
              <TableRow key={winner.selectionOrder}>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(winner.selectionOrder, locale)}
                </TableCell>
                <TableCell className="font-mono text-sm">{winner.applicationReference}</TableCell>
                <TableCell>{t(`admin.entryType.${winner.entryType}`)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(winner.participantCount, locale)}
                </TableCell>
                <TableCell>
                  <StatusBadge kind="winnerOutcome" status={winner.outcome} />
                </TableCell>
                {canOperate && (
                  <TableCell className="text-end">
                    {winner.outcome === 'ACTIVE' ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => setAbandoning(winner)}>
                        {t('admin.result.recordAbandonment')}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('admin.result.alreadyWithdrawn')}
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {abandoning && (
        <AbandonDialog
          draw={draw}
          winner={abandoning}
          locale={locale}
          onClose={() => setAbandoning(undefined)}
          onDone={(next) => {
            setAbandoning(undefined)
            onChanged(next)
          }}
        />
      )}
    </div>
  )
}

/**
 * Recording that an original winner gave up their place.
 *
 * The dialog says, in words, what this does and does not do: the person
 * remains an original winner of this draw, their position in the order is
 * unchanged, and their lifetime exclusion stays in force. There is no
 * operation anywhere in this system that turns that exclusion back off, and
 * this is not one.
 *
 * It does not call a reserve either. Abandoning and calling are two deliberate
 * requests so the trail can say who decided what.
 */
function AbandonDialog({
  draw,
  winner,
  locale,
  onClose,
  onDone,
}: {
  draw: CommuneDrawDto
  winner: DrawWinnerDto
  locale: SupportedLocale
  onClose: () => void
  onDone: (result: DrawResultDto) => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<AbandonmentReason | undefined>(undefined)
  const action = useAction(abandonWinner)

  return (
    <ReasonDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('admin.result.abandonTitle')}
      description={t('admin.result.abandonBody')}
      facts={[
        { label: t('geo.commune.label'), value: localizedGeoName(draw.commune, locale) },
        {
          label: t('admin.result.selectionOrder'),
          value: formatNumber(winner.selectionOrder, locale),
        },
        { label: t('admin.applications.reference'), value: winner.applicationReference },
        {
          label: t('admin.applications.participants'),
          value: formatNumber(winner.participantCount, locale),
        },
      ]}
      reasonLabel={t('admin.result.explanation')}
      submitLabel={t('admin.result.recordAbandonment')}
      destructive
      pending={action.pending}
      error={action.error}
      disabled={reason === undefined}
      onSubmit={async (explanation) => {
        if (!reason) return
        const next = await action.run(draw.id, winner.selectionOrder, { reason, explanation })
        if (next) {
          toast.success(t('admin.result.abandonmentRecorded'))
          onDone(next)
        }
      }}
    >
      <Alert>
        <AlertTitle>{t('admin.result.abandonWarningTitle')}</AlertTitle>
        <AlertDescription>{t('admin.result.abandonWarningBody')}</AlertDescription>
      </Alert>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('admin.result.abandonReason')}</legend>
        <RadioGroup value={reason} onValueChange={(value) => setReason(value as AbandonmentReason)}>
          {ABANDONMENT_REASONS.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem value={option} id={`abandon-reason-${option}`} />
              <Label htmlFor={`abandon-reason-${option}`} className="font-normal">
                {t(`admin.abandonmentReason.${option}`)}
              </Label>
            </div>
          ))}
        </RadioGroup>
        {reason === undefined && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('admin.result.abandonReasonRequired')}
          </p>
        )}
      </fieldset>
    </ReasonDialog>
  )
}

/**
 * The reserve list and its lifecycle.
 *
 * The order is the lottery's and is never rearranged. There is no per-row
 * "call this one" button: the only call action is for the next waiting
 * reserve, which the server identifies and the server refuses to deviate
 * from. A button on row 7 would suggest an official could pick row 7, and
 * picking within the order is picking a winner.
 */
function ReserveTable({ draw, result, canOperate, locale, onChanged }: ListProps) {
  const { t } = useTranslation()
  const [calling, setCalling] = useState<DrawReserveDto | undefined>(undefined)
  const [accepting, setAccepting] = useState<DrawReserveDto | undefined>(undefined)
  const [declining, setDeclining] = useState<DrawReserveDto | undefined>(undefined)

  const callAction = useAction(callReserve)
  const acceptAction = useAction(acceptReserve)
  const declineAction = useAction(declineReserve)

  // The next reserve in the order, as the server's own list reports it —
  // found, never chosen.
  const nextWaiting = result.reserves.find((reserve) => reserve.status === 'WAITING')
  // A place is vacant when its winner withdrew and no undeclined reserve holds
  // it. The server decides this again; here it only decides what to offer.
  const vacantPlaces = result.winners.filter(
    (winner) =>
      winner.outcome === 'ABANDONED' &&
      !result.reserves.some(
        (reserve) =>
          reserve.replacesSelectionOrder === winner.selectionOrder && reserve.status !== 'DECLINED',
      ),
  )
  const called = result.reserves.find((reserve) => reserve.status === 'CALLED')

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('admin.result.reservesHint')}</p>

      {canOperate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3">
          {called ? (
            <>
              <span className="text-sm">
                {t('admin.result.awaitingAnswer', {
                  position: formatNumber(called.reservePosition, locale),
                })}
              </span>
              <Button type="button" size="sm" onClick={() => setAccepting(called)}>
                {t('admin.result.acceptReserve')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setDeclining(called)}>
                {t('admin.result.declineReserve')}
              </Button>
            </>
          ) : vacantPlaces.length > 0 && nextWaiting ? (
            <>
              <span className="text-sm">
                {t('admin.result.placeVacant', {
                  order: formatNumber(vacantPlaces[0]?.selectionOrder ?? 0, locale),
                  position: formatNumber(nextWaiting.reservePosition, locale),
                })}
              </span>
              <Button type="button" size="sm" onClick={() => setCalling(nextWaiting)}>
                {t('admin.result.callNext')}
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{t('admin.result.nothingToDo')}</span>
          )}
        </div>
      )}

      <div className="w-full overflow-x-auto rounded-lg border border-border">
        <Table aria-label={t('admin.result.reservesLabel')}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-end">{t('admin.result.reservePosition')}</TableHead>
              <TableHead>{t('admin.applications.reference')}</TableHead>
              <TableHead>{t('admin.applications.entryType')}</TableHead>
              <TableHead className="text-end">{t('admin.applications.participants')}</TableHead>
              <TableHead>{t('admin.result.reserveStatus')}</TableHead>
              <TableHead className="text-end">{t('admin.result.replaces')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.reserves.map((reserve) => (
              <TableRow key={reserve.reservePosition}>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(reserve.reservePosition, locale)}
                </TableCell>
                <TableCell className="font-mono text-sm">{reserve.applicationReference}</TableCell>
                <TableCell>{t(`admin.entryType.${reserve.entryType}`)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(reserve.participantCount, locale)}
                </TableCell>
                <TableCell>
                  <StatusBadge kind="reserve" status={reserve.status} />
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {reserve.replacesSelectionOrder === null
                    ? '—'
                    : formatNumber(reserve.replacesSelectionOrder, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {calling && vacantPlaces[0] && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setCalling(undefined)}
          title={t('admin.result.callTitle')}
          description={t('admin.result.callBody')}
          facts={[
            {
              label: t('admin.result.reservePosition'),
              value: formatNumber(calling.reservePosition, locale),
            },
            { label: t('admin.applications.reference'), value: calling.applicationReference },
            {
              label: t('admin.result.replacesWinner'),
              value: formatNumber(vacantPlaces[0].selectionOrder, locale),
            },
          ]}
          confirmLabel={t('admin.result.callNext')}
          pending={callAction.pending}
          error={callAction.error}
          onConfirm={async () => {
            const place = vacantPlaces[0]
            if (!place) return
            const next = await callAction.run(draw.id, calling.reservePosition, place.selectionOrder)
            if (next) {
              toast.success(t('admin.result.called'))
              setCalling(undefined)
              onChanged(next)
            }
          }}
        />
      )}

      {accepting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAccepting(undefined)}
          title={t('admin.result.acceptTitle')}
          description={t('admin.result.acceptBody')}
          facts={[
            {
              label: t('admin.result.reservePosition'),
              value: formatNumber(accepting.reservePosition, locale),
            },
            { label: t('admin.applications.reference'), value: accepting.applicationReference },
            {
              label: t('admin.applications.entryType'),
              value: t(`admin.entryType.${accepting.entryType}`),
            },
            {
              label: t('admin.applications.participants'),
              value: formatNumber(accepting.participantCount, locale),
            },
          ]}
          confirmLabel={t('admin.result.acceptReserve')}
          pending={acceptAction.pending}
          error={acceptAction.error}
          onConfirm={async () => {
            const next = await acceptAction.run(draw.id, accepting.reservePosition)
            if (next) {
              toast.success(t('admin.result.accepted'))
              setAccepting(undefined)
              onChanged(next)
            }
          }}
        >
          <Alert>
            <AlertTitle>{t('admin.result.acceptConsequenceTitle')}</AlertTitle>
            <AlertDescription>
              {accepting.entryType === 'PAIRED'
                ? t('admin.result.acceptConsequencePaired')
                : t('admin.result.acceptConsequenceSingle')}
            </AlertDescription>
          </Alert>
        </ConfirmDialog>
      )}

      {declining && (
        <ReasonDialog
          open
          onOpenChange={(open) => !open && setDeclining(undefined)}
          title={t('admin.result.declineTitle')}
          description={t('admin.result.declineBody')}
          facts={[
            {
              label: t('admin.result.reservePosition'),
              value: formatNumber(declining.reservePosition, locale),
            },
            { label: t('admin.applications.reference'), value: declining.applicationReference },
          ]}
          reasonLabel={t('admin.result.explanation')}
          submitLabel={t('admin.result.declineReserve')}
          destructive
          pending={declineAction.pending}
          error={declineAction.error}
          onSubmit={async (explanation) => {
            const next = await declineAction.run(draw.id, declining.reservePosition, explanation)
            if (next) {
              toast.success(t('admin.result.declined'))
              setDeclining(undefined)
              onChanged(next)
            }
          }}
        />
      )}
    </div>
  )
}

/**
 * The randomness the draw consumed, one row per selection.
 *
 * Recorded evidence, not a re-enactment: these values were produced by the
 * server's CSPRNG inside the execution transaction. Nothing on this page
 * generates a random number, and nothing replays the selection.
 */
function SelectionEvents({ result, locale }: { result: DrawResultDto; locale: SupportedLocale }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('admin.result.eventsHint')}</p>
      <ScrollArea className="h-80 rounded-lg border border-border">
        <Table aria-label={t('admin.result.eventsLabel')}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-end">{t('admin.result.selectionOrder')}</TableHead>
              <TableHead className="text-end">{t('admin.result.activeTotalWeight')}</TableHead>
              <TableHead className="text-end">{t('admin.result.randomValue')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.events.map((event) => (
              <TableRow key={event.selectionOrder}>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(event.selectionOrder, locale)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(event.activeTotalWeight, locale)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {formatNumber(event.randomValue, locale)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">
        <Badge variant="outline" className="me-2">
          {result.algorithmVersion}
        </Badge>
        {t('admin.result.algorithmHint')}
      </p>
    </div>
  )
}
