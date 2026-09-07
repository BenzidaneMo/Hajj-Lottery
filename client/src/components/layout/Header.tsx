import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import { CloseIcon, MenuIcon } from '../icons'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { Logo } from '../Logo'
import { IconButton } from '../ui'
import { Container } from './Container'

const NAV_ITEMS = [
  { to: '/', key: 'nav.home' },
  { to: '/register', key: 'nav.register' },
  { to: '/application-status', key: 'nav.applicationStatus' },
  { to: '/winners', key: 'nav.winners' },
  { to: '/draw', key: 'nav.draw' },
  { to: '/about', key: 'nav.about' },
] as const

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 ${
    isActive ? 'font-semibold text-primary-800' : 'text-stone-600 hover:text-primary-800'
  }`

export function Header() {
  const { t } = useTranslation()
  const location = useLocation()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [lastPathname, setLastPathname] = useState(location.pathname)

  // Close the mobile panel on navigation. Adjusted during render (React's
  // documented pattern for resetting state on prop change) rather than in an
  // effect, to avoid an extra render pass.
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setIsMenuOpen(false)
  }

  return (
    <header className="border-b border-stone-200 bg-white">
      <Container>
        <div className="flex items-center justify-between gap-4 py-4">
          <Logo />
          <nav aria-label={t('nav.ariaLabel')} className="hidden items-center gap-1 text-sm md:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClassName}>
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <LanguageSwitcher />
          </div>
          <IconButton
            icon={isMenuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            label={isMenuOpen ? t('common.closeMenu') : t('common.openMenu')}
            variant="ghost"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
            className="md:hidden"
            onClick={() => setIsMenuOpen((open) => !open)}
          />
        </div>
      </Container>
      {isMenuOpen && (
        <div id="mobile-nav" className="border-t border-stone-200 bg-white md:hidden">
          <Container>
            <nav aria-label={t('nav.ariaLabel')} className="flex flex-col gap-1 py-3 text-sm">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClassName}>
                  {t(item.key)}
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-stone-100 py-3">
              <LanguageSwitcher />
            </div>
          </Container>
        </div>
      )}
    </header>
  )
}
