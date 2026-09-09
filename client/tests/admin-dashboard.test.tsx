import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AdminDashboard } from '../src/pages/admin/AdminDashboard'

import { dashboard, renderAdmin, WILAYA_REF } from './admin-harness'
import { requestedPaths, stubApi, stubNeverResolves, switchLocale } from './harness'

/**
 * The operational summary.
 *
 * The point worth testing hardest is that the page renders what it was given
 * and derives nothing. A scoped administrator's response has no national figure
 * in it at all — the server counted only their territory — so the test asserts
 * on the request being made and the response being displayed verbatim, not on
 * the page hiding something it received.
 */

describe('the dashboard', () => {
  it('asks for one summary and shows the figures it gets back', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/dashboard': { body: dashboard() } })

    renderAdmin(<AdminDashboard />)

    expect(await screen.findByText('8,431')).toBeInTheDocument()
    expect(screen.getByText('8,100')).toBeInTheDocument()
    expect(screen.getByText('480')).toBeInTheDocument()

    // One request, not one per commune. A dashboard that fanned out would be
    // both slow and a way to accumulate more in the browser than is displayed.
    expect(requestedPaths()).toEqual(['/api/admin/dashboard'])
  })

  it('shows a wilaya administrator their own scope and no national queues', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/dashboard': {
        body: dashboard({
          scope: 'WILAYA',
          wilaya: WILAYA_REF,
          // The server withholds these from a scoped administrator, so there
          // is no national count in the payload to leak.
          governance: null,
          counts: { ...dashboard().counts, applications: 640, allocatedSpots: 24 },
        }),
      },
    })

    renderAdmin(<AdminDashboard />, { role: 'WILAYA_ADMIN' })

    expect(await screen.findByText('640')).toBeInTheDocument()
    expect(screen.getByText(/Mostaganem/)).toBeInTheDocument()

    expect(screen.queryByText('Imports to review')).not.toBeInTheDocument()
    expect(screen.queryByText('Approval requests')).not.toBeInTheDocument()
    expect(screen.queryByText('Waiting on a decision')).not.toBeInTheDocument()
  })

  it('shows the national queues to a national administrator', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/dashboard': { body: dashboard() } })

    renderAdmin(<AdminDashboard />)

    expect(await screen.findByText('Imports to review')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('names the draw year the figures are about', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/dashboard': { body: dashboard() } })

    renderAdmin(<AdminDashboard />)

    expect(await screen.findByText('2027')).toBeInTheDocument()
    expect(screen.getByText('Registration open')).toBeInTheDocument()
  })

  it('says so when there is no draw year rather than showing zeroes as facts', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/dashboard': { body: dashboard({ drawYear: null }) },
    })

    renderAdmin(<AdminDashboard />)

    expect(await screen.findByText('No draw year is configured')).toBeInTheDocument()
  })

  it('shows a loading state while the summary is in flight', async () => {
    await switchLocale('en')
    stubNeverResolves()

    renderAdmin(<AdminDashboard />)

    // Headings are already in place so the layout does not jump; the figures
    // are skeletons rather than a misleading zero.
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByText('8,431')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('offers a retry when the summary fails', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/dashboard': { status: 500, body: { error: 'boom', code: 'INTERNAL_ERROR' } } })

    renderAdmin(<AdminDashboard />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('The server could not complete this request.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()

    // The server's own message is never shown: it is untranslated and, on a
    // 500, may describe the inside of the system.
    await waitFor(() => expect(document.body.textContent).not.toContain('boom'))
  })
})
