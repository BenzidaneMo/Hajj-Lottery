import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

export interface LogoProps {
  to?: string
}

/** Application identity mark: an abstract shield (trust/service), not a national or religious emblem. */
export function Logo({ to = '/' }: LogoProps) {
  const { t } = useTranslation()

  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
    >
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-700 text-white"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z"
          />
        </svg>
      </span>
      <span className="text-lg font-semibold text-primary-800">{t('app.name')}</span>
    </Link>
  )
}
