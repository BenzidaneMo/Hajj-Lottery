import { useTranslation } from 'react-i18next'
import { NavLink, type NavLinkProps } from 'react-router-dom'

import { Sheet, SheetContent, SheetTitle } from '@/components/shadcn/sheet'

import { LanguageSwitcher } from '../LanguageSwitcher'

export interface MobileNavItem {
  to: string
  key: string
}

export interface MobileNavSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly MobileNavItem[]
  linkClassName: NavLinkProps['className']
}

/**
 * The small-screen navigation panel, opened from the header's menu button.
 *
 * A Radix Dialog underneath (via the shared `Sheet` primitives also used by
 * the admin shell), so Escape, an outside click and focus trapping/return all
 * come for free — this component only supplies open state and closes it
 * again once a link is activated. `side="start"` is a logical property: the
 * panel slides in from the right in Arabic and the left in French/English
 * without a variant for either.
 */
export function MobileNavSheet({ open, onOpenChange, items, linkClassName }: MobileNavSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent id="mobile-nav" side="start" className="w-72 p-0">
        <SheetTitle className="sr-only">{t('nav.ariaLabel')}</SheetTitle>
        <nav aria-label={t('nav.ariaLabel')} className="flex flex-col gap-1 p-4 text-sm">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={linkClassName}
              onClick={() => onOpenChange(false)}
            >
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-4">
          <LanguageSwitcher />
        </div>
      </SheetContent>
    </Sheet>
  )
}
