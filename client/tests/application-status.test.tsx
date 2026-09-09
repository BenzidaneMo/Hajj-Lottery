import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ApplicationStatus } from '../src/pages/ApplicationStatus'
import {
  applicationStatus,
  expectNoPrivateData,
  FORBIDDEN_VALUES,
  renderPage,
  requestedPaths,
  requestLog,
  stubApi,
  switchLocale,
} from './harness'

const LOOKUP = '/api/public/application-status'

/**
 * The citizen-facing lookup.
 *
 * The assertions that matter most here are the negative ones. This page sits in
 * front of an endpoint built so that an unknown reference and a wrong mobile
 * number are indistinguishable, and a UI that tells them apart would give away
 * through rendering exactly what the API refuses to give away through its
 * responses. So the two failure paths are compared against each other rather
 * than each checked against a fixed string: whatever the page says, it has to
 * say the same thing to both.
 */

async function submit(reference: string, phone: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/reference|المرجع|Référence/i), reference)
  await user.type(screen.getByLabelText(/mobile|هاتف|mobile/i), phone)
  await user.click(screen.getByRole('button', { name: /check status|التحقق|Vérifier/i }))
  return user
}

describe('application status page', () => {
  it('renders the lookup form before anything is submitted', async () => {
    await switchLocale('en')
    stubApi({})
    renderPage(<ApplicationStatus />)

    expect(screen.getByRole('heading', { name: 'Check your application' })).toBeInTheDocument()
    expect(screen.getByLabelText('Application reference')).toBeInTheDocument()
    expect(screen.getByLabelText('Mobile number')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument()

    // Nothing has been asked of the API yet: an unsubmitted form is not a query.
    expect(requestLog).toHaveLength(0)
  })

  it('shows the application after a successful lookup', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus({ status: 'IN_DRAW' }) } })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('HZ-2027-MES-8F42K1')).toBeInTheDocument()
    expect(screen.getByText('Entered in the draw')).toBeInTheDocument()
    expect(screen.getByText('Hassi Mameche', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('Mostaganem', { selector: 'dd' })).toBeInTheDocument()
  })

  it('posts the lookup, so neither value reaches the URL', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')
    await screen.findByText('HZ-2027-MES-8F42K1')

    const [request] = requestLog
    expect(request?.method).toBe('POST')
    // Neither the reference nor the number appears anywhere in the address —
    // not as a query parameter, not as a path segment. They would otherwise
    // reach access logs, browser history and every proxy in between.
    expect(request?.url).not.toContain('HZ-2027')
    expect(request?.url).not.toContain('0555')
    expect(request?.body).toContain('HZ-2027-MES-8F42K1')
  })

  it('gives the same message for a wrong number and an unknown reference', async () => {
    await switchLocale('en')

    stubApi({
      [LOOKUP]: { status: 404, body: { error: 'No application matches', code: 'STATUS_LOOKUP_FAILED' } },
    })
    const wrongPhone = renderPage(<ApplicationStatus />)
    await submit('HZ-2027-MES-8F42K1', '0555000000')
    const wrongPhoneMessage = (await screen.findByRole('alert')).textContent
    wrongPhone.unmount()

    stubApi({
      [LOOKUP]: { status: 404, body: { error: 'No application matches', code: 'STATUS_LOOKUP_FAILED' } },
    })
    renderPage(<ApplicationStatus />)
    await submit('HZ-9999-XXX-000000', '0555123456')
    const unknownReferenceMessage = (await screen.findByRole('alert')).textContent

    expect(wrongPhoneMessage).toBe(unknownReferenceMessage)
    expect(wrongPhoneMessage).toBeTruthy()
  })

  it('gives that same message for a malformed reference the API rejects', async () => {
    await switchLocale('en')

    // The server treats a malformed reference as just another wrong one. A
    // page that said "that is not a valid reference" would tell somebody
    // probing it which shapes are worth sending.
    stubApi({ [LOOKUP]: { status: 400, body: { error: 'Check the values', code: 'VALIDATION_FAILED' } } })
    renderPage(<ApplicationStatus />)
    await submit('nonsense', '0555123456')

    const message = (await screen.findByRole('alert')).textContent
    expect(message).toBe(
      'We could not find an application matching that reference and mobile number. Check both and try again.',
    )
  })

  it('renders no national ID, phone number, date of birth, weight or history', async () => {
    await switchLocale('en')
    stubApi({
      [LOOKUP]: {
        // Deliberately more than the DTO promises. A page that renders its
        // response by walking keys would leak all of this; this one names
        // every field it shows, so none of it appears.
        body: {
          ...applicationStatus({ status: 'SELECTED', resultsPublished: true }),
          nationalId: FORBIDDEN_VALUES.nationalId,
          phoneNumber: FORBIDDEN_VALUES.phoneNumber,
          dob: FORBIDDEN_VALUES.dob,
          fullName: FORBIDDEN_VALUES.fullName,
          participantId: FORBIDDEN_VALUES.participantId,
          calculatedWeight: 17,
          participationHistory: [{ drawYear: 2025, participated: true, won: false }],
        },
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')
    await screen.findByText('HZ-2027-MES-8F42K1')

    expectNoPrivateData(document.body)
    expect(document.body.textContent).not.toContain('2025')
  })

  it('does not echo the submitted mobile number back to the page', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')
    await screen.findByText('HZ-2027-MES-8F42K1')

    // The form is replaced by the result, so the typed number is gone from the
    // document entirely rather than sitting in an input behind the answer.
    expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('0555123456')
  })

  it('withholds the outcome while the result is unpublished', async () => {
    await switchLocale('en')
    stubApi({
      [LOOKUP]: {
        body: applicationStatus({ status: 'AWAITING_RESULTS', drawPhase: 'DRAWN', resultsPublished: false }),
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('Results not yet published')).toBeInTheDocument()
    expect(screen.getByText('The draw has been held — results not yet announced')).toBeInTheDocument()
    // Neither outcome is on the page, and nothing here could reconstruct one.
    expect(screen.queryByText('Your application was selected')).not.toBeInTheDocument()
    expect(screen.queryByText('Your application was not selected')).not.toBeInTheDocument()
  })

  it('shows a published selection', async () => {
    await switchLocale('en')
    stubApi({
      [LOOKUP]: {
        body: applicationStatus({ status: 'SELECTED', drawPhase: 'DRAWN', resultsPublished: true }),
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('Your application was selected')).toBeInTheDocument()
    expect(screen.queryByText('Results not yet published')).not.toBeInTheDocument()
  })

  it('withholds a reserve position exactly as it withholds the other outcomes', async () => {
    await switchLocale('en')
    // The server collapses SELECTED, RESERVE and NOT_SELECTED onto
    // AWAITING_RESULTS before publication, so this is what a reserve's own
    // lookup returns. The page must not reconstruct anything from it: three
    // outcomes told apart early are three outcomes somebody can learn by
    // polling their own reference.
    stubApi({
      [LOOKUP]: {
        body: applicationStatus({ status: 'AWAITING_RESULTS', drawPhase: 'DRAWN', resultsPublished: false }),
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('Results not yet published')).toBeInTheDocument()
    expect(screen.queryByText('On the reserve list')).not.toBeInTheDocument()
    expect(screen.queryByText(/reserve list for your commune/i)).not.toBeInTheDocument()
  })

  it('shows a published reserve position', async () => {
    await switchLocale('en')
    stubApi({
      [LOOKUP]: {
        body: applicationStatus({ status: 'RESERVE', drawPhase: 'DRAWN', resultsPublished: true }),
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('Your application is on the reserve list')).toBeInTheDocument()
    expect(screen.getByText('On the reserve list')).toBeInTheDocument()
    // A reserve is neither of the other two, and the page says so in words
    // rather than leaving the badge's colour to carry it.
    expect(screen.queryByText('Your application was selected')).not.toBeInTheDocument()
    expect(screen.queryByText('Your application was not selected')).not.toBeInTheDocument()
    // Where in the list they stand is an administrative fact about other
    // households, and the DTO carries no reserve position for the page to show.
    expect(document.body.textContent).not.toMatch(/reserve\s*#\s*\d|position\s*\d/i)
    // Nor does the lifecycle vocabulary reach this page. The reserve-status
    // labels belong to the published result's reserve list, where they describe
    // the draw; here they would describe one identifiable applicant's standing.
    for (const label of ['Waiting', 'Called', 'Promoted to winner', 'Declined']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('shows a promoted reserve as a selection, since that is what the API says', async () => {
    await switchLocale('en')
    // A promoted reserve's application becomes SELECTED server-side. The client
    // renders the status it is given and derives nothing: there is no branch
    // here that turns a reserve into a winner.
    stubApi({
      [LOOKUP]: {
        body: applicationStatus({ status: 'SELECTED', drawPhase: 'DRAWN', resultsPublished: true }),
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('Your application was selected')).toBeInTheDocument()
    expect(screen.queryByText('On the reserve list')).not.toBeInTheDocument()
  })

  it('shows a published non-selection', async () => {
    await switchLocale('en')
    stubApi({
      [LOOKUP]: {
        body: applicationStatus({ status: 'NOT_SELECTED', drawPhase: 'DRAWN', resultsPublished: true }),
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    expect(await screen.findByText('Your application was not selected')).toBeInTheDocument()
    expect(screen.getByText('Not selected')).toBeInTheDocument()
  })

  it('handles a rate-limited lookup without naming a cause', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { status: 429, body: { error: 'Too many', code: 'TOO_MANY_ATTEMPTS' } } })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many attempts. Please wait a while before trying again.')
    // Says nothing about whose attempts used the budget, or whether the
    // reference was real — a fake and a genuine one accumulate identically.
    expect(alert.textContent).not.toMatch(/reference (exists|is valid)|another person|someone else/i)
  })

  it('handles a network failure without exposing anything of the failure', async () => {
    await switchLocale('en')
    stubApi({}) // any request throws, as a dead network would
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not reach the service. Check your connection and try again.')
    expect(alert.textContent).not.toContain('Unstubbed')
    expect(alert.textContent).not.toContain('/api/')
  })

  it('renders a 5xx as a generic service message, never the API body', async () => {
    await switchLocale('en')
    stubApi({
      [LOOKUP]: {
        status: 500,
        body: { error: 'PrismaClientKnownRequestError: P2002 at line 41', code: 'INTERNAL' },
      },
    })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The service is unavailable at the moment. Please try again shortly.')
    expect(alert.textContent).not.toContain('Prisma')
    expect(alert.textContent).not.toContain('P2002')
  })

  it('renders in Arabic, right to left', async () => {
    await switchLocale('ar')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    expect(document.documentElement.dir).toBe('rtl')
    expect(document.documentElement.lang).toBe('ar')
    expect(screen.getByRole('heading', { name: 'متابعة طلبك' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'التحقق من الحالة' })).toBeInTheDocument()
  })

  it('renders in French, left to right', async () => {
    await switchLocale('fr')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByRole('heading', { name: 'Suivre votre demande' })).toBeInTheDocument()
  })

  it('renders in English, left to right', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    expect(document.documentElement.dir).toBe('ltr')
    expect(screen.getByRole('heading', { name: 'Check your application' })).toBeInTheDocument()
  })

  it('keeps itself out of search results', async () => {
    await switchLocale('en')
    stubApi({})
    const view = renderPage(<ApplicationStatus />)

    const robots = document.head.querySelector('meta[name="robots"]')
    expect(robots?.getAttribute('content')).toContain('noindex')

    // Removed on unmount, so the results pages — which should be indexable —
    // are not caught by a tag left behind.
    view.unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })

  it('stores nothing about the lookup on the device', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus({ status: 'SELECTED', resultsPublished: true }) } })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')
    await screen.findByText('HZ-2027-MES-8F42K1')

    // There is no citizen session and nothing to resume. A shared machine must
    // not hand the next person somebody's reference, number or outcome.
    const stored = [
      ...Object.entries({ ...window.localStorage }),
      ...Object.entries({ ...window.sessionStorage }),
    ]
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('|')

    expect(stored).not.toContain('HZ-2027')
    expect(stored).not.toContain('0555123456')
    expect(stored).not.toContain('SELECTED')
    expect(document.cookie).toBe('')
  })

  it('clears the form when the citizen checks another application', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    const user = await submit('HZ-2027-MES-8F42K1', '0555123456')
    await screen.findByText('HZ-2027-MES-8F42K1')

    await user.click(screen.getByRole('button', { name: 'Check another application' }))

    await waitFor(() => expect(screen.getByLabelText('Application reference')).toHaveValue(''))
    expect(screen.getByLabelText('Mobile number')).toHaveValue('')
    expect(screen.queryByText('HZ-2027-MES-8F42K1')).not.toBeInTheDocument()
  })

  it('never calls an internal participant or application endpoint', async () => {
    await switchLocale('en')
    stubApi({ [LOOKUP]: { body: applicationStatus() } })
    renderPage(<ApplicationStatus />)

    await submit('HZ-2027-MES-8F42K1', '0555123456')
    await screen.findByText('HZ-2027-MES-8F42K1')

    for (const path of requestedPaths()) {
      expect(path.startsWith('/api/public/')).toBe(true)
      expect(path).not.toContain('/api/admin')
      expect(path).not.toContain('/api/participants')
      expect(path).not.toContain('/api/applications')
    }
  })
})
