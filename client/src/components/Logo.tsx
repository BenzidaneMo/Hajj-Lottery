import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

export type LogoVariant = 'light' | 'dark'

export interface LogoProps {
  to?: string
  /**
   * `light` (default) is for a light background — the header, the About
   * page's developer card. `dark` is for the footer's `bg-primary-800`
   * band, where `light`'s `text-primary-800` wordmark and `primary-700`
   * focus ring would both sit almost invisibly on a background the same
   * color as themselves.
   */
  variant?: LogoVariant
}

const VARIANT_CLASSES: Record<LogoVariant, { text: string; ring: string }> = {
  light: { text: 'text-primary-800', ring: 'focus-visible:outline-primary-700' },
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
