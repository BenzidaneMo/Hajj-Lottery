import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Footer } from '../src/components/layout/Footer'
import { PUBLIC_NAV_ITEMS } from '../src/config/nav'
import { DEVELOPER, SOCIAL_LINKS } from '../src/config/site'
import { renderPage, switchLocale } from './harness'

describe('the site footer', () => {
  it('renders the project identity and copyright line', async () => {
    await switchLocale('en')
    renderPage(<Footer />)

    expect(screen.getByText(/organizing the communal Hajj lottery/i)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(String(new Date().getFullYear())))).toBeInTheDocument()
    expect(screen.getByText(/all rights reserved/i)).toBeInTheDocument()
  })

  it('links to every public route and none of the admin console', async () => {
    await switchLocale('en')
    renderPage(<Footer />)

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))

    for (const item of PUBLIC_NAV_ITEMS) {
      expect(hrefs).toContain(item.to)
    }
    for (const href of hrefs) {
      expect(href ?? '').not.toMatch(/^\/admin/)
    }
  })

  it('attributes the project to the developer and links their social profiles', async () => {
    await switchLocale('en')
    renderPage(<Footer />)

    expect(screen.getByText(new RegExp(DEVELOPER.name))).toBeInTheDocument()

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    for (const { href } of SOCIAL_LINKS) {
      expect(hrefs.filter((entry) => entry === href)).toHaveLength(1)
    }
  })

  it('renders in Arabic, right to left', async () => {
    await switchLocale('ar')
    renderPage(<Footer />)

    expect(document.documentElement.dir).toBe('rtl')
    expect(screen.getByText(/تنظيم قرعة الحج/)).toBeInTheDocument()
  })

  it('renders in French', async () => {
    await switchLocale('fr')
    renderPage(<Footer />)

    expect(screen.getByText(/organiser la loterie communale/i)).toBeInTheDocument()
  })
})
