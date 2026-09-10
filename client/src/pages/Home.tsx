import { MapPinIcon, TrophyIcon, UserPlusIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { PageSection } from '../components/public/PageSection'
import { Alert, Badge, Button, Card, Skeleton } from '../components/ui'
import { useRegistrationWindow } from '../lib/applications'

const STEPS = [
  { icon: UserPlusIcon, titleKey: 'home.steps.register.title', bodyKey: 'home.steps.register.body' },
  { icon: MapPinIcon, titleKey: 'home.steps.draw.title', bodyKey: 'home.steps.draw.body' },
  { icon: TrophyIcon, titleKey: 'home.steps.results.title', bodyKey: 'home.steps.results.body' },
] as const

/**
 * The front door: what this service is, who it is for, and the three things a
 * citizen can do from here.
 *
 * The registration window shown below the headline is read from the same
 * endpoint `/register` itself uses (`useRegistrationWindow`) — it is a
 * courtesy so a visitor knows before they click, not a second source of
 * truth, and `/register` re-checks it regardless.
 */
export function Home() {
  const { t } = useTranslation()
  const { data: window_, isLoading } = useRegistrationWindow()

  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col items-start gap-6 rounded-2xl border border-primary-100 bg-primary-50/60 px-6 py-10 sm:px-10 sm:py-14">
        <Badge variant="neutral">{t('app.name')}</Badge>
        <div className="flex flex-col gap-4">
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            {t('home.title')}
          </h1>
          <p className="max-w-2xl text-base text-stone-600 sm:text-lg">{t('home.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link to="/register">{t('home.cta.register')}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/application-status">{t('home.cta.checkStatus')}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/winners">{t('home.cta.viewResults')}</Link>
          </Button>
        </div>

        <div className="w-full max-w-md">
          {isLoading ? (
            <Skeleton className="h-14 w-full rounded-lg" />
          ) : window_ ? (
            <Alert variant={window_.isOpen ? 'success' : 'info'}>
              {window_.isOpen ? t('home.status.open', { year: window_.drawYear }) : t('home.status.closed')}
            </Alert>
          ) : null}
        </div>
      </section>

      <PageSection
        id="how-it-works"
        eyebrow={t('home.howItWorks.eyebrow')}
        title={t('home.howItWorks.title')}
        description={t('home.howItWorks.description')}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <Card key={step.titleKey}>
              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                  <step.icon aria-hidden="true" className="size-4" />
                </span>
                <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  {t('home.howItWorks.step', { number: index + 1 })}
                </span>
              </div>
              <h3 className="mt-3 text-base font-semibold text-stone-900">{t(step.titleKey)}</h3>
              <p className="mt-1 text-sm text-stone-600">{t(step.bodyKey)}</p>
            </Card>
          ))}
        </div>
      </PageSection>
    </div>
  )
}
