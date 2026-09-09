import { localizedGeoName, type SupportedLocale } from '@hajj-lottery/shared'
import { ArrowLeftIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { AdminPage } from '@/components/admin/AdminPage'
import { ErrorNotice } from '@/components/admin/ErrorNotice'
import { FactList } from '@/components/admin/dialogs'
import { StatusBadge } from '@/components/admin/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/alert'
import { Badge } from '@/components/shadcn/badge'
import { Button } from '@/components/shadcn/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/shadcn/card'
import { Separator } from '@/components/shadcn/separator'
import { Skeleton } from '@/components/shadcn/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shadcn/tabs'
import { fetchApplication, fetchApplicationEligibility, fetchApplicationWeight } from '@/lib/admin-api'
import { formatDate, formatDateTime, formatNumber, formatYear } from '@/lib/format'
import { useAsync } from '@/lib/use-async'

/**
 * One application, as an administrator sees it.
 *
 * Three tabs for three questions with three different authorities. The
 * overview is the application record; eligibility is the rules engine's
 * verdict, re-evaluated on request and never stored here; the weight is the
 * priority engine's, and reading it deliberately does not freeze it.
 *
 * The applicants carry a name, a date of birth and the last four digits of a
 * national ID — enough to confirm the person at the counter is the person on
 * the application. The unabridged identity is a separate, national screen.
 */
export function AdminApplicationDetail() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { id = '' } = useParams()

  const loadApplication = useCallback(() => fetchApplication(id), [id])
  const { state, reload } = useAsync(loadApplication)

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link to="/admin/applications">
        <ArrowLeftIcon className="size-4 rtl:rotate-180" aria-hidden="true" />
        {t('admin.applications.backToList')}
      </Link>
    </Button>
  )

  if (state.status === 'error') {
    return (
      <AdminPage title={t('admin.applications.detailTitle')} action={back}>
        <ErrorNotice error={state.error} onRetry={reload} />
      </AdminPage>
    )
  }

  if (state.status === 'loading') {
    return (
      <AdminPage title={t('admin.applications.detailTitle')} action={back}>
        <Skeleton className="h-64 w-full" />
      </AdminPage>
    )
  }

  const application = state.data

  return (
    <AdminPage title={application.applicationReference} action={back}>
      <FactList
        facts={[
          { label: t('admin.applications.drawYear'), value: formatYear(application.drawYear, locale) },
          { label: t('geo.wilaya.label'), value: localizedGeoName(application.wilaya, locale) },
          { label: t('geo.commune.label'), value: localizedGeoName(application.commune, locale) },
          {
            label: t('admin.applications.entryType'),
            value: t(`admin.entryType.${application.entryType}`),
          },
          {
            label: t('admin.applications.status'),
            value: <StatusBadge kind="application" status={application.status} />,
          },
          {
            label: t('admin.applications.submitted'),
            value: formatDateTime(application.createdAt, locale),
          },
        ]}
      />

      <Tabs defaultValue="applicants">
        <TabsList>
          <TabsTrigger value="applicants">{t('admin.applications.tabs.applicants')}</TabsTrigger>
          <TabsTrigger value="eligibility">{t('admin.applications.tabs.eligibility')}</TabsTrigger>
          <TabsTrigger value="weight">{t('admin.applications.tabs.weight')}</TabsTrigger>
        </TabsList>

        <TabsContent value="applicants" className="pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            {application.applicants.map((applicant) => (
              <Card key={applicant.participantId}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span>{applicant.fullName}</span>
                    <Badge variant="outline">{t(`admin.applicantRole.${applicant.role}`)}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('admin.applications.nationalId')}</span>
                    {/* Only the last four digits ever reach this screen. */}
                    <span className="font-mono">••••{applicant.nationalIdSuffix}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('admin.applications.dob')}</span>
                    <span>{formatDate(applicant.dob, locale)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{t('admin.applications.hasWonHajj')}</span>
                    {applicant.hasWonHajj ? (
                      <Badge variant="warning">{t('admin.applications.pastWinner')}</Badge>
                    ) : (
                      <Badge variant="outline">{t('admin.applications.noPastWin')}</Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="eligibility" className="pt-4">
          <EligibilityPanel applicationId={id} />
        </TabsContent>

        <TabsContent value="weight" className="pt-4">
          <WeightPanel applicationId={id} />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}

/**
 * The eligibility engine's verdict.
 *
 * `storedStatus` and the fresh evaluation are shown side by side rather than
 * merged. They can legitimately disagree — a record written last month against
 * facts that have since changed — and collapsing them would hide exactly the
 * disagreement an administrator opened this tab to find.
 */
function EligibilityPanel({ applicationId }: { applicationId: string }) {
  const { t } = useTranslation()
  const load = useCallback(() => fetchApplicationEligibility(applicationId), [applicationId])
  const { state, reload } = useAsync(load)

  if (state.status === 'loading') return <Skeleton className="h-40 w-full" />
  if (state.status === 'error') return <ErrorNotice error={state.error} onRetry={reload} />

  const { evaluation, storedStatus } = state.data

  return (
    <div className="flex flex-col gap-4">
      <FactList
        facts={[
          {
            label: t('admin.applications.storedStatus'),
            value: <StatusBadge kind="application" status={storedStatus} />,
          },
          {
            label: t('admin.applications.currentEvaluation'),
            value: <StatusBadge kind="application" status={evaluation.status} />,
          },
        ]}
      />

      {evaluation.reasons.length > 0 && (
        <Alert variant={evaluation.eligible ? 'default' : 'destructive'}>
          <AlertTitle>{t('admin.applications.reasons')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 ps-5">
              {evaluation.reasons.map((reason) => (
                <li key={reason}>{t(`admin.eligibilityReason.${reason}`, { defaultValue: reason })}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {storedStatus !== evaluation.status && (
        <Alert variant="destructive">
          <AlertTitle>{t('admin.applications.evaluationDiffers')}</AlertTitle>
          <AlertDescription>{t('admin.applications.evaluationDiffersHint')}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/**
 * The priority engine's weight.
 *
 * The per-applicant breakdown is SUPER_ADMIN-only and arrives as `null` for
 * everyone else — a person's history spans communes, so a scoped
 * administrator reading it would be reading another territory's ledger. The
 * absence is stated rather than left as a blank row.
 */
function WeightPanel({ applicationId }: { applicationId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const load = useCallback(() => fetchApplicationWeight(applicationId), [applicationId])
  const { state, reload } = useAsync(load)

  if (state.status === 'loading') return <Skeleton className="h-40 w-full" />
  if (state.status === 'error') return <ErrorNotice error={state.error} onRetry={reload} />

  const weight = state.data

  return (
    <div className="flex flex-col gap-4">
      <FactList
        facts={[
          {
            label: t('admin.applications.calculatedWeight'),
            value: formatNumber(weight.calculatedWeight, locale),
          },
          {
            label: t('admin.applications.frozenWeight'),
            value:
              weight.frozenWeight === null
                ? t('admin.applications.notFrozen')
                : formatNumber(weight.frozenWeight, locale),
          },
          { label: t('admin.applications.weightRule'), value: t(`admin.weightRule.${weight.rule}`) },
          ...(weight.breakdown
            ? [
                {
                  label: t('admin.applications.primaryWeight'),
                  value: formatNumber(weight.breakdown.primaryWeight, locale),
                },
                {
                  label: t('admin.applications.secondaryWeight'),
                  value:
                    weight.breakdown.secondaryWeight === null
                      ? '—'
                      : formatNumber(weight.breakdown.secondaryWeight, locale),
                },
              ]
            : []),
        ]}
      />

      {!weight.breakdown && (
        <p className="text-sm text-muted-foreground">{t('admin.applications.breakdownWithheld')}</p>
      )}

      {weight.frozenWeight !== null && !weight.matchesFrozen && (
        <Alert variant="destructive">
          <AlertTitle>{t('admin.applications.weightDiffers')}</AlertTitle>
          <AlertDescription>{t('admin.applications.weightDiffersHint')}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
