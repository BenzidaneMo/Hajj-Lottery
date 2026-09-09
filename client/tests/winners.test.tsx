import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PUBLIC_PAGE_SIZE_MAX } from '@hajj-lottery/shared'

import { PublicResult } from '../src/pages/PublicResult'
import { Winners } from '../src/pages/Winners'
import {
  COMMUNE_LIST,
  expectNoPrivateData,
  FORBIDDEN_VALUES,
  fullResult,
  page,
  renderAt,
  renderPage,
  requestedPaths,
  resultSummary,
  stubApi,
  switchLocale,
  WILAYA_LIST,
} from './harness'

const RESULTS = '/api/public/results'
const WILAYAS = '/api/wilayas'
const COMMUNES = '/api/wilayas/wil-1/communes'
const RESULT_PATH = '/api/public/results/2027/27/2703'

/**
 * The winners listing and one commune's official result.
 *
 * The privacy assertions here are about what a winner list *is*: an order, a
 * reference, and a count of pilgrims. Not a name — publishing names is a
 * decision for the governing authority to take explicitly, and until it does,
 * the absence of that column is policy rather than an oversight. The tests
 * assert the exact column set rather than the absence of particular strings, so
 * a column added later fails here instead of appearing in public.
 */

function resultsPage(items = [resultSummary()], overrides = {}) {
  return { [RESULTS]: { body: page(items, overrides) } }
}

const geo = {
  [WILAYAS]: { body: WILAYA_LIST },
  [COMMUNES]: { body: COMMUNE_LIST },
}

describe('winners listing', () => {
  it('renders announced results', async () => {
    await switchLocale('en')
    stubApi({ ...geo, ...resultsPage() })
    renderPage(<Winners />)

    expect(await screen.findByRole('link', { name: 'Hassi Mameche' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Official results' })).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Mostaganem')).toBeInTheDocument()
    expect(within(table).getByText('2027')).toBeInTheDocument()
    expect(within(table).getByText('14')).toBeInTheDocument()
  })

  it('shows an empty state rather than inventing an unpublished result', async () => {
    await switchLocale('en')
    // The listing is served from the publication table, so an unpublished
    // commune is absent rather than filtered — there is no page state in which
    // one could appear, and none in which winners are shown for one.
    stubApi({ ...geo, ...resultsPage([], { total: 0, totalPages: 1 }) })
    renderPage(<Winners />)

    expect(await screen.findByText('No results have been announced yet.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('filters by year, wilaya and commune, using official codes', async () => {
    await switchLocale('en')
    stubApi({ ...geo, ...resultsPage() })
    renderPage(<Winners />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Draw year'), '2027')
    await user.selectOptions(screen.getByLabelText('Wilaya'), '27')
    await user.selectOptions(await screen.findByLabelText('Commune'), '2703')

    const last = requestedPaths()
      .filter((path) => path.startsWith(RESULTS))
      .at(-1)
    expect(last).toContain('drawYear=2027')
    expect(last).toContain('wilayaCode=27')
    expect(last).toContain('communeCode=2703')
    // Codes, never internal ids. The wilaya's id is in the reference data this
    // page loaded, and it must not travel to a public endpoint.
    expect(last).not.toContain('wil-1')
    expect(last).not.toContain('com-1')
  })

  it('clearing the wilaya clears the commune with it', async () => {
    await switchLocale('en')
    stubApi({ ...geo, ...resultsPage() })
    renderPage(<Winners />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Wilaya'), '27')
    await user.selectOptions(await screen.findByLabelText('Commune'), '2703')
    await user.selectOptions(screen.getByLabelText('Wilaya'), '')

    const last = requestedPaths()
      .filter((path) => path.startsWith(RESULTS))
      .at(-1)
    expect(last).not.toContain('communeCode')
    expect(last).not.toContain('wilayaCode')
  })

  it('pages forwards and back', async () => {
    await switchLocale('en')
    stubApi({
      ...geo,
      [RESULTS]: (url) => ({
        body: page([resultSummary({ drawYear: Number(url.searchParams.get('page')) === 2 ? 2026 : 2027 })], {
          page: Number(url.searchParams.get('page') ?? 1),
          total: 40,
          totalPages: 2,
        }),
      }),
    })
    renderPage(<Winners />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('2026')).toBeInTheDocument()
    expect(requestedPaths().some((path) => path.includes('page=2'))).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('2027')).toBeInTheDocument()
  })

  it('never asks for an unbounded page', async () => {
    await switchLocale('en')
    stubApi({ ...geo, ...resultsPage() })
    renderPage(<Winners />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    for (const path of requestedPaths().filter((entry) => entry.startsWith('/api/public/'))) {
      const size = new URL(path, 'http://x').searchParams.get('pageSize')
      expect(size).not.toBeNull()
      expect(Number(size)).toBeLessThanOrEqual(PUBLIC_PAGE_SIZE_MAX)
    }
  })

  it('does not refetch when only the locale changes', async () => {
    await switchLocale('en')
    stubApi({ ...geo, ...resultsPage() })
    renderPage(<Winners />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    const before = requestedPaths().filter((path) => path.startsWith(RESULTS)).length
    await switchLocale('fr')
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    // Every locale travels in the payload, so switching language re-renders and
    // asks for nothing. A published result is the most cacheable response in
    // the system and re-fetching it for a re-render would waste that.
    expect(requestedPaths().filter((path) => path.startsWith(RESULTS))).toHaveLength(before)
  })

  it('reaches no endpoint outside the public API', async () => {
    await switchLocale('en')
    stubApi({ ...geo, ...resultsPage() })
    renderPage(<Winners />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    for (const path of requestedPaths()) {
      expect(path.startsWith('/api/public/') || path.startsWith('/api/wilayas')).toBe(true)
      expect(path).not.toContain('/api/admin')
      expect(path).not.toContain('/api/participants')
    }
  })

  it('renders in Arabic, French and English', async () => {
    for (const [locale, heading] of [
      ['ar', 'النتائج الرسمية'],
      ['fr', 'Résultats officiels'],
      ['en', 'Official results'],
    ] as const) {
      await switchLocale(locale)
      stubApi({ ...geo, ...resultsPage() })
      const view = renderPage(<Winners />)

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr')
      view.unmount()
    }
  })
})

describe('one commune’s official result', () => {
  const renderResult = () =>
    renderAt(<PublicResult />, '/results/:drawYear/:wilayaCode/:communeCode', '/results/2027/27/2703')

  it('renders the summary and the winning applications', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult() } })
    renderResult()

    expect(await screen.findByRole('heading', { name: 'Hassi Mameche — 2027 draw' })).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('HZ-2027-MES-8F42K1')).toBeInTheDocument()
    expect(within(table).getByText('HZ-2027-MES-QQ19ZP')).toBeInTheDocument()
    // A pair is one winning application covering two pilgrims.
    expect(within(table).getByText('Pair')).toBeInTheDocument()
  })

  it('publishes exactly four columns, and no winner name among them', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult() } })
    renderResult()

    const table = await screen.findByRole('table')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)

    // The whole published record of a winner. Adding a fifth column — a name
    // above all — is a policy decision and has to fail here first.
    expect(headers).toEqual(['Order drawn', 'Application reference', 'Type', 'Pilgrims'])
  })

  it('renders nothing identifying, whatever the API sends', async () => {
    await switchLocale('en')
    stubApi({
      [RESULT_PATH]: {
        body: {
          ...fullResult(),
          winners: [
            {
              selectionOrder: 1,
              applicationReference: 'HZ-2027-MES-8F42K1',
              entryType: 'SINGLE',
              participantCount: 1,
              // None of this is in the DTO. If a future column arrives, the
              // page must still not render it.
              fullName: FORBIDDEN_VALUES.fullName,
              nationalId: FORBIDDEN_VALUES.nationalId,
              phoneNumber: FORBIDDEN_VALUES.phoneNumber,
              dob: FORBIDDEN_VALUES.dob,
              participantId: FORBIDDEN_VALUES.participantId,
              selectedWeight: 17,
            },
          ],
          randomValue: FORBIDDEN_VALUES.randomValue,
          activeTotalWeight: 4211,
        },
      },
    })
    renderResult()

    await screen.findByRole('table')
    expectNoPrivateData(document.body)
    expect(document.body.textContent).not.toContain(FORBIDDEN_VALUES.randomValue)
    expect(document.body.textContent).not.toContain('4211')
  })

  it('shows a safe unpublished state and no winner data for a 404', async () => {
    await switchLocale('en')
    // The same 404 covers "never drew", "drawn but unannounced" and "no such
    // commune". The page does not try to tell them apart, because the
    // difference is exactly what would be worth knowing before an announcement.
    stubApi({ [RESULT_PATH]: { status: 404, body: { error: 'none', code: 'RESULT_NOT_PUBLISHED' } } })
    renderResult()

    expect(await screen.findByText('No result announced')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('HZ-')
  })

  it('addresses the result by code, with no database id in the URL', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult() } })
    renderResult()
    await screen.findByRole('table')

    expect(requestedPaths()).toEqual(['/api/public/results/2027/27/2703'])
  })

  it('renders the pool hash as verification, and no random value beside it', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult() } })
    renderResult()

    expect(await screen.findByText('a'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('weighted-csprng-v1')).toBeInTheDocument()
    // The commitment is published; the randomness that consumed it is not.
    expect(document.body.innerHTML).not.toMatch(/random[_ ]?value/i)
  })
})
