import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { LanguageSwitcher } from '../LanguageSwitcher'
import { Container } from './Container'

const NAV_ITEMS = [
  { to: '/', key: 'nav.home' },
  { to: '/register', key: 'nav.register' },
  { to: '/application-status', key: 'nav.applicationStatus' },
  { to: '/winners', key: 'nav.winners' },
  { to: '/draw', key: 'nav.draw' },
  { to: '/about', key: 'nav.about' },
] as const

export function Header() {
  const { t } = useTranslation()

  return (
    <header className="border-b border-stone-200 bg-white">
      <Container>
        <div className="flex flex-wrap items-center justify-between gap-4 py-4">
          <span className="text-lg font-semibold text-emerald-800">{t('app.name')}</span>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  isActive ? 'font-semibold text-emerald-800' : 'text-stone-600 hover:text-emerald-800'
                }
              >
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <LanguageSwitcher />
        </div>
      </Container>
    </header>
  )
}
