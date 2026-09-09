import type {
  ApplicationStatus,
  ApprovalStatus,
  CommuneDrawStatus,
  DrawYearStatus,
  ImportBatchStatus,
  ImportRowStatus,
  ReserveStatus,
  WinnerOutcome,
} from '@hajj-lottery/shared'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/shadcn/badge'

/**
 * Every domain status, rendered the same way everywhere.
 *
 * One table per vocabulary, in one file, because the alternative is each page
 * choosing its own colour for `LOCKED` and an operator learning that green
 * means something different on the draws screen than on the imports screen.
 *
 * Colour is never the message. Each badge renders a translated word, so a
 * screen reader, a monochrome print-out and an operator who cannot distinguish
 * the two greens all get the same information. The variant only makes the
 * severity easier to scan.
 */

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'

const DRAW_YEAR: Record<DrawYearStatus, Variant> = {
  DRAFT: 'outline',
  REGISTRATION_OPEN: 'info',
  REGISTRATION_CLOSED: 'warning',
  ARCHIVED: 'secondary',
}

const COMMUNE_DRAW: Record<CommuneDrawStatus, Variant> = {
  DRAFT: 'outline',
  READY: 'info',
  LOCKED: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'secondary',
}

/**
 * Only `SELECTED` is `success`: being eligible means taking part, not winning,
 * and the two must not look alike on a list somebody scans.
 *
 * `INELIGIBLE` and `NOT_SELECTED` are `secondary`, never `destructive`.
 * Neither is an error or a wrongdoing — one is the rules applied, the other is
 * the ordinary outcome for most applicants — and painting either red would
 * tell an operator that something has gone wrong.
 */
const APPLICATION: Record<ApplicationStatus, Variant> = {
  PENDING: 'outline',
  ELIGIBLE: 'info',
  INELIGIBLE: 'secondary',
  SELECTED: 'success',
  RESERVE: 'warning',
  NOT_SELECTED: 'secondary',
}
const RESERVE: Record<ReserveStatus, Variant> = {
  WAITING: 'info',
  CALLED: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'secondary',
}

/** A place given up is neutral. Withdrawing is not a failure of the winner. */
const WINNER_OUTCOME: Record<WinnerOutcome, Variant> = {
  ACTIVE: 'success',
  ABANDONED: 'secondary',
}

const IMPORT_BATCH: Record<ImportBatchStatus, Variant> = {
  UPLOADED: 'outline',
  VALIDATING: 'info',
  READY_FOR_REVIEW: 'warning',
  REJECTED: 'secondary',
  APPROVED: 'info',
  IMPORTED: 'success',
  FAILED: 'destructive',
}

const IMPORT_ROW: Record<ImportRowStatus, Variant> = {
  VALID: 'success',
  WARNING: 'warning',
  CONFLICT: 'destructive',
  INVALID: 'destructive',
}

const APPROVAL: Record<ApprovalStatus, Variant> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'secondary',
  CANCELLED: 'outline',
}

const VARIANTS = {
  drawYear: DRAW_YEAR,
  communeDraw: COMMUNE_DRAW,
  application: APPLICATION,
  reserve: RESERVE,
  winnerOutcome: WINNER_OUTCOME,
  importBatch: IMPORT_BATCH,
  importRow: IMPORT_ROW,
  approval: APPROVAL,
} as const

export type StatusKind = keyof typeof VARIANTS

export interface StatusBadgeProps {
  kind: StatusKind
  status: string
}

export function StatusBadge({ kind, status }: StatusBadgeProps) {
  const { t } = useTranslation()
  const table = VARIANTS[kind] as Record<string, Variant | undefined>

  return <Badge variant={table[status] ?? 'outline'}>{t(`admin.status.${kind}.${status}`)}</Badge>
}
