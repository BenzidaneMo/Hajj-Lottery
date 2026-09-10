import type { SupportedLocale } from '@hajj-lottery/shared'
import { LazyMotion, m, useReducedMotion, type Variants } from 'framer-motion'
import { ClipboardCheckIcon, MapPinIcon, MosqueIcon, TrophyIcon, UserPlusIcon } from 'lucide-react'
import type { ReactNode, SVGProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { PageSection } from '../components/public/PageSection'
import { Reveal } from '../components/public/Reveal'
import { Alert, Badge, Button, Card, Skeleton } from '../components/ui'
import { useRegistrationWindow } from '../lib/applications'
import { formatNumber } from '../lib/format'
import { usePublicStats } from '../lib/public'

/** See `lib/motion-features.ts` for why this is a dynamic import. */
const loadMotionFeatures = () => import('../lib/motion-features').then((module) => module.default)

const STEPS = [
  { icon: UserPlusIcon, titleKey: 'home.steps.register.title', bodyKey: 'home.steps.register.body' },
  { icon: MapPinIcon, titleKey: 'home.steps.draw.title', bodyKey: 'home.steps.draw.body' },
  { icon: TrophyIcon, titleKey: 'home.steps.results.title', bodyKey: 'home.steps.results.body' },
] as const

const STAT_ICON_CLASS =
  'flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800'

/**
 * Not a lucide icon — no icon set ships a Kaaba glyph — so it is hand-drawn
 * here in the same restrained stroke style as everything around it, rather
 * than as a new shared module: nothing else on the site needs it yet.
 */
function KaabaIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <rect x="5" y="6" width="14" height="14" />
      <path d="M5 10.5h14" />
      <path d="M10.5 20v-4h3v4" />
    </svg>
  )
}

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
  const { t, i18n } = useTranslation()
  const locale = i18n.language as SupportedLocale
  const { data: window_, isLoading } = useRegistrationWindow()
  const { data: stats, isLoading: statsLoading } = usePublicStats()
  const shouldReduceMotion = useReducedMotion()

  const heroContainer: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: shouldReduceMotion ? 0 : 0.12 } },
  }
  const heroItem: Variants = {
    hidden: { opacity: 0, y: shouldReduceMotion ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
  }

  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <div className="flex flex-col gap-16">
        <section className="relative overflow-hidden rounded-2xl border border-primary-100 bg-linear-to-b from-primary-50 to-white">
          {/*
          The Kaaba photograph, not a full-bleed background: it lives in its
          own layer covering roughly the right-hand third of the hero, masked
          to fade from transparent (revealing the plain gradient behind it)
          into full strength — a soft blend rather than a hard rectangular
          edge. The text column below never sits on top of the photo, so no
          dark scrim is needed anywhere for it to stay readable.

          Deliberately not mirrored under `dir="rtl"`, unlike everything else
          in this app. This is a photograph of one real, specific place — the
          two minarets and the Kaaba have one true arrangement — and flipping
          it the way a logical `end-0` would under Arabic would misrepresent
          the Masjid al-Haram's actual layout. It stays physically on the
          right in every language, and the text column below is pinned to the
          physical left with `mr-auto` (a block box would otherwise start
          from its *inline*-start edge — the right, under `dir="rtl"` — and
          collide with the photo). Only the text's own internal alignment
          follows `dir`, exactly as it does anywhere else in the app.

          Hidden below `lg`: at narrower widths there isn't room for both a
          fade zone and readable text, so small screens get the plain
          gradient alone. `loading="lazy"` on the image, combined with that
          `hidden` ancestor, means a phone visitor's browser does not fetch
          this ~550KB photograph at all in practice — only a desktop viewport
          ever pays for it.
        */}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 hidden w-full overflow-hidden lg:block lg:w-[65%]"
            style={{
              maskImage: 'linear-gradient(to right, transparent 0%, black 42%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 42%)',
            }}
          >
            <m.img
              src="/image/Kaaba-home-hero.webp"
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-[50%_60%]"
              initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
          </div>

          <m.div
            className="relative z-10 mr-auto flex flex-col items-start gap-6 px-6 py-12 sm:px-10 sm:py-16 lg:max-w-[52%]"
            initial="hidden"
            animate="visible"
            variants={heroContainer}
          >
            <m.div variants={heroItem} className="flex items-center gap-3">
              <Badge variant="neutral">{t('app.name')}</Badge>
              <span aria-hidden="true" className="h-1 w-10 rounded-full bg-gold-500" />
            </m.div>
            <m.div variants={heroItem} className="flex flex-col gap-4">
              <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl lg:text-5xl">
                {t('home.title')}
              </h1>
              <p className="max-w-xl text-base text-stone-600 sm:text-lg">{t('home.subtitle')}</p>
            </m.div>

            <m.div variants={heroItem} className="flex flex-wrap items-center gap-3">
              <m.div
                whileHover={{ scale: shouldReduceMotion ? 1 : 1.03 }}
                whileTap={{ scale: shouldReduceMotion ? 1 : 0.97 }}
              >
                <Button asChild>
                  <Link to="/register">{t('home.cta.register')}</Link>
                </Button>
              </m.div>
              <Button asChild variant="secondary">
                <Link to="/application-status">{t('home.cta.checkStatus')}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/winners">{t('home.cta.viewResults')}</Link>
              </Button>
            </m.div>

            <m.div variants={heroItem} className="w-full max-w-md">
              {isLoading ? (
                <Skeleton className="h-14 w-full rounded-lg" />
              ) : window_ ? (
                <Alert variant={window_.isOpen ? 'success' : 'info'}>
                  {window_.isOpen
                    ? t('home.status.open', { year: window_.drawYear })
                    : t('home.status.closed')}
                </Alert>
              ) : null}
            </m.div>
          </m.div>
        </section>

        <PageSection
          id="how-it-works"
          eyebrow={t('home.howItWorks.eyebrow')}
          title={t('home.howItWorks.title')}
          description={t('home.howItWorks.description')}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <Reveal key={step.titleKey} delay={index * 0.1}>
                <Card className="h-full">
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
              </Reveal>
            ))}
          </div>
        </PageSection>

        <PageSection id="platform-stats" eyebrow={t('home.stats.eyebrow')} title={t('home.stats.title')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Reveal>
              <StatTile
                icon={<KaabaIcon className="size-5" />}
                value={statsLoading ? undefined : (stats?.totalAllocatedSpots ?? null)}
                locale={locale}
                label={t('home.stats.totalPlaces.label')}
              />
            </Reveal>

            <Reveal delay={0.1}>
              <StatTile
                icon={<MosqueIcon aria-hidden="true" className="size-5" />}
                value={statsLoading ? undefined : (stats?.totalCommunes ?? null)}
                locale={locale}
                label={t('home.stats.totalMunicipalities.label')}
              />
            </Reveal>

            <Reveal delay={0.2}>
              <StatTile
                icon={<MapPinIcon aria-hidden="true" className="size-5" />}
                value={statsLoading ? undefined : (stats?.totalWilayas ?? null)}
                locale={locale}
                label={t('home.stats.totalWilayas.label')}
              />
            </Reveal>

            <Reveal delay={0.3}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <span className={STAT_ICON_CLASS}>
                    <ClipboardCheckIcon aria-hidden="true" className="size-5" />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-stone-900">
                      {t('home.stats.certifiedResults.title')}
                    </p>
                    <p className="text-sm text-stone-600">{t('home.stats.certifiedResults.subtitle')}</p>
                  </div>
                </div>
              </Card>
            </Reveal>
          </div>
        </PageSection>
      </div>
    </LazyMotion>
  )
}

interface StatTileProps {
  icon: ReactNode
  /** `undefined` while loading, `null` on failure, a number once fetched. */
  value: number | null | undefined
  locale: SupportedLocale
  label: string
}

/**
 * A big number plus a caption. `value` is `undefined` while `usePublicStats`
 * is loading (renders a skeleton, matching the registration-window alert
 * above) and `null` if the fetch failed — an em dash rather than an error
 * banner, since a missing trust statistic should not read as a broken page.
 */
function StatTile({ icon, value, locale, label }: StatTileProps) {
  return (
    <Card className="h-full">
      <div className="flex items-center gap-3">
        <span className={STAT_ICON_CLASS}>{icon}</span>
        <div>
          {value === undefined ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <p className="text-2xl font-bold tracking-tight text-stone-900">
              {value === null ? '—' : formatNumber(value, locale)}
            </p>
          )}
          <p className="text-sm text-stone-600">{label}</p>
        </div>
      </div>
    </Card>
  )
}
