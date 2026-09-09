import {
  administrativeCommuneDrawTransitions,
  localizedGeoName,
  LOTTERY_ALGORITHM_VERSION,
  totalDrawSelections,
  type CommuneDrawStatus,
  type DrawResultDto,
  type SupportedLocale,
} from '@hajj-lottery/shared'
import { ArrowLeftIcon, MegaphoneIcon, PlayIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AdminPage } from '@/components/admin/AdminPage'
import { ConfirmDialog, FactList } from '@/components/admin/dialogs'
import { DrawLifecycleStepper } from '@/components/admin/DrawLifecycleStepper'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { PoolPanel } from '@/components/admin/PoolPanel'
import { ResultPanel } from '@/components/admin/ResultPanel'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Button } from '@/components/shadcn/button'
import { Skeleton } from '@/components/shadcn/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs'
import { ApiError } from '@/lib/api'
import {
  executeDraw,
  fetchCommuneDraw,
  fetchDrawResult,
  fetchPoolSummary,
  publishResult,
  updateCommuneDraw,
} from '@/lib/admin-api'
import { useAuth } from '@/lib/auth-context'
import { formatDateTime, formatNumber, formatYear } from '@/lib/format'
import { useAction, useAsync } from '@/lib/use-async'

/**
 * One commune's draw, from configuration to publication.
 *
 * The whole operational workflow on one screen, because it is one sequence and
 * an operator following it should not have to hold their place across four
 * pages. What is available at each point comes from the server's own state,
 * never from a step counter this page keeps.
 *
 * Reading is ordinary scoped work — a commune administrator watches their own
 * draw here. Every act that moves it is national: freezing fixes the terms of
 * a lottery, executing is irreversible and excludes the people it selects for
 * life, publishing announces it. Nobody should be able to do any of those to a
 * draw they are themselves subject to, so scoped administrators see this page
 * without the buttons — and the server refuses the requests regardless.
 */
export function AdminCommuneDraw() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { id = '' } = useParams()
  const { user } = useAuth()
  const canOperate = user?.role === 'SUPER_ADMIN'

  const loadDraw = useCallback(() => fetchCommuneDraw(id), [id])
  const draw = useAsync(loadDraw)

  // A pool and a result exist only after their step; a 404 for either is the
  // ordinary answer, not a failure to report.
  const loadPool = useCallback(() => fetchPoolSummary(id).catch(absentOn404), [id])
  const pool = useAsync(loadPool)

  const loadResult = useCallback(() => fetchDrawResult(id).catch(absentOn404), [id])
  const result = useAsync(loadResult)

  const [liveResult, setLiveResult] = useState<DrawResultDto | undefined>(undefined)
  const [executing, setExecuting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [transition, setTransition] = useState<CommuneDrawStatus | undefined>(undefined)

  const executeAction = useAction(executeDraw)
  const publishAction = useAction(publishResult)
  const transitionAction = useAction(updateCommuneDraw)

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link to="/admin/communes">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t('admin.communeDraws.backToList')}
      </Link>
    </Button>
  )

  if (draw.state.status === 'error') {
    return (
      <AdminPage title={t('admin.communeDraws.detailTitle')} action={back}>
        <ErrorNotice error={draw.state.error} onRetry={draw.reload} />
      </AdminPage>
    )
  }

  if (draw.state.status === 'loading') {
    return (
      <AdminPage title={t('admin.communeDraws.detailTitle')} action={back}>
        <Skeleton className="h-72 w-full" />
      </AdminPage>
    )
  }

  const record = draw.state.data
  const currentResult = liveResult ?? (result.state.status === 'ready' ? result.state.data : undefined)
  const frozenPool = pool.state.status === 'ready' ? pool.state.data : undefined
  const published = currentResult?.publishedAt != null
  const expectedSelections = totalDrawSelections(record.allocatedSpots)

  const refreshAll = () => {
    setLiveResult(undefined)
    draw.reload()
    pool.reload()
    result.reload()
  }

  return (
    <AdminPage title={localizedGeoName(record.commune, locale)} action={back}>
      <FactList
        facts={[
          { label: t('geo.wilaya.label'), value: localizedGeoName(record.wilaya, locale) },
          { label: t('admin.draws.year'), value: formatYear(record.drawYear, locale) },
          {
            label: t('admin.communeDraws.allocatedSpots'),
            value: formatNumber(record.allocatedSpots, locale),
          },
          {
            label: t('admin.pool.expectedSelections'),
            value: formatNumber(expectedSelections, locale),
          },
          {
            label: t('admin.communeDraws.status'),
            value: <StatusBadge kind="communeDraw" status={record.status} />,
          },
          {
            label: t('admin.result.publication'),
            value: published
              ? formatDateTime(currentResult?.publishedAt ?? '', locale)
              : t('admin.result.notPublished'),
          },
        ]}
      />

      <DrawLifecycleStepper status={record.status} published={published} />

      {canOperate && administrativeCommuneDrawTransitions(record.status).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('admin.communeDraws.moveTo')}</span>
          {administrativeCommuneDrawTransitions(record.status).map((next) => (
            <Button
              key={next}
              type="button"
              size="sm"
              variant={next === 'CANCELLED' ? 'outline' : 'secondary'}
              onClick={() => setTransition(next)}
            >
              {t(`admin.status.communeDraw.${next}`)}
            </Button>
          ))}
        </div>
      )}

      <Tabs defaultValue={currentResult ? 'result' : 'pool'}>
        <TabsList>
          <TabsTrigger value="pool">{t('admin.communeDraws.tabs.pool')}</TabsTrigger>
          <TabsTrigger value="execution">{t('admin.communeDraws.tabs.execution')}</TabsTrigger>
          <TabsTrigger value="result" disabled={!currentResult}>
            {t('admin.communeDraws.tabs.result')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pool" className="pt-4">
          <PoolPanel
            draw={record}
            pool={frozenPool}
            poolLoading={pool.state.status === 'loading'}
            canFreeze={canOperate && record.status === 'READY'}
            onChanged={refreshAll}
          />
        </TabsContent>

        <TabsContent value="execution" className="pt-4">
          {currentResult ? (
            <Alert>
              <AlertTitle>{t('admin.execution.alreadyRunTitle')}</AlertTitle>
              <AlertDescription>
                {t('admin.execution.alreadyRunBody', {
                  at: formatDateTime(currentResult.completedAt, locale),
                })}
              </AlertDescription>
            </Alert>
          ) : record.status !== 'LOCKED' ? (
            <Alert>
              <AlertTitle>{t('admin.execution.notLockedTitle')}</AlertTitle>
              <AlertDescription>{t('admin.execution.notLockedBody')}</AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertTitle>{t('admin.execution.readyTitle')}</AlertTitle>
                <AlertDescription>{t('admin.execution.readyBody')}</AlertDescription>
              </Alert>
              {canOperate ? (
                <div>
                  <Button type="button" onClick={() => setExecuting(true)}>
                    <PlayIcon aria-hidden="true" />
                    {t('admin.execution.execute')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('admin.execution.nationalOnly')}</p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="result" className="pt-4">
          {result.state.status === 'error' ? (
            <ErrorNotice error={result.state.error} onRetry={result.reload} />
          ) : currentResult ? (
            <div className="flex flex-col gap-4">
              {canOperate && !published && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                  <span className="text-sm">{t('admin.result.unpublishedHint')}</span>
                  <Button type="button" size="sm" onClick={() => setPublishing(true)}>
                    <MegaphoneIcon aria-hidden="true" />
                    {t('admin.result.publish')}
                  </Button>
                </div>
              )}
              {published && (
                <Alert>
                  <AlertTitle>{t('admin.result.publishedTitle')}</AlertTitle>
                  <AlertDescription>{t('admin.result.publishedBody')}</AlertDescription>
                </Alert>
              )}
              <ResultPanel
                draw={record}
                result={currentResult}
                canOperate={canOperate}
                onChanged={setLiveResult}
              />
            </div>
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </TabsContent>
      </Tabs>

      {/*
        Execution. The dialog states every input the server will use and says,
        in words, that one selected application occupies one position — so
        nobody reads "12 places, 24 selections" as 24 winners. Nothing about
        the outcome is decided here, and no value from this page reaches the
        request: the endpoint takes no body at all.
      */}
      <ConfirmDialog
        open={executing}
        onOpenChange={setExecuting}
        title={t('admin.execution.confirmTitle')}
        description={t('admin.execution.confirmBody')}
        facts={[
          { label: t('geo.commune.label'), value: localizedGeoName(record.commune, locale) },
          { label: t('admin.draws.year'), value: formatYear(record.drawYear, locale) },
          {
            label: t('admin.communeDraws.allocatedSpots'),
            value: formatNumber(record.allocatedSpots, locale),
          },
          {
            label: t('admin.pool.entries'),
            value: frozenPool ? formatNumber(frozenPool.entryCount, locale) : '—',
          },
          {
            label: t('admin.pool.totalWeight'),
            value: frozenPool ? formatNumber(frozenPool.totalWeight, locale) : '—',
          },
          // The identifier this draw will record. Fixed, never "latest": a
          // concluded result must forever name the implementation it ran under.
          { label: t('admin.result.algorithmVersion'), value: LOTTERY_ALGORITHM_VERSION },
          {
            label: t('admin.pool.expectedSelections'),
            value: formatNumber(expectedSelections, locale),
          },
        ]}
        confirmLabel={t('admin.execution.execute')}
        destructive
        pending={executeAction.pending}
        error={executeAction.error}
        onConfirm={async () => {
          const executed = await executeAction.run(record.id)
          if (executed) {
            toast.success(t('admin.execution.executed'))
            setExecuting(false)
            refreshAll()
          }
        }}
      >
        <Alert variant="destructive">
          <AlertTitle>{t('admin.execution.warningTitle')}</AlertTitle>
          <AlertDescription>
            {t('admin.execution.warningBody', {
              winners: formatNumber(record.allocatedSpots, locale),
              reserves: formatNumber(record.allocatedSpots, locale),
              total: formatNumber(expectedSelections, locale),
            })}
          </AlertDescription>
        </Alert>
        {frozenPool && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('admin.pool.snapshotHash')}</span>
            <code className="block overflow-x-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
              {frozenPool.snapshotHash}
            </code>
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={publishing}
        onOpenChange={setPublishing}
        title={t('admin.result.publishTitle')}
        description={t('admin.result.publishBody')}
        facts={[
          { label: t('geo.commune.label'), value: localizedGeoName(record.commune, locale) },
          { label: t('admin.draws.year'), value: formatYear(record.drawYear, locale) },
          {
            label: t('admin.result.winners'),
            value: currentResult ? formatNumber(currentResult.winnerCount, locale) : '—',
          },
          {
            label: t('admin.result.reserves'),
            value: currentResult ? formatNumber(currentResult.reserveCount, locale) : '—',
          },
        ]}
        confirmLabel={t('admin.result.publish')}
        pending={publishAction.pending}
        error={publishAction.error}
        onConfirm={async () => {
          const outcome = await publishAction.run(record.id)
          if (outcome) {
            toast.success(
              outcome.alreadyPublished ? t('admin.result.alreadyPublished') : t('admin.result.published'),
            )
            setPublishing(false)
            refreshAll()
          }
        }}
      />

      {transition && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setTransition(undefined)}
          title={t('admin.communeDraws.confirmTransitionTitle')}
          description={t(`admin.communeDraws.confirmTransitionBody.${transition}`)}
          facts={[
            { label: t('geo.commune.label'), value: localizedGeoName(record.commune, locale) },
            { label: t('admin.draws.from'), value: t(`admin.status.communeDraw.${record.status}`) },
            { label: t('admin.draws.to'), value: t(`admin.status.communeDraw.${transition}`) },
          ]}
          confirmLabel={t(`admin.status.communeDraw.${transition}`)}
          destructive={transition === 'CANCELLED' || transition === 'LOCKED'}
          pending={transitionAction.pending}
          error={transitionAction.error}
          onConfirm={async () => {
            if (await transitionAction.run(record.id, { status: transition })) {
              toast.success(t('admin.communeDraws.transitioned'))
              setTransition(undefined)
              refreshAll()
            }
          }}
        />
      )}
    </AdminPage>
  )
}

/**
 * A 404 here means "not yet", not "something went wrong".
 *
 * Only that one status is swallowed — a 403 or a 500 still surfaces, because
 * treating those as absence would hide a real refusal behind an empty panel.
 */
function absentOn404(error: unknown): undefined {
  if (error instanceof ApiError && error.status === 404) return undefined
  throw error
}
