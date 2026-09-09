import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminCommuneDraw } from '../src/pages/admin/AdminCommuneDraw'
import { AdminDraws } from '../src/pages/admin/AdminDraws'

import { communeDraw, drawResult, drawYear, poolSummary, poolValidation, renderAdmin } from './admin-harness'
import { requestLog, requestedPaths, stubApi, switchLocale } from './harness'

/**
 * Configuring a draw, checking its pool, freezing it, and running it.
 *
 * The through-line: every irreversible act states its consequence before it
 * happens, and nothing about the outcome is decided here. The execute request
 * in particular carries no body at all — not a winner count, not a seed — and
 * one of these tests asserts exactly that.
 */

const DRAW_ROUTE = { pattern: '/admin/communes/:id', path: '/admin/communes/cd-1' }

/** A commune draw page with the pool and result endpoints answered. */
function drawPage(options: {
  draw?: ReturnType<typeof communeDraw>
  pool?: unknown
  poolStatus?: number
  result?: unknown
  resultStatus?: number
}) {
  return {
    '/api/admin/commune-draws/cd-1': { body: options.draw ?? communeDraw() },
    '/api/admin/commune-draws/cd-1/pool/summary': {
      status: options.poolStatus ?? (options.pool ? 200 : 404),
      body: options.pool ?? { error: 'x', code: 'POOL_NOT_FOUND' },
    },
    '/api/admin/commune-draws/cd-1/result': {
      status: options.resultStatus ?? (options.result ? 200 : 404),
      body: options.result ?? { error: 'x', code: 'DRAW_RESULT_NOT_FOUND' },
    },
  }
}

describe('draw years', () => {
  it('offers only the transitions the shared lifecycle table permits', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/draw-years': {
        body: [
          drawYear({ id: 'dy-open', year: 2027, status: 'REGISTRATION_OPEN' }),
          drawYear({ id: 'dy-archived', year: 2020, status: 'ARCHIVED' }),
        ],
      },
    })

    renderAdmin(<AdminDraws />)
    const table = await screen.findByRole('table', { name: 'Draw years' })
    const rows = within(table).getAllByRole('row').slice(1)

    // REGISTRATION_OPEN → REGISTRATION_CLOSED only. No reopen, ever.
    const open = within(rows[0]!)
    expect(open.getByRole('button', { name: 'Close registration' })).toBeInTheDocument()
    expect(open.queryByRole('button', { name: 'Open registration' })).not.toBeInTheDocument()
    expect(open.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()

    // ARCHIVED is terminal and offers nothing.
    expect(within(rows[1]!).queryAllByRole('button')).toHaveLength(0)
    expect(within(rows[1]!).getByText('No further changes')).toBeInTheDocument()
  })

  it('states the consequence before closing registration', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/draw-years': { body: [drawYear({ status: 'REGISTRATION_OPEN' })] },
    })

    renderAdmin(<AdminDraws />)
    await screen.findByRole('table', { name: 'Draw years' })
    await userEvent.click(screen.getByRole('button', { name: 'Close registration' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/no way to reopen it/i)).toBeInTheDocument()
  })

  it('gives a scoped administrator no transition controls at all', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/draw-years': { body: [drawYear()] } })

    renderAdmin(<AdminDraws />, { role: 'WILAYA_ADMIN' })

    expect(await screen.findByText('Read-only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close registration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a draw year' })).not.toBeInTheDocument()
  })
})

describe('the draw workflow', () => {
  it('shows the lifecycle without inventing a step the server has no state for', async () => {
    await switchLocale('en')
    stubApi(drawPage({ draw: communeDraw({ status: 'READY' }) }))

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)

    const steps = await screen.findByRole('list', { name: 'Draw progress' })
    const labels = within(steps)
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')

    // Exactly the five states a commune draw can actually be in, in order.
    // No "validating" and no "drawing": validation writes nothing and leaves
    // the draw where it was, and execution is one transaction with no
    // observable middle — a step for either would show a position the system
    // cannot hold.
    expect(labels).toHaveLength(5)
    expect(labels[0]).toContain('Configured')
    expect(labels[1]).toContain('Settled')
    expect(labels[2]).toContain('Pool frozen')
    expect(labels[3]).toContain('Lottery run')
    expect(labels[4]).toContain('Result published')
    expect(labels.join(' ')).not.toMatch(/validating|drawing|executing/i)

    // Not yet frozen: that step reads "Not yet", not "Done".
    expect(labels[2]).toContain('Not yet')
  })

  it('never marks publication done before the server reports one', async () => {
    await switchLocale('en')
    stubApi(
      drawPage({
        draw: communeDraw({ status: 'COMPLETED' }),
        pool: poolSummary(),
        result: drawResult({ publishedAt: null }),
      }),
    )

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)

    const steps = await screen.findByRole('list', { name: 'Draw progress' })
    const published = within(steps).getAllByRole('listitem').at(-1)?.textContent ?? ''
    expect(published).toContain('Result published')
    expect(published).toContain('In progress')
    expect(published).not.toContain('Done')
  })

  it('reports every pool blocker rather than the first', async () => {
    await switchLocale('en')
    stubApi({
      ...drawPage({ draw: communeDraw({ status: 'READY' }) }),
      '/api/admin/commune-draws/cd-1/validate-pool': {
        body: poolValidation({
          ready: false,
          blockers: [
            { code: 'STALE_WEIGHT', applicationReference: 'HZ-2027-MES-8F42K1' },
            { code: 'MISSING_WEIGHT', applicationReference: 'HZ-2027-MES-QQ19ZP' },
            { code: 'APPLICATION_NOT_ELIGIBLE', applicationReference: 'HZ-2027-MES-3KD7VB' },
          ],
        }),
      },
    })

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('button', { name: 'Run the check' }))

    expect(await screen.findByText('The pool cannot be frozen')).toBeInTheDocument()
    expect(screen.getByText('3 problems')).toBeInTheDocument()
    expect(screen.getByText('The frozen weight no longer matches')).toBeInTheDocument()
    expect(screen.getByText('No frozen weight')).toBeInTheDocument()
    expect(screen.getByText('Now ineligible')).toBeInTheDocument()
  })

  it('distinguishes a passed check from a blocked one in words', async () => {
    await switchLocale('en')
    stubApi({
      ...drawPage({ draw: communeDraw({ status: 'READY' }) }),
      '/api/admin/commune-draws/cd-1/validate-pool': { body: poolValidation({ ready: true }) },
    })

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('button', { name: 'Run the check' }))

    expect(await screen.findByText('The pool is ready to freeze')).toBeInTheDocument()
    expect(screen.queryByText('The pool cannot be frozen')).not.toBeInTheDocument()
  })

  it('states N winners, N reserves and 2N selections before freezing', async () => {
    await switchLocale('en')
    stubApi({
      ...drawPage({ draw: communeDraw({ status: 'READY', allocatedSpots: 12 }) }),
      '/api/admin/commune-draws/cd-1/validate-pool': { body: poolValidation() },
    })

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('button', { name: 'Freeze the pool' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/12 winners and 12 reserves — 24 selections/)).toBeInTheDocument()
    expect(within(dialog).getByText(/One selected application occupies one position/)).toBeInTheDocument()

    // The operator is asked for none of these numbers; the server decides them.
    expect(within(dialog).queryAllByRole('spinbutton')).toHaveLength(0)
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0)
  })

  it('shows the frozen pool with its hash, and offers no unlock', async () => {
    await switchLocale('en')
    stubApi(drawPage({ draw: communeDraw({ status: 'LOCKED' }), pool: poolSummary() }))

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)

    expect(await screen.findByText('The pool is frozen')).toBeInTheDocument()
    expect(screen.getByText('b'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText(/not a seed/i)).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /unlock|unfreeze/i })).not.toBeInTheDocument()
  })

  it('states the whole input and sends no body when running the lottery', async () => {
    await switchLocale('en')
    stubApi({
      ...drawPage({ draw: communeDraw({ status: 'LOCKED', allocatedSpots: 3 }), pool: poolSummary() }),
      '/api/admin/commune-draws/cd-1/execute': { status: 201, body: drawResult() },
    })

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('tab', { name: 'Run the lottery' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run the lottery' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('weighted-csprng-v1')).toBeInTheDocument()
    expect(within(dialog).getByText('b'.repeat(64))).toBeInTheDocument()
    expect(
      within(dialog).getByText(/3 winners and 3 reserves will be drawn — 6 selections in all/),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/excluded from future draws for life/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Run the lottery' }))

    const execute = requestLog.find((entry) => entry.url.includes('/execute'))
    expect(execute?.method).toBe('POST')
    // No winner count, no seed, no algorithm version — nothing from the browser
    // can influence who is drawn.
    expect(execute?.body).toBeUndefined()
  })

  it('refuses to offer the lottery before the pool is frozen', async () => {
    await switchLocale('en')
    stubApi(drawPage({ draw: communeDraw({ status: 'READY' }) }))

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('tab', { name: 'Run the lottery' }))

    expect(await screen.findByText('Not ready to run')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run the lottery' })).not.toBeInTheDocument()
  })

  it('gives a scoped administrator the whole page and none of the actions', async () => {
    await switchLocale('en')
    stubApi(
      drawPage({
        draw: communeDraw({ status: 'LOCKED' }),
        pool: poolSummary(),
      }),
    )

    renderAdmin(<AdminCommuneDraw />, { ...DRAW_ROUTE, role: 'COMMUNE_ADMIN' })

    // They can follow their own draw…
    expect(await screen.findByText('The pool is frozen')).toBeInTheDocument()
    // …but nobody runs a lottery they are themselves subject to.
    await userEvent.click(screen.getByRole('tab', { name: 'Run the lottery' }))
    expect(await screen.findByText('Only a national administrator may run a lottery.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Freeze the pool' })).not.toBeInTheDocument()
  })

  it('treats a missing pool or result as "not yet", not as a failure', async () => {
    await switchLocale('en')
    stubApi(drawPage({ draw: communeDraw({ status: 'DRAFT' }) }))

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await screen.findByRole('list', { name: 'Draw progress' })

    // Both 404s were swallowed; nothing is reported as broken.
    expect(requestedPaths()).toContain('/api/admin/commune-draws/cd-1/pool/summary')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('publication', () => {
  it('offers publication only once a result exists, and states that it is final', async () => {
    await switchLocale('en')
    stubApi(
      drawPage({
        draw: communeDraw({ status: 'COMPLETED' }),
        pool: poolSummary(),
        result: drawResult({ publishedAt: null }),
      }),
    )

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('tab', { name: 'Result' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Publish the result' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/cannot be withdrawn/i)).toBeInTheDocument()
  })

  it('offers no way to withdraw a publication', async () => {
    await switchLocale('en')
    stubApi(
      drawPage({
        draw: communeDraw({ status: 'COMPLETED' }),
        pool: poolSummary(),
        result: drawResult({ publishedAt: '2027-05-02T10:00:00.000Z' }),
      }),
    )

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await userEvent.click(await screen.findByRole('tab', { name: 'Result' }))

    expect(await screen.findByText('This result is public')).toBeInTheDocument()

    // "Record a withdrawal" in the winners table is a different act: it says a
    // person gave up their place, not that the announcement is taken back.
    const actions = screen.getAllByRole('button').map((button) => button.textContent ?? '')
    expect(actions).not.toContain('Publish the result')
    for (const label of actions) expect(label).not.toMatch(/unpublish|retract/i)
  })
})
