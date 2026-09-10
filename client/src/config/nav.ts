/**
 * The public navigation, in one place.
 *
 * `Header`/`MobileNavSheet` and `Footer` used to each carry their own copy of
 * this list. A single export means adding or renaming a public route changes
 * one file instead of two that must be kept in step by hand.
 */
export interface NavItem {
  to: string
  key: string
}

export const PUBLIC_NAV_ITEMS: readonly NavItem[] = [
  { to: '/', key: 'nav.home' },
  { to: '/register', key: 'nav.register' },
  { to: '/application-status', key: 'nav.applicationStatus' },
  { to: '/winners', key: 'nav.winners' },
  { to: '/draw', key: 'nav.draw' },
  { to: '/about', key: 'nav.about' },
]
