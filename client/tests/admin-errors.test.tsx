import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AdminApplications } from '../src/pages/admin/AdminApplications'

import { renderAdmin } from './admin-harness'
import { stubApi, switchLocale, WILAYA_LIST } from './harness'

/**
 * What an operator is told when a request fails.
 *
 * One sentence per status, translated, and never the server's own message: it
 * is written for a developer, it is not translated, and on a 500 it may
 * describe the inside of the system. An unrecognised failure falls back to the
 * generic sentence rather than leaking whatever came back.
 */

const GEO = {
  '/api/admin/wilayas': { body: WILAYA_LIST },
  '/api/admin/communes': { body: [] },
}

async function renderWithStatus(status: number, code: string) {
  await switchLocale('en')
  stubApi({
    ...GEO,
    '/api/admin/applications': {
      status,
      // A message that must never reach the screen.
      body: { error: 'PrismaClientKnownRequestError at users.wilaya_id', code },
    },
  })
  renderAdmin(<AdminApplications />)
  return screen.findByRole('alert')
}

describe('failed requests', () => {
  it('reports an expired session', async () => {
    await renderWithStatus(401, 'UNAUTHORIZED')
    expect(screen.getByText('Your session has ended. Please sign in again.')).toBeInTheDocument()
  })

  it('reports a refusal by role', async () => {
    await renderWithStatus(403, 'FORBIDDEN_ROLE')
    expect(screen.getByText('You do not have permission to do this.')).toBeInTheDocument()
  })

  it('reports a 404 without saying whether it exists for somebody else', async () => {
    const alert = await renderWithStatus(404, 'APPLICATION_NOT_FOUND')

    // Out of scope and never issued are byte-identical answers from the API,
    // so the wording must cover both without implying which.
    expect(within(alert).getByText('This is not available.')).toBeInTheDocument()
    expect(alert.textContent ?? '').not.toMatch(/permission|scope|territory|another|does not exist/i)
  })

  it('reports a state conflict as something that already changed', async () => {
    await renderWithStatus(409, 'DRAW_ALREADY_COMPLETED')
    expect(screen.getByText('This has already changed. Reload and try again.')).toBeInTheDocument()
  })

  it('reports invalid input', async () => {
    await renderWithStatus(422, 'INVALID_SCOPE_ASSIGNMENT')
    expect(screen.getByText('Some of the details were not accepted.')).toBeInTheDocument()
  })

  it('reports rate limiting without naming the limiter state', async () => {
    await renderWithStatus(429, 'TOO_MANY_ATTEMPTS')

    expect(screen.getByText('Too many attempts. Please wait and try again.')).toBeInTheDocument()
    // No remaining count, no reset time — that is limiter state, and
    // publishing it tells an attacker how close they are.
    expect(document.body.textContent).not.toMatch(/\d+ remaining|retry after|reset/i)
  })

  it('reports a server fault without the server’s own words', async () => {
    await renderWithStatus(500, 'INTERNAL_ERROR')

    expect(screen.getByText('The server could not complete this request.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('PrismaClientKnownRequestError')
    expect(document.body.textContent).not.toContain('wilaya_id')
  })

  it('reports an unreachable server distinctly from one that answered', async () => {
    await switchLocale('en')
    stubApi(GEO)
    // `/api/admin/applications` is unstubbed, so the harness throws — the same
    // shape as a network failure rather than an HTTP error.

    renderAdmin(<AdminApplications />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Could not reach the server. Check your connection.')).toBeInTheDocument()
  })

  it('offers the message in the operator’s language', async () => {
    await switchLocale('fr')
    stubApi({
      ...GEO,
      '/api/admin/applications': { status: 403, body: { error: 'x', code: 'FORBIDDEN_ROLE' } },
    })

    renderAdmin(<AdminApplications />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText("Vous n'avez pas l'autorisation d'effectuer cette action.")).toBeInTheDocument()
  })
})
