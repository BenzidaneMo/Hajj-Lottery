import type { PublicApplicationStatus, PublicDrawPhase } from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Badge, type BadgeVariant } from '../ui'

/**
 * The two public vocabularies, as badges.
 *
 * Both are closed unions from `shared`, and both are rendered by looking the
 * value up rather than by reasoning about it. The client never derives an
 * outcome: if the server says `AWAITING_RESULTS`, that is what appears, and
 * there is no branch anywhere that turns a draw phase plus a publication flag
 * into `SELECTED`. Inferring the answer here would defeat a release gate the
 * whole server-side design exists to hold.
 */

const STATUS_VARIANTS: Record<PublicApplicationStatus, BadgeVariant> = {
  SUBMITTED: 'neutral',
  IN_DRAW: 'neutral',
  NOT_ELIGIBLE: 'error',
  AWAITING_RESULTS: 'warning',
  SELECTED: 'success',
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
