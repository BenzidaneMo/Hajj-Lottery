import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { SocialLinks } from '../SocialLinks'
import { PUBLIC_NAV_ITEMS } from '../../config/nav'
import { DEVELOPER } from '../../config/site'
import { Logo } from '../Logo'
import { Container } from './Container'

/**
 * Three columns on a wide screen, stacked on a narrow one: what this is, where
 * to go, and who built it. Entirely separate from the administrative
 * console — nothing here links to `/admin` or `/admin/login`, and
 * `PUBLIC_NAV_ITEMS` is the same list `Header` renders, so the two can never
 * drift apart.
 */
export function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-stone-200 bg-white">
      <Container>
        <div className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="max-w-xs text-sm text-stone-500">{t('footer.description')}</p>
          </div>

          <nav aria-label={t('footer.navHeading')} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-stone-800">{t('footer.navHeading')}</h2>
            <ul className="flex flex-col gap-2">
              {PUBLIC_NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="text-sm text-stone-500 transition-colors hover:text-primary-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700"
                  >
                    {t(item.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-stone-800">{t('footer.developerHeading')}</h2>
            <p className="text-sm text-stone-500">{t('footer.developedBy', { name: DEVELOPER.name })}</p>
            <SocialLinks />
          </div>
        </div>

        <div className="border-t border-stone-100 py-6 text-center text-sm text-stone-500">
          {t('app.name')} — © {year} {t('footer.rights')}
        </div>
      </Container>
    </footer>
  )
}
