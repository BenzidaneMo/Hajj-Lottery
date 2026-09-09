import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminApplicationDetail } from '../src/pages/admin/AdminApplicationDetail'
import { AdminApplications } from '../src/pages/admin/AdminApplications'
import { AdminParticipants } from '../src/pages/admin/AdminParticipants'

import { application, applicationDetail, renderAdmin } from './admin-harness'
import { requestedPaths, stubApi, switchLocale, WILAYA_LIST } from './harness'

/**
 * Applications, their detail, and the identity registry.
 *
 * The recurring assertion here is that filtering and paging reach the *server*.
 * A console that fetched a territory and narrowed it in React would put more
 * data in the browser than it displays, and would make the geographic ceiling a
 * decision this page took rather than one the query enforced.
 */

function page(items = [application()], overrides = {}) {
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1, ...overrides }
}

const GEO = {
  '/api/admin/wilayas': { body: WILAYA_LIST },
  '/api/admin/communes': { body: [] },
}

describe('the applications table', () => {
  it('renders a page of applications', async () => {
    await switchLocale('en')
    stubApi({ ...GEO, '/api/admin/applications': { body: page() } })

    renderAdmin(<AdminApplications />)

    const table = await screen.findByRole('table', { name: 'Applications' })
    expect(within(table).getByText('HZ-2027-MES-8F42K1')).toBeInTheDocument()
    expect(within(table).getByText('Eligible')).toBeInTheDocument()
    expect(within(table).getByText('Hassi Mameche')).toBeInTheDocument()
  })

  it('sends a chosen status to the server rather than filtering in the browser', async () => {
    await switchLocale('en')
    stubApi({ ...GEO, '/api/admin/applications': { body: page() } })

    renderAdmin(<AdminApplications />)
    await screen.findByRole('table', { name: 'Applications' })

    await userEvent.click(screen.getByLabelText('Status'))
    await userEvent.click(await screen.findByRole('option', { name: 'Ineligible' }))

    const requests = requestedPaths().filter((path) => path.startsWith('/api/admin/applications'))
    expect(requests.at(-1)).toContain('status=INELIGIBLE')
  })

  it('returns to the first page when the filter changes', async () => {
    await switchLocale('en')
    stubApi({
      ...GEO,
      '/api/admin/applications': { body: page([application()], { page: 3, totalPages: 5 }) },
    })

    renderAdmin(<AdminApplications />)
    await screen.findByRole('table', { name: 'Applications' })

    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByLabelText('Type'))
    await userEvent.click(await screen.findByRole('option', { name: 'Paired' }))

    // Page 3 of the previous filter is not page 3 of this one.
    const last = requestedPaths()
      .filter((path) => path.startsWith('/api/admin/applications'))
      .at(-1)
    expect(last).toContain('entryType=PAIRED')
    expect(last).toContain('page=1')
  })

  it('pages through the server’s own pagination', async () => {
    await switchLocale('en')
    stubApi({
      ...GEO,
      '/api/admin/applications': { body: page([application()], { page: 1, total: 60, totalPages: 3 }) },
    })

    renderAdmin(<AdminApplications />)
    await screen.findByRole('table', { name: 'Applications' })

    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(requestedPaths().at(-1)).toContain('page=2')
  })

  it('shows an empty state rather than a bare frame', async () => {
    await switchLocale('en')
    stubApi({ ...GEO, '/api/admin/applications': { body: page([], { total: 0 }) } })

    renderAdmin(<AdminApplications />)

    expect(await screen.findByText('No applications match these filters.')).toBeInTheDocument()
  })

  it('reports an error with a retry instead of an empty table', async () => {
    await switchLocale('en')
    stubApi({
      ...GEO,
      '/api/admin/applications': { status: 500, body: { error: 'x', code: 'INTERNAL_ERROR' } },
    })

    renderAdmin(<AdminApplications />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('one application', () => {
  const routing = { pattern: '/admin/applications/:id', path: '/admin/applications/app-1' }

  it('shows the application and its applicants', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/applications/app-1': { body: applicationDetail() } })

    renderAdmin(<AdminApplicationDetail />, routing)

    expect(await screen.findByRole('heading', { name: 'HZ-2027-MES-8F42K1' })).toBeInTheDocument()
    expect(screen.getByText('Amina Belkacem')).toBeInTheDocument()
    expect(screen.getByText('Primary applicant')).toBeInTheDocument()
  })

  it('shows only the last four digits of a national ID, and no phone number', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/applications/app-1': { body: applicationDetail() } })

    renderAdmin(<AdminApplicationDetail />, routing)
    await screen.findByText('Amina Belkacem')

    expect(screen.getByText('••••7391')).toBeInTheDocument()

    // The full ID is never sent to this screen, so it cannot be rendered — and
    // no administrative flow here contacts anybody, so there is no phone.
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\d{18}/)
    expect(screen.queryByText('Phone')).not.toBeInTheDocument()
  })

  it('never puts a national ID in the address', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/applications/app-1': { body: applicationDetail() } })

    renderAdmin(<AdminApplicationDetail />, routing)
    await screen.findByText('Amina Belkacem')

    for (const path of requestedPaths()) expect(path).not.toMatch(/\d{18}/)
  })

  it('shows the eligibility verdict and the stored status side by side', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/applications/app-1': { body: applicationDetail() },
      '/api/admin/applications/app-1/eligibility': {
        body: {
          applicationReference: 'HZ-2027-MES-8F42K1',
          drawYear: 2027,
          entryType: 'SINGLE',
          storedStatus: 'ELIGIBLE',
          evaluation: { eligible: false, status: 'INELIGIBLE', reasons: ['PARTICIPANT_HAS_ALREADY_WON'] },
          commune: { code: '2703', nameAr: 'x', nameFr: 'x', nameEn: 'Hassi Mameche' },
          wilaya: { code: '27', nameAr: 'y', nameFr: 'y', nameEn: 'Mostaganem' },
          evaluatedAt: '2027-03-01T10:00:00.000Z',
        },
      },
    })

    renderAdmin(<AdminApplicationDetail />, routing)
    await userEvent.click(await screen.findByRole('tab', { name: 'Eligibility' }))

    expect(await screen.findByText('Stored status')).toBeInTheDocument()
    expect(screen.getByText('The applicant has already won the Hajj lottery')).toBeInTheDocument()
    // The disagreement is the reason to open this tab; it must not be hidden.
    expect(screen.getByText('The stored status and the current evaluation disagree')).toBeInTheDocument()
  })

  it('states that the weight breakdown is withheld rather than showing a blank', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/applications/app-1': { body: applicationDetail() },
      '/api/admin/applications/app-1/weight': {
        body: {
          applicationReference: 'HZ-2027-MES-8F42K1',
          drawYear: 2027,
          entryType: 'SINGLE',
          rule: 'SINGLE',
          calculatedWeight: 4,
          frozenWeight: 4,
          matchesFrozen: true,
          // Null for anyone but a national administrator: a person's history
          // spans communes.
          breakdown: null,
          calculatedAt: '2027-03-01T10:00:00.000Z',
        },
      },
    })

    renderAdmin(<AdminApplicationDetail />, { ...routing, role: 'COMMUNE_ADMIN' })
    await userEvent.click(await screen.findByRole('tab', { name: 'Weight' }))

    expect(await screen.findByText(/breakdown is withheld/)).toBeInTheDocument()
    expect(screen.queryByText('Primary applicant')).not.toBeInTheDocument()
  })

  it('shows the breakdown when the server supplies one', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/applications/app-1': { body: applicationDetail() },
      '/api/admin/applications/app-1/weight': {
        body: {
          applicationReference: 'HZ-2027-MES-8F42K1',
          drawYear: 2027,
          entryType: 'PAIRED',
          rule: 'MAX',
          calculatedWeight: 5,
          frozenWeight: 5,
          matchesFrozen: true,
          breakdown: { primaryWeight: 5, secondaryWeight: 2 },
          calculatedAt: '2027-03-01T10:00:00.000Z',
        },
      },
    })

    renderAdmin(<AdminApplicationDetail />, routing)
    await userEvent.click(await screen.findByRole('tab', { name: 'Weight' }))

    expect(await screen.findByText('Higher of the pair')).toBeInTheDocument()
    // The pair's weights, both shown: the rule is `MAX`, so the 5 is the one
    // that counted and the 2 is what it beat.
    expect(screen.getByText('Second applicant')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

describe('the identity registry', () => {
  it('does not search until a national ID is complete', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants': {
        body: { items: [], page: 1, pageSize: 25, total: 0, totalPages: 1 },
      },
    })

    renderAdmin(<AdminParticipants />)
    await screen.findByRole('table', { name: 'Participants' })

    await userEvent.type(screen.getByLabelText('National ID'), '1234')

    // A prefix search would answer "which IDs exist?" one digit at a time.
    for (const path of requestedPaths()) expect(path).not.toContain('nationalId=')
  })

  it('keeps identifying values out of the address entirely', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants': {
        body: {
          items: [
            {
              id: 'p-1',
              fullName: 'Amina Belkacem',
              nationalId: '109876543210987391',
              dob: '1968-04-02',
              phoneNumber: '+213555123456',
              hasWonHajj: false,
              createdAt: '2027-01-02T09:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
        },
      },
    })

    renderAdmin(<AdminParticipants />)

    // The registry legitimately displays the full ID to a national
    // administrator; what must never happen is it reaching a route.
    expect(await screen.findByText('109876543210987391')).toBeInTheDocument()

    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href') ?? '')
    for (const href of links) {
      expect(href).not.toContain('109876543210987391')
      expect(href).not.toContain('213555123456')
    }
  })
})
