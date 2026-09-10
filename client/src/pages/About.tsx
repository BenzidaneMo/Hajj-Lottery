import {
  ArchiveIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  GlobeIcon,
  KeySquareIcon,
  ListOrderedIcon,
  LockIcon,
  MapPinIcon,
  ScaleIcon,
  SendIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  TrophyIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { PageSection } from '../components/public/PageSection'
import { SocialLinks } from '../components/SocialLinks'
import { Badge, Card, PageHeader } from '../components/ui'
import { DEVELOPER } from '../config/site'

const HOW_IT_WORKS_STEPS = [
  ClipboardCheckIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  MapPinIcon,
  TrophyIcon,
  SendIcon,
] as const

const TRANSPARENCY_POINTS = [LockIcon, KeySquareIcon, ScaleIcon, FileTextIcon, ArchiveIcon] as const

const WINNERS_RESERVES_POINTS = [TrophyIcon, UsersIcon, ListOrderedIcon, UserCheckIcon] as const

const TECH_STACK = [
  'React',
  'TypeScript',
  'Node.js',
  'Express',
  'PostgreSQL',
  'Prisma',
  'Tailwind CSS',
  'shadcn/ui',
] as const

/**
 * What the platform is, how the lottery works, and who built it.
 *
 * Every claim here is grounded in what the rest of the application actually
 * does — nothing on this page asserts a government affiliation, a
 * certification or a statistic the codebase does not back. The developer
 * section is real attribution, kept clearly secondary to the project itself
 * (see the section order below), not a portfolio page wearing the app's
 * layout.
 */
export function About() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-14">
      <PageHeader
        eyebrow={t('about.hero.eyebrow')}
        title={t('pages.about.title')}
        description={t('about.hero.intro')}
      />

      <PageSection id="about-introduction" title={t('about.introduction.title')}>
        <p className="max-w-3xl text-sm leading-relaxed text-stone-600">{t('about.introduction.body')}</p>
      </PageSection>

      <PageSection
        id="about-how-it-works"
        title={t('about.howItWorks.title')}
        description={t('about.howItWorks.description')}
      >
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((Icon, index) => (
            <li key={index}>
              <Card>
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                    {t('about.howItWorks.step', { number: index + 1 })}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-stone-900">
                  {t(`about.howItWorks.steps.${index}.title`)}
                </h3>
                <p className="mt-1 text-sm text-stone-600">{t(`about.howItWorks.steps.${index}.body`)}</p>
              </Card>
            </li>
          ))}
        </ol>
      </PageSection>

      <PageSection
        id="about-transparency"
        title={t('about.transparency.title')}
        description={t('about.transparency.description')}
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {TRANSPARENCY_POINTS.map((Icon, index) => (
            <li key={index} className="flex gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-stone-900">
                  {t(`about.transparency.points.${index}.title`)}
                </h3>
                <p className="mt-1 text-sm text-stone-600">{t(`about.transparency.points.${index}.body`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection
        id="about-winners-reserves"
        title={t('about.winnersReserves.title')}
        description={t('about.winnersReserves.description')}
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {WINNERS_RESERVES_POINTS.map((Icon, index) => (
            <li key={index} className="flex gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                <Icon aria-hidden="true" className="size-4" />
              </span>
              <p className="text-sm text-stone-600">{t(`about.winnersReserves.points.${index}`)}</p>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection id="about-languages" title={t('about.languages.title')}>
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
              <GlobeIcon aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="text-sm text-stone-600">{t('about.languages.body')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="neutral">العربية</Badge>
                <Badge variant="neutral">Français</Badge>
                <Badge variant="neutral">English</Badge>
              </div>
            </div>
          </div>
        </Card>
      </PageSection>

      <PageSection id="about-tech" title={t('about.tech.title')} description={t('about.tech.description')}>
        <div className="flex flex-wrap gap-2">
          {TECH_STACK.map((name) => (
            <Badge key={name} variant="info">
              {name}
            </Badge>
          ))}
        </div>
      </PageSection>

      <PageSection id="about-developer" title={t('about.developer.title')} className="border-t pt-10">
        <Card>
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-base font-semibold text-stone-900">{DEVELOPER.name}</p>
              <p className="text-sm text-stone-500">@{DEVELOPER.handle}</p>
              <p className="mt-3 max-w-xl text-sm text-stone-600">{t('about.developer.body')}</p>
            </div>
            <SocialLinks />
          </div>
        </Card>
      </PageSection>
    </div>
  )
}
