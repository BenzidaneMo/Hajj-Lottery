import { userEvent } from '@testing-library/user-event'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Register } from '../src/pages/Register'
import {
  COMMUNE,
  COMMUNE_LIST,
  renderPage,
  requestLog,
  requestedPaths,
  stubApi,
  switchLocale,
  WILAYA,
  WILAYA_LIST,
  type StubTable,
} from './harness'

/**
 * The registration wizard end to end.
 *
 * `submitApplication` still posts one `CreateApplicationRequest` exactly as
 * the single-page form did — these tests exercise the wizard's own new
 * surface (steps, per-step validation, the review screen) and then confirm
 * the request it eventually sends is unchanged.
 */

const WINDOW_OPEN = { body: { drawYear: 2027, isOpen: true } }

function baseStubs(extra: StubTable = {}) {
  stubApi({
    '/api/applications/registration-window': WINDOW_OPEN,
    '/api/wilayas': { body: WILAYA_LIST },
    [`/api/wilayas/${WILAYA_LIST[0]!.id}/communes`]: { body: COMMUNE_LIST },
    ...extra,
  })
}

async function fillPrimary(name = 'Amine Kaddour', nationalId = '123456789012345678') {
  await userEvent.type(screen.getByLabelText(/national id number/i), nationalId)
  await userEvent.type(screen.getByLabelText(/full name/i), name)
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '1990-05-12' } })
}

async function chooseLocation() {
  await userEvent.click(screen.getByLabelText(/wilaya/i))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(WILAYA.nameEn) }))
  await userEvent.click(screen.getByLabelText(/commune/i))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(COMMUNE.nameEn) }))
}

describe('the registration wizard', () => {
  it('starts on the participation step with individual selected', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await screen.findByRole('heading', { name: 'Register' })

    expect(screen.getByRole('radio', { name: /on my own/i })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('shows a loading placeholder while wilayas are still being fetched', async () => {
    await switchLocale('en')

    // Only the wilaya list hangs — the registration window still answers, so
    // the wizard itself renders and the loading state under test is the
    // picker's own, not the page-level gate above it.
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost:4000')
        if (url.pathname === '/api/applications/registration-window') {
          return Promise.resolve({ ok: true, status: 200, json: async () => WINDOW_OPEN.body } as Response)
        }
        if (url.pathname === '/api/wilayas') return new Promise<Response>(() => {})
        throw new Error(`Unstubbed fetch: ${url.pathname}`)
      }),
    )

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Loading…')).toBeInTheDocument()
  })

  it('keeps the commune picker disabled until a wilaya is chosen', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/wilaya/i)

    expect(screen.getByLabelText(/commune/i)).toBeDisabled()

    await userEvent.click(screen.getByLabelText(/wilaya/i))
    await userEvent.click(await screen.findByRole('option', { name: new RegExp(WILAYA.nameEn) }))

    await waitFor(() => expect(screen.getByLabelText(/commune/i)).not.toBeDisabled())
  })

  it('blocks leaving the location step without a wilaya and a commune', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/wilaya/i)

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(screen.getByText('Select a wilaya.')).toBeInTheDocument()
    // Still on the location step — its own fields are still on screen.
    expect(screen.getByLabelText(/wilaya/i)).toBeInTheDocument()
  })

  it('blocks leaving the applicant step with an incomplete national ID', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByLabelText(/national id number/i)

    await userEvent.type(screen.getByLabelText(/national id number/i), '123')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(screen.getByText('Enter the 18-digit national ID number.')).toBeInTheDocument()
  })

  it('completes a single applicant through review and submits the same request as before', async () => {
    await switchLocale('en')
    baseStubs({
      '/api/applications': (_url: URL, init: RequestInit | undefined) => ({
        status: 201,
        body: {
          applicationReference: 'HZ-2027-MES-8F42K1',
          drawYear: 2027,
          entryType: 'SINGLE',
          status: 'PENDING',
          applicantCount: 1,
          commune: COMMUNE,
          wilaya: WILAYA,
          submittedAt: '2026-03-04T09:15:00.000Z',
        },
        _init: init,
      }),
    })

    renderPage(<Register />)

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    // The review step names every section and lets each be edited.
    await screen.findByRole('heading', { name: 'Your details' })
    expect(screen.getAllByRole('button', { name: /^edit:/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('Amine Kaddour')).toBeInTheDocument()
    expect(screen.getByText(WILAYA.nameEn)).toBeInTheDocument()
    expect(screen.getByText(COMMUNE.nameEn)).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Submit application' }))

    expect(await screen.findByText('HZ-2027-MES-8F42K1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Registration received' })).toBeInTheDocument()

    const posted = requestLog.find((entry) => entry.method === 'POST')
    const body = JSON.parse(posted?.body ?? '{}') as { entryType: string; secondary?: unknown }
    expect(body.entryType).toBe('SINGLE')
    expect(body.secondary).toBeUndefined()
    expect(requestedPaths().every((path) => !path.startsWith('/api/admin'))).toBe(true)
  })

  it('adds a secondary-applicant step only for a paired application, and rejects the same person twice', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('radio', { name: /as a pair/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await fillPrimary('Amine Kaddour', '123456789012345678')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    // The pair's second step, reached only because PAIRED was chosen.
    await screen.findByRole('heading', { name: 'Second applicant' })
    await fillPrimary('Amine Kaddour', '123456789012345678')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(screen.getByText('The two applicants must be different people.')).toBeInTheDocument()
  })

  it('lets the review step jump back to any earlier section to edit it', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Your details' })

    await userEvent.click(await screen.findByRole('button', { name: 'Edit: Your details' }))

    expect(await screen.findByLabelText(/national id number/i)).toHaveValue('123456789012345678')
  })

  it('shows the server refusal on the review step rather than resetting the wizard', async () => {
    await switchLocale('en')
    baseStubs({
      '/api/applications': { status: 409, body: { error: 'Already applied', code: 'ALREADY_APPLIED' } },
    })

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Submit application' }))

    expect(
      await screen.findByText('An application already exists for this draw year for one of the applicants.'),
    ).toBeInTheDocument()
    // Still on the review step — nothing was cleared by the failed attempt.
    expect(screen.getByRole('button', { name: 'Submit application' })).toBeInTheDocument()
  })

  it('never puts a national ID or a phone number in the address bar', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await fillPrimary()
    await userEvent.type(screen.getByLabelText(/mobile number/i), '0555123456')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(window.location.pathname + window.location.search).not.toMatch(/123456789012345678|0555123456/)
  })

  it('renders the wizard in Arabic with the same step flow', async () => {
    await switchLocale('ar')
    baseStubs()

    renderPage(<Register />)
    expect(await screen.findByRole('heading', { name: 'التسجيل' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'التالي' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
  })
})
