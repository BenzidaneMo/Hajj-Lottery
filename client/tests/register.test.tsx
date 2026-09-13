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
 * The wizard's step order is decided by the primary applicant, not chosen up
 * front: `primary` (identity + gender) always comes first, because only once
 * gender and age are known can the flow decide whether an entry-type choice
 * exists at all. A male applicant is forced to `SINGLE` and never sees the
 * choice; a woman under 45 is forced to `PAIRED` (mandatory Mahram) and never
 * sees it either; only a woman 45 or older is offered a real choice. These
 * tests default to a male primary — the simplest, choice-free path — except
 * where a test is specifically about the Mahram rule.
 *
 * `submitApplication` still posts one `CreateApplicationRequest` exactly as
 * the single-page form did — these tests exercise the wizard's own surface
 * (steps, per-step validation, the review screen) and then confirm the
 * request it eventually sends is unchanged.
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

interface ApplicantFill {
  firstNameLatin?: string
  lastNameLatin?: string
  firstNameAr?: string
  lastNameAr?: string
  nationalId?: string
  gender?: 'MALE' | 'FEMALE'
  /** A comfortably-over-19, comfortably-under-45 date of birth by default. */
  dob?: string
  phoneNumber?: string
}

/**
 * Fills whichever `ApplicantFields` instance is currently on screen — the
 * primary step's or, called again after advancing, the secondary/Mahram
 * step's, since the two share one labeled field set and only one is ever
 * mounted at a time.
 */
async function fillPrimary(overrides: ApplicantFill = {}) {
  const {
    firstNameLatin = 'Amine',
    lastNameLatin = 'Kaddour',
    firstNameAr = 'أمين',
    lastNameAr = 'قدور',
    nationalId = '123456789012345678',
    gender = 'MALE',
    dob = '1990-05-12',
    phoneNumber = '0555123456',
  } = overrides

  await userEvent.type(await screen.findByLabelText(/national id number/i), nationalId)
  await userEvent.click(screen.getByLabelText(/^gender/i))
  await userEvent.click(await screen.findByRole('option', { name: gender === 'MALE' ? 'Male' : 'Female' }))
  await userEvent.type(screen.getByLabelText(/first name \(arabic\)/i), firstNameAr)
  await userEvent.type(screen.getByLabelText(/last name \(arabic\)/i), lastNameAr)
  await userEvent.type(screen.getByLabelText(/first name \(latin\)/i), firstNameLatin)
  await userEvent.type(screen.getByLabelText(/last name \(latin\)/i), lastNameLatin)
  fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: dob } })
  await userEvent.type(screen.getByLabelText(/mobile number/i), phoneNumber)
}

async function chooseLocation() {
  await userEvent.click(screen.getByLabelText(/wilaya/i))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(WILAYA.nameEn) }))
  await userEvent.click(screen.getByLabelText(/commune/i))
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(COMMUNE.nameEn) }))
}

describe('the registration wizard', () => {
  it('starts on the applicant-details step', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await screen.findByRole('heading', { name: 'Register' })

    expect(screen.getByLabelText(/national id number/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^gender/i)).toBeInTheDocument()
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
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Loading…')).toBeInTheDocument()
  })

  it('keeps the commune picker disabled until a wilaya is chosen', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await fillPrimary()
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
    await fillPrimary()
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
    await screen.findByLabelText(/national id number/i)

    await userEvent.type(screen.getByLabelText(/national id number/i), '123')
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(screen.getByText('Enter the 18-digit national ID number.')).toBeInTheDocument()
  })

  it('blocks leaving the applicant step under the minimum age', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await fillPrimary({ dob: '2020-01-01' })
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(
      screen.getByText("The applicant must have completed 19 years on today's date."),
    ).toBeInTheDocument()
  })

  it('completes a single male applicant through review and submits the same request as before', async () => {
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

    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    // A male applicant is never offered the entry-type choice or a secondary
    // step — the review screen follows location directly.
    await screen.findByRole('heading', { name: 'Your details' })
    expect(screen.getAllByRole('button', { name: /^edit:/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('Amine')).toBeInTheDocument()
    expect(screen.getByText('Kaddour')).toBeInTheDocument()
    expect(screen.getByText(WILAYA.nameEn)).toBeInTheDocument()
    expect(screen.getByText(COMMUNE.nameEn)).toBeInTheDocument()
    expect(
      screen.getByText('You can register individually. A Mahram is not required for male applicants.'),
    ).toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: 'Submit application' }))

    expect(await screen.findByText('HZ-2027-MES-8F42K1')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Registration received' })).toBeInTheDocument()

    const posted = requestLog.find((entry) => entry.method === 'POST')
    const body = JSON.parse(posted?.body ?? '{}') as { entryType: string; secondary?: unknown }
    expect(body.entryType).toBe('SINGLE')
    expect(body.secondary).toBeUndefined()
    expect(requestedPaths().every((path) => !path.startsWith('/api/admin'))).toBe(true)
  })

  it('forces a Mahram on a woman under 45, with no entry-type choice, and rejects the same person twice', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    // Under 45 — the Mahram flow is mandatory, so the wizard never shows the
    // entry-type choice at all; it goes straight from the applicant to location.
    await fillPrimary({ gender: 'FEMALE', dob: '1990-05-12' })
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    // The pair's second step, reached without ever choosing PAIRED explicitly.
    await screen.findByRole('heading', { name: 'Second applicant' })
    expect(screen.getByText('A woman under 45 must register with a male Mahram.')).toBeInTheDocument()
    // Only a male Mahram may be offered here.
    await userEvent.click(screen.getByLabelText(/^gender/i))
    expect(screen.getByRole('option', { name: 'Male' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Female' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await fillPrimary({ dob: '1982-06-30' })
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    expect(screen.getByText('The two applicants must be different people.')).toBeInTheDocument()
  })

  it('offers a woman 45 or older the choice, and defaults her out of the Mahram flow', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    // 45 comfortably ago — the Mahram flow becomes optional, so the wizard
    // offers the choice screen next instead of forcing PAIRED.
    await fillPrimary({
      firstNameLatin: 'Zohra',
      lastNameLatin: 'Belkacem',
      nationalId: '567856785678567856',
      gender: 'FEMALE',
      dob: '1970-01-01',
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    await screen.findByRole('heading', { name: 'How are you applying?' })
    expect(screen.getByRole('radio', { name: /on my own/i })).toBeChecked()

    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))

    // Chose "on my own", so no secondary step — straight to review.
    await screen.findByRole('heading', { name: 'Your details' })
  })

  it('lets the review step jump back to any earlier section to edit it', async () => {
    await switchLocale('en')
    baseStubs()

    renderPage(<Register />)
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
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
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
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
    await fillPrimary()
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await chooseLocation()
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
