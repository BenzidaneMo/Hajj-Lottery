import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation } from 'react-router-dom'

import { PUBLIC_NAV_ITEMS } from '../../config/nav'
import { CloseIcon, MenuIcon } from '../icons'
import { LanguageSwitcher } from '../LanguageSwitcher'
import { Logo } from '../Logo'
import { Button } from '../shadcn/button'
import { Container } from './Container'
import { MobileNavSheet } from './MobileNavSheet'

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2 py-1 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-700 ${
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
    // `z-40`, deliberately below the mobile Sheet's `z-50` (`shadcn/sheet.tsx`).
    // `position: sticky` establishes its own stacking context, so this header
    // must never end up above the Sheet's overlay/content, or a sticky ~80px
    // bar would visually cover the top of the slide-in panel (and the first
    // nav link in it) whenever the panel is open.
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white">
      <Container>
        <div className="flex items-center justify-between gap-4 py-5">
          <Logo />
          <nav aria-label={t('nav.ariaLabel')} className="hidden items-center gap-2 text-sm md:flex">
            {PUBLIC_NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClassName}>
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <LanguageSwitcher />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isMenuOpen ? t('common.closeMenu') : t('common.openMenu')}
            title={isMenuOpen ? t('common.closeMenu') : t('common.openMenu')}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
            // Radix locks `pointer-events` on the page body while the Sheet is
            // open, so without the inline override this button — outside the
            // Sheet's own portal — could not be clicked to close it again.
            // (A Tailwind *class* wouldn't do: it only exists once a build
            // compiles it, and this has to win regardless of specificity.)
            // Being behind the header's own `z-40`, it no longer visually
            // out-ranks the Sheet's overlay the way it once did when the
            // header had no stacking context of its own — but that's not a
            // regression: `SheetContent` renders its own close button by
            // default, and tapping this same screen position still closes
            // the sheet, just via the overlay's own click-to-close instead.
            className="md:hidden"
            style={{ pointerEvents: 'auto' }}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </Button>
        </div>
      </Container>
      <MobileNavSheet
        open={isMenuOpen}
        onOpenChange={setIsMenuOpen}
        items={PUBLIC_NAV_ITEMS}
        linkClassName={navLinkClassName}
      />
    </header>
  )
}
