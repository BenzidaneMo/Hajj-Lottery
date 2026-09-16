import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

export type LogoVariant = 'light' | 'dark'

export interface LogoProps {
  to?: string
  /**
   * `light` (default) is for a light background — the header, the About
   * page's developer card, the admin sidebar. `dark` is for the footer's
   * `bg-primary-800` band, where `light`'s `text-primary-800` wordmark and
   * `primary-700` focus ring would both sit almost invisibly on a background
   * the same color as themselves.
   *
   * `light`'s own colors additionally carry a `dark:` override to gold, for
   * the admin console's dark theme specifically: the sidebar renders `light`
   * unconditionally (its actual background is whichever admin theme is
   * active), and brand green on the dark card background is a ~1.3:1
   * contrast — not a background this variant name anticipated. Gold, already
   * the app's one other accent, reads at a legible ~3.4:1 there instead.
   */
  variant?: LogoVariant
}

const VARIANT_CLASSES: Record<LogoVariant, { text: string; ring: string }> = {
  light: {
    text: 'text-primary-800 dark:text-gold-500',
    ring: 'focus-visible:outline-primary-700 dark:focus-visible:outline-gold-500',
  },
  dark: { text: 'text-white', ring: 'focus-visible:outline-white' },
}

/** Application identity mark: the project's own logo, not a national or religious emblem. */
export function Logo({ to = '/', variant = 'light' }: LogoProps) {
  const { t } = useTranslation()
  const classes = VARIANT_CLASSES[variant]

  return (
    <Link
      to={to}
      className={`flex items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${classes.ring}`}
    >
      <img src="/image/Logo.webp" alt="" aria-hidden="true" className="h-9 w-9 shrink-0" />
      <span className={`text-lg font-semibold ${classes.text}`}>{t('app.name')}</span>
    </Link>
  )
}
