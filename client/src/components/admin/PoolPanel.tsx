import {
  localizedGeoName,
  totalDrawSelections,
  type CommuneDrawDto,
  type DrawPoolSummaryDto,
  type PoolValidationDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { CheckCircle2Icon, LockIcon, ShieldAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { Skeleton } from '@/components/shadcn/skeleton'
import { freezePool, validatePool } from '@/lib/admin-api'
import { formatDateTime, formatNumber, formatYear } from '@/lib/format'
import { useAction } from '@/lib/use-async'

import { ConfirmDialog, FactList } from './dialogs'
import { ErrorNotice } from './ErrorNotice'

/**
 * The draw's input: checking it, and closing it.
 *
 * Every number on this panel is the server's. Nothing here recomputes a
 * weight, counts an eligible application or decides how many selections a
 * commune needs — `totalDrawSelections` is a shared constant expressing that N
 * places need 2N selections, not a calculation this screen performs on data it
 * fetched.
 *
 * Validation and freezing are deliberately separate acts. Validation writes
 * nothing, can be run as often as anybody likes, and reports *every* blocker
 * rather than stopping at the first. Freezing fixes the terms of a lottery
 * permanently, and there is no unlock — for anybody, by any route.
 */

export interface PoolPanelProps {
  draw: CommuneDrawDto
  /** The frozen pool, if the draw has one. */
  pool: DrawPoolSummaryDto | undefined
  poolLoading: boolean
  canFreeze: boolean
  onChanged: () => void
}

export function PoolPanel({ draw, pool, poolLoading, canFreeze, onChanged }: PoolPanelProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const [validation, setValidation] = useState<PoolValidationDto | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)

  const validateAction = useAction(validatePool)
  const freezeAction = useAction(freezePool)

  if (poolLoading) return <Skeleton className="h-56 w-full" />

  if (pool) return <FrozenPool pool={pool} locale={locale} />

  const expectedSelections = totalDrawSelections(draw.allocatedSpots)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t('admin.pool.validateTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('admin.pool.validateBody')}</p>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={validateAction.pending}
              onClick={async () => {
                const result = await validateAction.run(draw.id)
                if (result) setValidation(result)
              }}
            >
              {validateAction.pending ? t('admin.actions.working') : t('admin.pool.validate')}
            </Button>
          </div>
          {validateAction.error !== undefined && <ErrorNotice error={validateAction.error} />}
        </CardContent>
      </Card>

      {validation && <ValidationSummary validation={validation} locale={locale} />}

      {canFreeze && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <LockIcon className="size-4" aria-hidden="true" />
              {t('admin.pool.freezeTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('admin.pool.freezeBody')}</p>
            <div>
              <Button type="button" onClick={() => setConfirming(true)}>
                {t('admin.pool.freeze')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('admin.pool.confirmFreezeTitle')}
        description={t('admin.pool.confirmFreezeBody')}
        facts={[
          { label: t('geo.commune.label'), value: localizedGeoName(draw.commune, locale) },
          { label: t('admin.draws.year'), value: formatYear(draw.drawYear, locale) },
          {
            label: t('admin.communeDraws.allocatedSpots'),
            value: formatNumber(draw.allocatedSpots, locale),
          },
          {
            label: t('admin.pool.entries'),
            value: validation ? formatNumber(validation.applicationCount, locale) : '—',
          },
          {
            label: t('admin.pool.totalWeight'),
            value: validation ? formatNumber(validation.totalWeight, locale) : '—',
          },
          {
            label: t('admin.pool.expectedSelections'),
            value: formatNumber(expectedSelections, locale),
          },
        ]}
        confirmLabel={t('admin.pool.freeze')}
        destructive
        pending={freezeAction.pending}
        error={freezeAction.error}
        onConfirm={async () => {
          const frozen = await freezeAction.run(draw.id)
          if (frozen) {
            toast.success(frozen.alreadyFrozen ? t('admin.pool.alreadyFrozen') : t('admin.pool.frozen'))
            setConfirming(false)
            onChanged()
          }
        }}
      >
        <Alert>
          <AlertTitle>{t('admin.pool.selectionBreakdown')}</AlertTitle>
          <AlertDescription>
            {t('admin.pool.selectionBreakdownBody', {
              winners: formatNumber(draw.allocatedSpots, locale),
              reserves: formatNumber(draw.allocatedSpots, locale),
              total: formatNumber(expectedSelections, locale),
            })}
          </AlertDescription>
        </Alert>
      </ConfirmDialog>
    </div>
  )
}

/**
 * The validation verdict.
 *
 * Passed and blocked are separate statements, not two shades of the same
 * banner: an operator scanning this must never mistake "ready, with notes" for
 * "cannot proceed". Every blocker is listed — the server reports them all
 * rather than stopping at the first, and hiding the rest behind "and 4 more"
 * would send somebody round the loop once per problem.
 */
function ValidationSummary({
  validation,
  locale,
}: {
  validation: PoolValidationDto
  locale: SupportedLocale
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3">
      <Alert variant={validation.ready ? 'default' : 'destructive'}>
        {validation.ready ? <CheckCircle2Icon aria-hidden="true" /> : <ShieldAlertIcon aria-hidden="true" />}
        <AlertTitle>
          {validation.ready ? t('admin.pool.passedTitle') : t('admin.pool.blockedTitle')}
        </AlertTitle>
        <AlertDescription>
          {validation.ready ? t('admin.pool.passedBody') : t('admin.pool.blockedBody')}
        </AlertDescription>
      </Alert>

      <FactList
        facts={[
          {
            label: t('admin.pool.eligibleApplications'),
            value: formatNumber(validation.applicationCount, locale),
          },
          { label: t('admin.pool.totalWeight'), value: formatNumber(validation.totalWeight, locale) },
          {
            label: t('admin.communeDraws.allocatedSpots'),
            value: formatNumber(validation.allocatedSpots, locale),
          },
          {
            label: t('admin.pool.expectedSelections'),
            value: formatNumber(totalDrawSelections(validation.allocatedSpots), locale),
          },
          { label: t('admin.pool.validatedAt'), value: formatDateTime(validation.validatedAt, locale) },
        ]}
      />

      {validation.blockers.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {t('admin.pool.blockers', { total: formatNumber(validation.blockers.length, locale) })}
          </h3>
          <ul className="flex flex-col gap-2">
            {validation.blockers.map((blocker, index) => (
              <li
                key={`${blocker.code}-${blocker.applicationReference ?? index}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <Badge variant="destructive">{t(`admin.poolBlocker.${blocker.code}`)}</Badge>
                {blocker.applicationReference && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {blocker.applicationReference}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** A frozen pool: what the lottery will read, and the hash that identifies it. */
function FrozenPool({ pool, locale }: { pool: DrawPoolSummaryDto; locale: SupportedLocale }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <LockIcon aria-hidden="true" />
        <AlertTitle>{t('admin.pool.frozenTitle')}</AlertTitle>
        {/* There is no unlock, and no button for one. */}
        <AlertDescription>{t('admin.pool.frozenBody')}</AlertDescription>
      </Alert>

      <FactList
        facts={[
          { label: t('admin.pool.entries'), value: formatNumber(pool.entryCount, locale) },
          { label: t('admin.pool.totalWeight'), value: formatNumber(pool.totalWeight, locale) },
          {
            label: t('admin.communeDraws.allocatedSpots'),
            value: formatNumber(pool.allocatedSpots, locale),
          },
          {
            label: t('admin.pool.expectedSelections'),
            value: formatNumber(totalDrawSelections(pool.allocatedSpots), locale),
          },
          { label: t('admin.pool.frozenAt'), value: formatDateTime(pool.frozenAt, locale) },
        ]}
      />

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t('admin.pool.snapshotHash')}</span>
        <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
          {pool.snapshotHash}
        </code>
        {/* Worth stating on the screen an operator reads it from. */}
        <p className="text-xs text-muted-foreground">{t('admin.pool.snapshotHashHint')}</p>
      </div>
    </div>
  )
}
