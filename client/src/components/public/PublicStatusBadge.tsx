import type {
  PublicApplicationStatus,
  PublicDrawPhase,
  PublicReserveOutcome,
  PublicWinnerOutcome,
} from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Badge, type BadgeVariant } from '../ui'

/**
 * The public vocabularies, as badges.
 *
 * All four are closed unions from `shared`, and all four are rendered by looking
 * the value up rather than by reasoning about it. The client never derives an
 * outcome: if the server says `AWAITING_RESULTS`, that is what appears, and
 * there is no branch anywhere that turns a draw phase plus a publication flag
 * into `SELECTED`. Inferring the answer here would defeat a release gate the
 * whole server-side design exists to hold.
 *
 * Every badge carries **text**, not only a colour. A reader who cannot
 * distinguish amber from emerald — or who is listening to the page rather than
 * looking at it — gets the same information, because the colour is decoration
 * over a translated word rather than the word itself.
 */

const STATUS_VARIANTS: Record<PublicApplicationStatus, BadgeVariant> = {
  SUBMITTED: 'neutral',
  IN_DRAW: 'neutral',
  NOT_ELIGIBLE: 'error',
  AWAITING_RESULTS: 'warning',
  SELECTED: 'success',
  /* Its own colour, because a reserve is neither of the two things beside it:
     they hold an ordered contingency position and may yet be called. */
  RESERVE: 'info',
  NOT_SELECTED: 'neutral',
}

export function ApplicationStatusBadge({ status }: { status: PublicApplicationStatus }) {
  const { t } = useTranslation()
  return <Badge variant={STATUS_VARIANTS[status]}>{t(`public.status.${status}`)}</Badge>
}

const PHASE_VARIANTS: Record<PublicDrawPhase, BadgeVariant> = {
  ACCEPTING: 'success',
  ENTRIES_CLOSED: 'warning',
  DRAWN: 'neutral',
  CANCELLED: 'error',
}

export function DrawPhaseBadge({ phase }: { phase: PublicDrawPhase }) {
  const { t } = useTranslation()
  return <Badge variant={PHASE_VARIANTS[phase]}>{t(`public.phase.${phase}`)}</Badge>
}

/**
 * Whether an original winner still holds the place the draw gave them.
 *
 * `WITHDRAWN` is deliberately *neutral* rather than an error colour. Giving up a
 * place is not a failure and not a disqualification: they were selected by this
 * lottery, they remain an original winner of it, and a red badge beside their
 * reference would read as a judgement on somebody whose circumstances the page
 * says nothing about — and could not, since the reason is never published.
 */
const WINNER_OUTCOME_VARIANTS: Record<PublicWinnerOutcome, BadgeVariant> = {
  ACTIVE: 'success',
  WITHDRAWN: 'neutral',
}

export function WinnerOutcomeBadge({ outcome }: { outcome: PublicWinnerOutcome }) {
  const { t } = useTranslation()
  return <Badge variant={WINNER_OUTCOME_VARIANTS[outcome]}>{t(`public.winnerOutcome.${outcome}`)}</Badge>
}

/**
 * Where one reserve stands.
 *
 * `PROMOTED` is the only one that reads as a win, because it is the only one
 * that is: a waiting reserve holds no place, a called one has been asked and has
 * not answered, and a declined one turned the place down. None of those is a
 * loss either, which is why only the promoted badge is emerald and the rest are
 * informational.
 */
const RESERVE_OUTCOME_VARIANTS: Record<PublicReserveOutcome, BadgeVariant> = {
  WAITING: 'info',
  CALLED: 'warning',
  PROMOTED: 'success',
  DECLINED: 'neutral',
}

export function ReserveOutcomeBadge({ outcome }: { outcome: PublicReserveOutcome }) {
  const { t } = useTranslation()
  return <Badge variant={RESERVE_OUTCOME_VARIANTS[outcome]}>{t(`public.reserveOutcome.${outcome}`)}</Badge>
}
