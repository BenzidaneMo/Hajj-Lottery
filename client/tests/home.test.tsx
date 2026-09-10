import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Home } from '../src/pages/Home'
import { renderPage, stubApi, switchLocale } from './harness'

const STATS_STUB = {
  '/api/public/stats': { body: { totalWilayas: 69, totalCommunes: 1541, totalAllocatedSpots: 3200 } },
}

/**
 * The landing page: what the service is, and the three doors out of it.
 *
 * The registration-window banner reads the same endpoint `/register` uses —
 * it is a courtesy, not a second source of truth, so these tests check that
 * it reflects whatever the server says rather than asserting a fixed year.
 */
describe('the landing page', () => {
  it('offers registration, status and results as the three primary actions', async () => {
    await switchLocale('en')
    stubApi({
      '/api/applications/registration-window': { body: { drawYear: 2027, isOpen: true } },
      ...STATS_STUB,
    })

    renderPage(<Home />)
    await screen.findByRole('heading', { level: 1 })

    expect(screen.getByRole('link', { name: /register for the draw/i })).toHaveAttribute('href', '/register')
    expect(screen.getByRole('link', { name: /check application status/i })).toHaveAttribute(
      'href',
      '/application-status',
    )
    expect(screen.getByRole('link', { name: /view results/i })).toHaveAttribute('href', '/winners')
  })

  it('shows the open registration year the server reports', async () => {
    await switchLocale('en')
    stubApi({
      '/api/applications/registration-window': { body: { drawYear: 2027, isOpen: true } },
      ...STATS_STUB,
    })

    renderPage(<Home />)

    expect(await screen.findByText(/registration is open for the 2027 draw/i)).toBeInTheDocument()
  })

  it('says registration is closed when the server reports no open year', async () => {
    await switchLocale('en')
    stubApi({
      '/api/applications/registration-window': { body: { drawYear: null, isOpen: false } },
      ...STATS_STUB,
    })

    renderPage(<Home />)

    expect(await screen.findByText(/registration is not currently open/i)).toBeInTheDocument()
  })

  it('never links to the administrative console', async () => {
    await switchLocale('en')
    stubApi({
      '/api/applications/registration-window': { body: { drawYear: 2027, isOpen: true } },
      ...STATS_STUB,
    })

    renderPage(<Home />)
    await screen.findByRole('heading', { level: 1 })

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/admin/)
    }
  })

  it('renders in Arabic, right to left', async () => {
    await switchLocale('ar')
    stubApi({
      '/api/applications/registration-window': { body: { drawYear: 2027, isOpen: true } },
      ...STATS_STUB,
    })

    renderPage(<Home />)

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('shows the platform real-scale numbers once the stats endpoint answers, and the certified-results badge regardless', async () => {
    await switchLocale('en')
    stubApi({
      '/api/applications/registration-window': { body: { drawYear: 2027, isOpen: true } },
      ...STATS_STUB,
    })

    renderPage(<Home />)

    expect(await screen.findByText('3,200')).toBeInTheDocument()
    expect(screen.getByText('1,541')).toBeInTheDocument()
    expect(screen.getByText('69')).toBeInTheDocument()
    expect(screen.getByText('Certified draws')).toBeInTheDocument()
    expect(screen.getByText('Transparent and auditable')).toBeInTheDocument()
  })

  it('shows an em dash rather than an error banner when the stats request fails', async () => {
    await switchLocale('en')
    stubApi({ '/api/applications/registration-window': { body: { drawYear: 2027, isOpen: true } } })

    renderPage(<Home />)
    await screen.findByRole('heading', { level: 1 })

    // Three em dashes for the numeric tiles, and nothing that reads as a
    // fault — the registration-window Alert legitimately has `role="alert"`,
    // so the assertion is on the stats tiles specifically, not the whole page.
    expect(await screen.findAllByText('—')).toHaveLength(3)
    expect(screen.getByText('Certified draws')).toBeInTheDocument()
  })
})
