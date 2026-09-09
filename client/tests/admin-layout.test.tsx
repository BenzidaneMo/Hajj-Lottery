import { canOpenAdminArea, ADMIN_AREA_ROLES, type AdminArea, type AdminRole } from '@hajj-lottery/shared'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AdminSidebar } from '../src/components/layout/admin/AdminSidebar'
import { AdminNotFound } from '../src/pages/admin/AdminNotFound'

import { renderAdmin } from './admin-harness'
import { switchLocale } from './harness'

/**
 * The shell: what each role is offered, and what happens off the map.
 *
 * Navigation visibility is a courtesy, and these tests treat it as one. They
 * assert that the rail matches `ADMIN_AREA_ROLES` — the same table the server
 * reads — rather than asserting that a hidden link means a blocked page. The
 * tests that prove authorization live with the requests, in
 * `admin-security.test.tsx` and the per-page suites.
 */

function navLinks(): string[] {
  const nav = screen.getByRole('navigation')
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent?.trim() ?? '')
}

function areasFor(role: AdminRole): AdminArea[] {
  return (Object.keys(ADMIN_AREA_ROLES) as AdminArea[]).filter((area) => canOpenAdminArea(role, area))
}

describe('role-aware navigation', () => {
  it('offers a national administrator every area', async () => {
    await switchLocale('en')
    renderAdmin(<AdminSidebar />, { role: 'SUPER_ADMIN' })

    const links = navLinks()
    expect(links).toHaveLength(areasFor('SUPER_ADMIN').length)
    expect(links).toContain('Dashboard')
    expect(links).toContain('Administrators')
    expect(links).toContain('Audit log')
  })

  it('offers a wilaya administrator only their own areas', async () => {
    await switchLocale('en')
    renderAdmin(<AdminSidebar />, { role: 'WILAYA_ADMIN' })

    const links = navLinks()
    expect(links).toHaveLength(areasFor('WILAYA_ADMIN').length)
    expect(links).toContain('Applications')
    expect(links).toContain('Commune draws')

    // National work: deciding imports and approvals, reading the whole trail,
    // managing accounts, and the identity registry that has no scope at all.
    for (const hidden of ['Administrators', 'Audit log', 'Imports', 'Approvals', 'Participants']) {
      expect(links).not.toContain(hidden)
    }
  })

  it('offers a commune administrator a narrower set still', async () => {
    await switchLocale('en')
    renderAdmin(<AdminSidebar />, { role: 'COMMUNE_ADMIN' })

    const links = navLinks()
    expect(links).toHaveLength(areasFor('COMMUNE_ADMIN').length)
    expect(links).toContain('Results')
    // A commune administrator has no wilaya-wide configuration view.
    expect(links).not.toContain('Commune draws')
    expect(links).not.toContain('Participants')
  })

  it('matches the shared area table exactly, for every role', () => {
    for (const role of ['SUPER_ADMIN', 'WILAYA_ADMIN', 'COMMUNE_ADMIN'] as const) {
      const { unmount } = renderAdmin(<AdminSidebar />, { role })
      expect(navLinks(), role).toHaveLength(areasFor(role).length)
      unmount()
    }
  })
})

describe('an address with no page', () => {
  it('says only that nothing is there', async () => {
    await switchLocale('en')
    renderAdmin(<AdminNotFound />, { role: 'COMMUNE_ADMIN' })

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()

    // It must not hint that another account would have found something —
    // the same rule the API follows, where out-of-scope and nonexistent are
    // byte-identical answers.
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/permission|forbidden|not allowed|your role/i)
  })
})

describe('language and direction', () => {
  it('renders the rail in Arabic, right to left', async () => {
    await switchLocale('ar')
    renderAdmin(<AdminSidebar />, { role: 'SUPER_ADMIN' })

    expect(document.documentElement.dir).toBe('rtl')
    expect(navLinks()).toContain('لوحة المتابعة')
  })

  it('renders the rail in French, left to right', async () => {
    await switchLocale('fr')
    renderAdmin(<AdminSidebar />, { role: 'SUPER_ADMIN' })

    expect(document.documentElement.dir).toBe('ltr')
    expect(navLinks()).toContain('Tableau de bord')
  })

  it('renders the rail in English, left to right', async () => {
    await switchLocale('en')
    renderAdmin(<AdminSidebar />, { role: 'SUPER_ADMIN' })

    expect(document.documentElement.dir).toBe('ltr')
    expect(navLinks()).toContain('Dashboard')
  })

  it('uses logical spacing so the rail mirrors without a second variant', () => {
    renderAdmin(<AdminSidebar />, { role: 'SUPER_ADMIN' })

    // A physical `pl-`/`ml-`/`left-` here would put the active marker on the
    // wrong side of an Arabic page. `gap` and `px` are direction-neutral.
    const html = screen.getByRole('navigation').outerHTML
    expect(html).not.toMatch(/\b(pl|pr|ml|mr)-\d/)
    expect(html).not.toMatch(/\b(left|right)-\d/)
  })
})
