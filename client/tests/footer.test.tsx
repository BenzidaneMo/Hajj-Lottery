import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Footer } from '../src/components/layout/Footer'
import { PUBLIC_NAV_ITEMS } from '../src/config/nav'
import { CONTACT, OFFICIAL_LINKS, SOCIAL_LINKS } from '../src/config/site'
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

  it('links the developer social profiles, the official government resources and direct contact details', async () => {
    await switchLocale('en')
    renderPage(<Footer />)

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))

    for (const { href } of SOCIAL_LINKS) {
      expect(hrefs.filter((entry) => entry === href)).toHaveLength(1)
    }
    for (const { href } of OFFICIAL_LINKS) {
      expect(hrefs).toContain(href)
    }
    expect(hrefs).toContain(`mailto:${CONTACT.email}`)
    expect(hrefs).toContain(CONTACT.phoneHref)
    expect(screen.getByText(CONTACT.email)).toBeInTheDocument()
  })

  it('opens a placeholder dialog for the privacy policy and terms of service, rather than a dead link', async () => {
    await switchLocale('en')
    renderPage(<Footer />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Privacy Policy' }))
    expect(await screen.findByRole('dialog', { name: 'Privacy Policy' })).toBeInTheDocument()
    expect(screen.getByText(/has not been published yet/i)).toBeInTheDocument()
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
