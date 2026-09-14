import { LazyMotion, m, useReducedMotion, type Variants } from 'framer-motion'
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
import { Reveal } from '../components/public/Reveal'
import { SocialLinks } from '../components/SocialLinks'
import { Badge, Card } from '../components/ui'
import { DEVELOPER } from '../config/site'

/** See `lib/motion-features.ts` for why this is a dynamic import. */
const loadMotionFeatures = () => import('../lib/motion-features').then((module) => module.default)

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
      <div className="flex flex-col gap-14">
        <section className="relative flex items-center overflow-hidden rounded-2xl border border-primary-100 bg-linear-to-b from-primary-50 to-white lg:min-h-112">
          {/*
          `lg:min-h-*`: the photo layer below is `absolute`, so it never
          contributes to this section's own height — only the text column
          (normal flow) does, and it is far shorter here than `Home.tsx`'s
          (no CTA row, no status alert, a smaller heading). Without a floor,
          the section collapses to the text's height and the absolutely
          positioned, `inset-y-0` photo just fills that short box, showing
          only a thin sliver of a tall (1024×1366) portrait photo. The floor
          is `lg`-only since the photo itself is hidden below `lg`.

          `flex items-center` on the section: once that floor makes the
          section taller than the text column, a plain block child stays
          glued to the top, leaving empty space beneath it while the photo
          fills the full height beside it. Centering the text column as a
          flex item fixes that; `mr-auto` below still pins it to the
          physical left in both directions, exactly as it does as a block
          child — margin-auto consumes the remaining free space the same
          way on a flex item as it does in normal flow.

          The hero photograph (the Kaaba between its two flanking minarets),
          not a full-bleed background: it lives in its own layer covering the
          right-hand ~62% of the hero, masked to fade from transparent
          (revealing the plain gradient behind it) into full strength — the
          same soft-blend technique `Home.tsx` uses for its own hero photo,
          rather than a hard rectangular banner edge. The text column below
          never sits on top of the photo, so no dark scrim is needed for it
          to stay readable in any language, including Arabic.

          Deliberately not mirrored under `dir="rtl"`, for the same reason as
          `Home.tsx`'s hero photo: this is a real, specific place with one
          true left-right arrangement, and flipping it under Arabic would
          misrepresent it. It stays physically on the right in every
          language; the text column is pinned to the physical left with
          `mr-auto` for the same reason `Home.tsx`'s is.

          `object-[75%_79%]` biases the crop toward the band that holds both
          minarets and the Kaaba, trading off the clock tower's topmost
          spire and the crowd at the very bottom rather than either of those
          two focal elements.

          Hidden below `lg`, exactly as `Home.tsx`'s is: no room for both a
          fade zone and readable text at narrower widths, and `loading="lazy"`
          combined with that `hidden` ancestor keeps a phone visitor from
          fetching this photograph at all.
        */}
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 hidden w-full overflow-hidden lg:block lg:w-[62%]"
            style={{
              maskImage: 'linear-gradient(to right, transparent 0%, black 42%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 42%)',
            }}
          >
            <m.img
              src="/image/about-baner.webp"
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-[75%_79%]"
              initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
          </div>

          <m.div
            className="relative z-10 mr-auto flex flex-col items-start gap-3 px-6 py-10 sm:px-10 sm:py-12 lg:max-w-[54%]"
            initial="hidden"
            animate="visible"
            variants={heroContainer}
          >
            <m.p variants={heroItem} className="text-sm font-semibold tracking-wide text-primary uppercase">
              {t('about.hero.eyebrow')}
            </m.p>
            <m.h1
              variants={heroItem}
              className="text-2xl font-bold tracking-tight text-foreground sm:text-4xl"
            >
              {t('pages.about.title')}
            </m.h1>
            <m.p variants={heroItem} className="max-w-2xl text-md text-muted-foreground">
              {t('about.hero.intro')}
            </m.p>
          </m.div>
        </section>

        <PageSection id="about-introduction" title={t('about.introduction.title')}>
          <Reveal>
            <p className="text-sm leading-relaxed text-stone-600">{t('about.introduction.body')}</p>
          </Reveal>
        </PageSection>

        <PageSection
          id="about-how-it-works"
          title={t('about.howItWorks.title')}
          description={t('about.howItWorks.description')}
        >
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HOW_IT_WORKS_STEPS.map((Icon, index) => (
              <li key={index}>
                <Reveal delay={index * 0.06}>
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
                </Reveal>
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
              <li key={index}>
                <Reveal
                  delay={index * 0.06}
                  className="flex gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-stone-900">
                      {t(`about.transparency.points.${index}.title`)}
                    </h3>
                    <p className="mt-1 text-sm text-stone-600">
                      {t(`about.transparency.points.${index}.body`)}
                    </p>
                  </div>
                </Reveal>
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
              <li key={index}>
                <Reveal
                  delay={index * 0.06}
                  className="flex gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-800">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <p className="text-sm text-stone-600">{t(`about.winnersReserves.points.${index}`)}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </PageSection>

        <PageSection id="about-languages" title={t('about.languages.title')}>
          <Reveal>
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
          </Reveal>
        </PageSection>

        <PageSection id="about-tech" title={t('about.tech.title')} description={t('about.tech.description')}>
          <Reveal className="flex flex-wrap gap-2">
            {TECH_STACK.map((name) => (
              <Badge key={name} variant="info">
                {name}
              </Badge>
            ))}
          </Reveal>
        </PageSection>

        <PageSection id="about-developer" title={t('about.developer.title')} className="border-t pt-10">
          <Reveal>
            <Card>
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <img src={DEVELOPER.avatar} alt={DEVELOPER.name} className="h-16 w-16 rounded-full" />
                  <div>
                    <p className="text-base font-semibold text-stone-900">{DEVELOPER.name}</p>
                    <p className="text-sm text-stone-500">@{DEVELOPER.handle}</p>
                    <p className="mt-3 max-w-xl text-sm text-stone-600">{t('about.developer.body')}</p>
                  </div>
                </div>
                <SocialLinks />
              </div>
            </Card>
          </Reveal>
        </PageSection>
      </div>
    </LazyMotion>
  )
}
