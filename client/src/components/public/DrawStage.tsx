import {
  localizedGeoName,
  type PublicDrawStatusDto,
  type PublicResultDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePrefersReducedMotion } from '../../lib/document'
import type { DrawWatchPhase } from '../../lib/draw-watch'
import { formatNumber, formatYear } from '../../lib/format'
import { Alert, Card } from '../ui'
import { WinnerList } from './WinnerList'

/**
 * The public draw visualiser.
 *
 * **This component performs no lottery logic of any kind.** It does not select,
 * sample, weight, shuffle or randomise anything, it holds no candidate list, it
 * calls no random number generator, and it could not — everything it renders
 * arrives from the server already decided. The draw happens once, inside a
 * single database transaction, using randomness from the operating system's
 * CSPRNG, and by the time any of it is public it is finished, immutable by
 * database trigger, and deliberately released by a named administrator. A
 * browser has no part in it and must not appear to.
 *
 * That constraint shapes the visual design as much as the code. The reveal is
 * paced, not animated into suspense; there is no spinning wheel, no
 * slot-machine, no cascade of rejected names, no flashing. Those graphics all
 * say the same untrue thing — that chance is being resolved in front of you —
 * and on an official government lottery that is not a stylistic choice, it is a
 * misrepresentation. What is being shown is a record, and it should look like
 * one being read out.
 *
 * The pacing exists only so a list of a hundred references does not arrive as a
 * wall, and it is decoration: `prefers-reduced-motion` renders the whole list
 * at once, and every number on screen is also present as text. Nothing about
 * the result requires seeing it move.
 */

export interface DrawStageProps {
  phase: DrawWatchPhase
  status: PublicDrawStatusDto | undefined
  result: PublicResultDto | undefined
  isResultLoading: boolean
}

export function DrawStage({ phase, status, result, isResultLoading }: DrawStageProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  return (
    <div className="flex flex-col gap-6">
      <StageHeader phase={phase} status={status} />

      {phase === 'WAITING' && status && <WaitingStage status={status} />}
      {phase === 'DRAWING' && status && <DrawingStage status={status} />}
      {phase === 'COMPLETED' && <CompletedStage result={result} isLoading={isResultLoading} />}
      {phase === 'UNAVAILABLE' && (
        <Alert variant="info" title={t('public.draw.unavailableTitle')}>
          {t('public.draw.unavailableBody')}
        </Alert>
      )}

      {status && (
        <p className="text-xs text-stone-500">
          {t('public.draw.authorityNote', {
            commune: localizedGeoName(status.commune, locale),
            year: formatYear(status.drawYear, locale),
          })}
        </p>
      )}
    </div>
  )
}

/**
 * The one line a screen reader announces when the state changes.
 *
 * `role="status"` rather than `alert`: this is progress, not a warning. It is
 * plain text carrying the whole state, so somebody who cannot see the stage
 * below is told the same thing at the same time, and nothing about the result
 * is available only through the visual treatment.
 */
function StageHeader({ phase, status }: { phase: DrawWatchPhase; status: PublicDrawStatusDto | undefined }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  const announcement = status
    ? t(`public.draw.announce.${phase}`, {
        commune: localizedGeoName(status.commune, locale),
        wilaya: localizedGeoName(status.wilaya, locale),
        year: formatYear(status.drawYear, locale),
      })
    : t('public.draw.announce.UNAVAILABLE_NO_PLACE')

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-stone-200 bg-white px-6 py-5 text-center"
    >
      <p className="text-xs font-medium uppercase tracking-widest text-stone-500">
        {t(`public.draw.state.${phase}`)}
      </p>
      <p className="mt-2 text-lg font-semibold text-stone-900">{announcement}</p>
    </div>
  )
}

function WaitingStage({ status }: { status: PublicDrawStatusDto }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale

  return (
    <Card title={t('public.draw.waitingTitle')} description={t('public.draw.waitingBody')}>
      <dl className="grid gap-4 sm:grid-cols-2">
        {/* Allocated places is configuration a commune publishes anyway — how
            many pilgrimage places it has this year. How many people have
            applied for them is not on this page and is not on the API: during
            intake that number is live and, in a small commune, close to
            identifying. */}
        <Statistic label={t('public.results.allocatedSpots')}>
          {formatNumber(status.allocatedSpots, locale)}
        </Statistic>
        <Statistic label={t('public.drawStatus.registration')}>
          {status.registrationOpen
            ? t('public.drawStatus.registrationOpen')
            : t('public.drawStatus.registrationClosed')}
        </Statistic>
      </dl>
    </Card>
  )
}

/**
 * Drawn, not yet announced.
 *
 * The honest content of this state is small, and it is stated rather than
 * dressed up. There is no progress bar, because there is no progress to report:
 * the selection was one transaction that either happened or did not, the server
 * exposes no per-selection events, and a bar filling up would be an animation
 * of nothing. The winner count is deliberately absent — the API returns null
 * for it until publication, which is the release gate doing its job.
 */
function DrawingStage({ status }: { status: PublicDrawStatusDto }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const reducedMotion = usePrefersReducedMotion()

  return (
    <Card title={t('public.draw.drawingTitle')} description={t('public.draw.drawingBody')}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full bg-primary-700 ${reducedMotion ? '' : 'animate-pulse'}`}
        />
        <p className="text-sm text-stone-700">{t('public.draw.awaitingPublication')}</p>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <Statistic label={t('public.results.allocatedSpots')}>
          {formatNumber(status.allocatedSpots, locale)}
        </Statistic>
        <Statistic label={t('public.results.winnerCount')}>{t('public.draw.notYetAnnounced')}</Statistic>
      </dl>
    </Card>
  )
}

/** How long between one revealed row and the next, when motion is welcome. */
const REVEAL_INTERVAL_MS = 220

function CompletedStage({ result, isLoading }: { result: PublicResultDto | undefined; isLoading: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const reducedMotion = usePrefersReducedMotion()

  const total = result?.winners.length ?? 0
  const [revealed, setRevealed] = useState(0)

  // The reveal is paced per result, and a *different* result restarts it. The
  // pool hash identifies one: it is the commitment to the frozen input the draw
  // ran against, so two results can share it only by being the same result.
  //
  // Reset during render rather than from inside the effect (React's documented
  // pattern for adjusting state when a prop changes) — resetting in the effect
  // would render one frame of the previous commune's rows under the new
  // heading before correcting itself.
  const [pacedFor, setPacedFor] = useState<string | undefined>(undefined)
  if (result && pacedFor !== result.poolHash) {
    setPacedFor(result.poolHash)
    setRevealed(0)
  }

  // Reduced motion is applied during render too, so the full list is present on
  // the very first frame that has one. Correcting it in an effect would flash
  // an empty table at exactly the visitor who asked for less movement.
  const visibleCount = reducedMotion ? total : revealed

  useEffect(() => {
    if (reducedMotion || total === 0) return

    const timer = window.setInterval(() => {
      setRevealed((count) => {
        if (count >= total) {
          window.clearInterval(timer)
          return total
        }
        return count + 1
      })
    }, REVEAL_INTERVAL_MS)

    return () => {
      window.clearInterval(timer)
    }
    // Re-paces only when a different result arrives, never on a re-render:
    // re-running the reveal because a parent updated would restart the list
    // under somebody halfway through reading it.
  }, [pacedFor, total, reducedMotion])

  if (isLoading) {
    return (
      <Card title={t('public.draw.completedTitle')}>
        <p className="text-sm text-stone-600">{t('common.loading')}</p>
      </Card>
    )
  }

  if (!result) {
    // Published according to the status endpoint, but the result itself did not
    // load. Says so plainly rather than filling the space with anything.
    return (
      <Alert variant="info" title={t('public.draw.completedTitle')}>
        {t('public.draw.resultUnavailable')}
      </Alert>
    )
  }

  return (
    <Card title={t('public.draw.completedTitle')} description={t('public.draw.completedBody')}>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Statistic label={t('public.results.allocatedSpots')}>
          {formatNumber(result.allocatedSpots, locale)}
        </Statistic>
        <Statistic label={t('public.results.winnerCount')}>
          {formatNumber(result.winnerCount, locale)}
        </Statistic>
        <Statistic label={t('public.results.winningParticipantCount')}>
          {formatNumber(result.winningParticipantCount, locale)}
        </Statistic>
      </dl>

      <div className="mt-6">
        {/* The order is `selection_order` exactly as the draw persisted it.
            Pacing the reveal changes when a row appears and nothing else — no
            row is reordered, withheld or chosen here. */}
        <WinnerList winners={result.winners} visibleCount={visibleCount} />
      </div>

      {visibleCount < total && (
        <p className="mt-3 text-sm text-stone-600" role="status" aria-live="polite">
          {t('public.draw.revealing', { revealed: visibleCount, total })}
        </p>
      )}
    </Card>
  )
}

function Statistic({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-stone-500">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{children}</dd>
    </div>
  )
}
