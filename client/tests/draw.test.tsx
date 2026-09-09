import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { PUBLIC_PAGE_SIZE_MAX } from '@hajj-lottery/shared'

import { Draw } from '../src/pages/Draw'
import { DrawWatch } from '../src/pages/DrawWatch'
import {
  COMMUNE_LIST,
  drawStatus,
  expectNoPrivateData,
  forceReducedMotion,
  fullResult,
  page,
  renderAt,
  renderPage,
  requestedPaths,
  requestLog,
  stubApi,
  stubNeverResolves,
  switchLocale,
  WILAYA_LIST,
} from './harness'

const DRAW_STATUS = '/api/public/draw-status'
const RESULT_PATH = '/api/public/results/2027/27/2703'
const WILAYAS = '/api/wilayas'
const COMMUNES = '/api/wilayas/wil-1/communes'

const geo = {
  [WILAYAS]: { body: WILAYA_LIST },
  [COMMUNES]: { body: COMMUNE_LIST },
}

const watchPath = '/draw/:drawYear/:wilayaCode/:communeCode'
const watchUrl = '/draw/2027/27/2703'

describe('public draw status page', () => {
  it('renders each commune’s stage', async () => {
    await switchLocale('en')
    stubApi({ ...geo, [DRAW_STATUS]: { body: page([drawStatus({ phase: 'ENTRIES_CLOSED' })]) } })
    renderPage(<Draw />)

    expect(await screen.findByRole('link', { name: 'Hassi Mameche' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Applications closed')).toBeInTheDocument()
    expect(within(table).getByText('12')).toBeInTheDocument()
  })

  it('shows an unpublished draw as pending rather than as a count', async () => {
    await switchLocale('en')
    stubApi({
      ...geo,
      [DRAW_STATUS]: {
        body: page([drawStatus({ phase: 'DRAWN', resultsPublished: false, winnerCount: null })]),
      },
    })
    renderPage(<Draw />)

    const table = await screen.findByRole('table')
    // Null rather than zero, and rendered as "not yet announced": a commune
    // that has drawn must not be distinguishable from one where nobody won.
    expect(within(table).getByText('Results not yet announced')).toBeInTheDocument()
    expect(within(table).queryByText('0')).not.toBeInTheDocument()
  })

  it('shows the winner count once the result is announced', async () => {
    await switchLocale('en')
    stubApi({
      ...geo,
      [DRAW_STATUS]: {
        body: page([drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 })]),
      },
    })
    renderPage(<Draw />)

    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('12').length).toBeGreaterThan(0)
  })

  it('exposes no pool, applicant count, weight or random value', async () => {
    await switchLocale('en')
    stubApi({
      ...geo,
      [DRAW_STATUS]: {
        body: page([
          {
            ...drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 }),
            // None of this is in the DTO. If any of it ever arrives, it must
            // still not be rendered.
            eligibleApplicationCount: 843,
            poolHash: 'b'.repeat(64),
            randomValue: 918273645,
            activeTotalWeight: 4211,
            entries: [{ applicationReference: 'HZ-2027-MES-8F42K1', weight: 6 }],
          },
        ]),
      },
    })
    renderPage(<Draw />)
    await screen.findByRole('table')

    expectNoPrivateData(document.body)
    for (const secret of ['843', '918273645', '4211', 'b'.repeat(64), 'HZ-2027-MES-8F42K1']) {
      expect(document.body.textContent).not.toContain(secret)
    }
  })

  it('filters by public codes', async () => {
    await switchLocale('en')
    stubApi({ ...geo, [DRAW_STATUS]: { body: page([drawStatus()]) } })
    renderPage(<Draw />)
    await screen.findByRole('link', { name: 'Hassi Mameche' })

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Wilaya'), '27')
    await user.selectOptions(await screen.findByLabelText('Commune'), '2703')

    const last = requestedPaths()
      .filter((path) => path.startsWith(DRAW_STATUS))
      .at(-1)
    expect(last).toContain('wilayaCode=27')
    expect(last).toContain('communeCode=2703')
    expect(last).not.toContain('wil-1')
    expect(Number(new URL(last ?? '', 'http://x').searchParams.get('pageSize'))).toBeLessThanOrEqual(
      PUBLIC_PAGE_SIZE_MAX,
    )
  })

  it('shows a loading state, then an error state with a retry', async () => {
    await switchLocale('en')
    stubNeverResolves()
    const view = renderPage(<Draw />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    view.unmount()

    stubApi({ ...geo, [DRAW_STATUS]: { status: 503, body: { error: 'down', code: 'UNAVAILABLE' } } })
    renderPage(<Draw />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The service is unavailable at the moment. Please try again shortly.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('live draw visualiser', () => {
  const renderWatch = () => renderAt(<DrawWatch />, watchPath, watchUrl)

  it('shows the waiting state before a draw is held', async () => {
    await switchLocale('en')
    stubApi({
      [DRAW_STATUS]: { body: page([drawStatus({ phase: 'ENTRIES_CLOSED', registrationOpen: false })]) },
    })
    renderWatch()

    expect(await screen.findByText('Not yet drawn')).toBeInTheDocument()
    expect(screen.getByText('The draw has not been held')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    // No outcome of any kind while the draw has not happened.
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the drawn-but-unannounced state without any winner information', async () => {
    await switchLocale('en')
    stubApi({ [DRAW_STATUS]: { body: page([drawStatus({ phase: 'DRAWN', resultsPublished: false })]) } })
    renderWatch()

    expect(await screen.findByText('Draw held')).toBeInTheDocument()
    expect(screen.getByText('The draw has been held')).toBeInTheDocument()
    expect(screen.getByText('Not yet announced')).toBeInTheDocument()
    // The result endpoint is not touched at all until publication: polling it
    // for a 404 would be load for an answer already in the cheaper response.
    expect(requestedPaths().some((path) => path.startsWith('/api/public/results'))).toBe(false)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows the official result once it has been announced', async () => {
    await switchLocale('en')
    forceReducedMotion(true)
    stubApi({
      [DRAW_STATUS]: {
        body: page([drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 })]),
      },
      [RESULT_PATH]: { body: fullResult() },
    })
    renderWatch()

    expect(await screen.findByText('Result announced')).toBeInTheDocument()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('HZ-2027-MES-8F42K1')).toBeInTheDocument()
    expect(within(table).getByText('HZ-2027-MES-3KD7VB')).toBeInTheDocument()
  })

  it('shows a safe message when there is no draw to display', async () => {
    await switchLocale('en')
    stubApi({ [DRAW_STATUS]: { body: page([], { total: 0 }) } })
    renderWatch()

    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Nothing to display')).toBeInTheDocument()
  })

  it('treats a cancelled commune as unavailable', async () => {
    await switchLocale('en')
    stubApi({ [DRAW_STATUS]: { body: page([drawStatus({ phase: 'CANCELLED' })]) } })
    renderWatch()

    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  })

  it('reveals the whole list at once under prefers-reduced-motion', async () => {
    await switchLocale('en')
    forceReducedMotion(true)
    stubApi({
      [DRAW_STATUS]: {
        body: page([drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 })]),
      },
      [RESULT_PATH]: { body: fullResult() },
    })
    renderWatch()

    const table = await screen.findByRole('table')
    // All three winners immediately, and no "showing n of m" progress line —
    // nothing about the result requires seeing it move.
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByText(/Showing \d+ of \d+/)).not.toBeInTheDocument()
  })

  it('paces the reveal when motion is welcome, without changing the order', async () => {
    await switchLocale('en')
    forceReducedMotion(false)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubApi({
      [DRAW_STATUS]: {
        body: page([drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 })]),
      },
      [RESULT_PATH]: { body: fullResult() },
    })
    renderWatch()

    const table = await screen.findByRole('table')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    const references = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent)

    // The server's persisted selection order, untouched. Pacing changes when a
    // row appears and nothing else.
    expect(references[0]).toContain('HZ-2027-MES-8F42K1')
    expect(references[1]).toContain('HZ-2027-MES-QQ19ZP')
    expect(references[2]).toContain('HZ-2027-MES-3KD7VB')
  })

  it('polls while a draw is unannounced and stops once it is published', async () => {
    await switchLocale('en')
    forceReducedMotion(true)
    vi.useFakeTimers({ shouldAdvanceTime: true })

    let published = false
    stubApi({
      [DRAW_STATUS]: () => ({
        body: page([
          drawStatus({ phase: 'DRAWN', resultsPublished: published, winnerCount: published ? 12 : null }),
        ]),
      }),
      [RESULT_PATH]: { body: fullResult() },
    })
    renderWatch()

    await screen.findByText('Draw held')
    const afterFirst = requestedPaths().filter((path) => path.startsWith(DRAW_STATUS)).length
    expect(afterFirst).toBe(1)

    // Waiting for the announcement is the one transition worth watching for.
    published = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000)
    })
    await screen.findByText('Result announced')

    const afterPublication = requestedPaths().filter((path) => path.startsWith(DRAW_STATUS)).length
    expect(afterPublication).toBeGreaterThan(afterFirst)

    // Published is terminal — immutable by database trigger, with no retraction
    // path anywhere — so there is nothing left to ask about and the page says so.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600_000)
    })
    expect(requestedPaths().filter((path) => path.startsWith(DRAW_STATUS))).toHaveLength(afterPublication)
    await waitFor(() =>
      expect(
        screen.getByText('This draw has reached its final state. This page has stopped updating.'),
      ).toBeInTheDocument(),
    )
  })

  it('polls slowly while intake is still open', async () => {
    await switchLocale('en')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    stubApi({ [DRAW_STATUS]: { body: page([drawStatus({ phase: 'ACCEPTING' })]) } })
    renderWatch()

    await screen.findByText('Not yet drawn')
    // Nothing changes minute to minute two months before a draw. A page left
    // open on a commune in intake must not cost a request a second.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(requestedPaths().filter((path) => path.startsWith(DRAW_STATUS))).toHaveLength(1)
  })

  it('asks for a single row, never a page of them', async () => {
    await switchLocale('en')
    stubApi({ [DRAW_STATUS]: { body: page([drawStatus()]) } })
    renderWatch()
    await screen.findByText('Not yet drawn')

    const url = new URL(requestedPaths()[0] ?? '', 'http://x')
    expect(url.searchParams.get('pageSize')).toBe('1')
    expect(url.searchParams.get('wilayaCode')).toBe('27')
    expect(url.searchParams.get('communeCode')).toBe('2703')
  })

  it('only ever issues reads, and only to the public API', async () => {
    await switchLocale('en')
    forceReducedMotion(true)
    stubApi({
      [DRAW_STATUS]: {
        body: page([drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 })]),
      },
      [RESULT_PATH]: { body: fullResult() },
    })
    renderWatch()
    await screen.findByRole('table')

    // No number of people opening this page amounts to anything but GETs on two
    // cached public endpoints. Executing a draw is a SUPER_ADMIN POST behind a
    // session on an entirely different router, and nothing here can reach it.
    for (const request of requestLog) {
      expect(request.method).toBe('GET')
      expect(request.body).toBeUndefined()
      expect(new URL(request.url, 'http://x').pathname.startsWith('/api/public/')).toBe(true)
    }
    expect(requestedPaths().some((path) => /execute|publish|freeze|admin/.test(path))).toBe(false)
  })

  it('announces its state to a screen reader in every language', async () => {
    for (const [locale, expected] of [
      ['en', 'Result announced'],
      ['fr', 'Résultat annoncé'],
      ['ar', 'أُعلنت النتيجة'],
    ] as const) {
      await switchLocale(locale)
      forceReducedMotion(true)
      stubApi({
        [DRAW_STATUS]: {
          body: page([drawStatus({ phase: 'DRAWN', resultsPublished: true, winnerCount: 12 })]),
        },
        [RESULT_PATH]: { body: fullResult() },
      })
      const view = renderWatch()

      const status = await screen.findByText(expected)
      expect(status.closest('[role="status"]')).toHaveAttribute('aria-live', 'polite')
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr')
      view.unmount()
    }
  })
})

describe('the client performs no lottery logic', () => {
  const clientSrc = join(process.cwd(), 'src')

  function typescriptFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return typescriptFiles(path)
      return /\.tsx?$/.test(name) ? [path] : []
    })
  }

  /**
   * Comments are stripped before scanning: several modules explain at length
   * why the browser takes no part in the draw, and a guard that punished them
   * for naming the thing they refuse to do would push the reasoning out of the
   * code.
   */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
  }

  it('never calls Math.random anywhere in the client', () => {
    const offenders = typescriptFiles(clientSrc).filter((file) =>
      /Math\s*\.\s*random/.test(withoutComments(readFileSync(file, 'utf8'))),
    )

    // A static guard rather than reviewer discipline. The draw is decided once,
    // on the server, from the operating system's CSPRNG; a browser generating
    // any value that looked like part of it — a candidate, an order, a
    // "simulated" pick — would misrepresent an official lottery.
    expect(offenders).toEqual([])
  })

  it('keeps the visualiser free of anything that could select a winner', () => {
    const sources = ['components/public/DrawStage.tsx', 'lib/draw-watch.ts']
      .map((file) => withoutComments(readFileSync(join(clientSrc, file), 'utf8')))
      .join('\n')

    for (const forbidden of ['Math.random', 'crypto.getRandomValues', '.sort(', 'shuffle', 'weight']) {
      expect(sources).not.toContain(forbidden)
    }
  })
})
