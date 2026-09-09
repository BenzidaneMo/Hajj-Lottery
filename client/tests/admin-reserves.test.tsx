import type { DrawResultDto } from '@hajj-lottery/shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminCommuneDraw } from '../src/pages/admin/AdminCommuneDraw'

import { communeDraw, drawResult, poolSummary, renderAdmin } from './admin-harness'
import { requestLog, stubApi, switchLocale } from './harness'

/**
 * Winners, withdrawals, and the reserve lifecycle.
 *
 * Three properties matter more than anything else on this screen, and each has
 * a test that would fail loudly if it were lost:
 *
 *   - the two lists never merge, and a promoted reserve keeps its reserve
 *     number rather than becoming a winner number;
 *   - the reserve order is the server's and is never rearranged;
 *   - there is no way to pick *which* reserve is called.
 */

const DRAW_ROUTE = { pattern: '/admin/communes/:id', path: '/admin/communes/cd-1' }

function stubResult(result: DrawResultDto, extra: Record<string, unknown> = {}) {
  stubApi({
    '/api/admin/commune-draws/cd-1': { body: communeDraw({ status: 'COMPLETED', allocatedSpots: 3 }) },
    '/api/admin/commune-draws/cd-1/pool/summary': { body: poolSummary() },
    '/api/admin/commune-draws/cd-1/result': { body: result },
    ...extra,
  })
}

async function openResult() {
  await userEvent.click(await screen.findByRole('tab', { name: 'Result' }))
}

async function reserveTab() {
  await openResult()
  await userEvent.click(await screen.findByRole('tab', { name: 'Reserve list' }))
  return screen.findByRole('table', { name: 'Reserve list' })
}

/** The first cell of every body row — the position column in both tables. */
function firstColumn(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent?.trim() ?? '')
}

describe('the original winners', () => {
  it('lists them in the order drawn, with their current outcome', async () => {
    await switchLocale('en')
    stubResult(drawResult())

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()

    const table = await screen.findByRole('table', { name: 'Original winners' })
    expect(firstColumn(table)).toEqual(['1', '2', '3'])
    expect(within(table).getAllByText('Holds the place')).toHaveLength(3)
  })

  it('keeps a withdrawn winner in place, at the same position', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[1]!.outcome = 'ABANDONED'
    result.winners[1]!.abandonment = {
      reason: 'MEDICAL',
      explanation: 'Hospitalised in March; cannot travel.',
      recordedBy: { id: 'user-SUPER_ADMIN', username: 'super_admin' },
      recordedAt: '2027-05-10T09:00:00.000Z',
    }
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()

    const table = await screen.findByRole('table', { name: 'Original winners' })
    // Still winner #2, still in the winners table, still the same reference.
    expect(firstColumn(table)).toEqual(['1', '2', '3'])
    const row = within(table).getAllByRole('row')[2]!
    expect(within(row).getByText('HZ-2027-MES-QQ19ZP')).toBeInTheDocument()
    expect(within(row).getByText('Gave up the place')).toBeInTheDocument()

    // Never described as a loser, and never moved into the reserve list.
    expect(within(table).queryByText('Not selected')).not.toBeInTheDocument()
  })

  it('never shows the private reason or explanation for a withdrawal', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[1]!.outcome = 'ABANDONED'
    result.winners[1]!.abandonment = {
      reason: 'MEDICAL',
      explanation: 'Hospitalised in March; cannot travel.',
      recordedBy: { id: 'user-SUPER_ADMIN', username: 'super_admin' },
      recordedAt: '2027-05-10T09:00:00.000Z',
    }
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()
    await screen.findByRole('table', { name: 'Original winners' })

    // The explanation may name a death or an illness. It is recorded, not
    // displayed on the operational list.
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Hospitalised in March')
    expect(text).not.toContain('Medical grounds')
  })
})

describe('recording a withdrawal', () => {
  it('requires both a category and an explanation', async () => {
    await switchLocale('en')
    stubResult(drawResult())

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()

    const table = await screen.findByRole('table', { name: 'Original winners' })
    const row = within(table).getAllByRole('row')[1]!
    await userEvent.click(within(row).getByRole('button', { name: 'Record a withdrawal' }))

    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: 'Record a withdrawal' })

    // No category chosen: submitting does nothing and the requirement is stated.
    await userEvent.click(submit)
    expect(within(dialog).getByText('Choose a category.')).toBeInTheDocument()
    expect(requestLog.some((entry) => entry.url.includes('/abandon'))).toBe(false)

    await userEvent.click(within(dialog).getByLabelText('Medical grounds'))
    await userEvent.click(submit)

    // Category chosen but the explanation is blank: still refused.
    expect(within(dialog).getByText('An explanation is required.')).toBeInTheDocument()
    expect(requestLog.some((entry) => entry.url.includes('/abandon'))).toBe(false)
  })

  it('says plainly what a withdrawal does not undo', async () => {
    await switchLocale('en')
    stubResult(drawResult())

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()

    const table = await screen.findByRole('table', { name: 'Original winners' })
    const row = within(table).getAllByRole('row')[1]!
    await userEvent.click(within(row).getByRole('button', { name: 'Record a withdrawal' }))

    const dialog = await screen.findByRole('dialog')
    const text = dialog.textContent ?? ''
    expect(text).toMatch(/remain an original winner/i)
    expect(text).toMatch(/position in the order is unchanged/i)
    expect(text).toMatch(/lifetime Hajj win still stands/i)
  })

  it('does not call a reserve as a side effect', async () => {
    await switchLocale('en')
    const after = drawResult()
    after.winners[0]!.outcome = 'ABANDONED'
    stubResult(drawResult(), {
      '/api/admin/commune-draws/cd-1/winners/1/abandon': { status: 201, body: after },
    })

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()

    const table = await screen.findByRole('table', { name: 'Original winners' })
    const row = within(table).getAllByRole('row')[1]!
    await userEvent.click(within(row).getByRole('button', { name: 'Record a withdrawal' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Death'))
    await userEvent.type(within(dialog).getByLabelText('Explanation'), 'Died in April.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a withdrawal' }))

    // One person records what happened; offering the place is a second,
    // separate decision, so the trail can say who decided what.
    expect(requestLog.filter((entry) => entry.url.includes('/abandon'))).toHaveLength(1)
    expect(requestLog.some((entry) => entry.url.includes('/call'))).toBe(false)
  })
})

describe('the reserve list', () => {
  it('renders the reserves in the order the server sent them', async () => {
    await switchLocale('en')
    const result = drawResult()
    // Deliberately hostile: a list whose weights would sort the other way. A
    // page that ordered by anything of its own would show 3, 1, 2.
    result.reserves[0]!.selectedWeight = 2
    result.reserves[1]!.selectedWeight = 4
    result.reserves[2]!.selectedWeight = 9
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    const table = await reserveTab()

    expect(firstColumn(table)).toEqual(['1', '2', '3'])
  })

  it('preserves an order that arrives reversed', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.reserves = [...result.reserves].reverse()
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    const table = await reserveTab()

    // Exactly as received. Nothing here sorts, and a "helpful" re-sort would
    // misrepresent what the lottery produced.
    expect(firstColumn(table)).toEqual(['3', '2', '1'])
  })

  it('keeps a promoted reserve in the reserve list, with its reserve number', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    result.activeWinnerCount = 2
    result.reserves[0]!.status = 'ACCEPTED'
    result.reserves[0]!.replacesSelectionOrder = 1
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    const reserves = await reserveTab()

    const row = within(reserves).getAllByRole('row')[1]!
    expect(within(row).getAllByRole('cell')[0]?.textContent).toBe('1')
    expect(within(row).getByText('Accepted')).toBeInTheDocument()

    // Never relabelled "Winner #4", and never moved into the winners table.
    await userEvent.click(screen.getByRole('tab', { name: 'Original winners' }))
    const winners = await screen.findByRole('table', { name: 'Original winners' })
    expect(firstColumn(winners)).toEqual(['1', '2', '3'])
    expect(within(winners).queryByText('HZ-2027-MES-R51TTA')).not.toBeInTheDocument()
  })

  it('shows every reserve status as a word, not only a colour', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.reserves[0]!.status = 'DECLINED'
    result.reserves[1]!.status = 'CALLED'
    result.reserves[2]!.status = 'WAITING'
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    const table = await reserveTab()

    expect(within(table).getByText('Declined')).toBeInTheDocument()
    expect(within(table).getByText('Called')).toBeInTheDocument()
    expect(within(table).getByText('Waiting')).toBeInTheDocument()
  })
})

describe('calling a reserve', () => {
  it('offers no per-row call button', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    const table = await reserveTab()

    // A button on row 7 would suggest an official could choose row 7, and
    // choosing within the order is choosing a winner.
    expect(within(table).queryAllByRole('button')).toHaveLength(0)
  })

  it('calls the next waiting reserve the server named, not a chosen one', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    // Reserve 1 already declined, so the next in the order is reserve 2.
    result.reserves[0]!.status = 'DECLINED'
    result.reserves[0]!.replacesSelectionOrder = 1

    const after = structuredClone(result)
    after.reserves[1]!.status = 'CALLED'

    stubResult(result, {
      '/api/admin/commune-draws/cd-1/reserves/2/call': { body: after },
    })

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await reserveTab()

    expect(await screen.findByText(/Place 1 is vacant.*reserve 2/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Call the next reserve' }))

    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Call the next reserve' }))

    const call = requestLog.find((entry) => entry.url.includes('/call'))
    // Position 2, because that is the next waiting one — not because a row was
    // clicked. The server refuses anything else regardless.
    expect(call?.url).toContain('/reserves/2/call')
    expect(call?.body).toBe(JSON.stringify({ winnerSelectionOrder: 1 }))
  })

  it('offers nothing to do when no place is vacant', async () => {
    await switchLocale('en')
    stubResult(drawResult())

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await reserveTab()

    expect(await screen.findByText('No place is waiting on a reserve.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Call the next reserve' })).not.toBeInTheDocument()
  })
})

describe('answering a call', () => {
  it('states that a single applicant is excluded for life before acceptance', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    result.reserves[0]!.status = 'CALLED'
    result.reserves[0]!.replacesSelectionOrder = 1
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await reserveTab()

    await userEvent.click(await screen.findByRole('button', { name: 'Record acceptance' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(within(dialog).getByText(/excluded from every future draw for life/)).toBeInTheDocument()
    expect(within(dialog).getByText(/reserve number does not change/)).toBeInTheDocument()
  })

  it('makes a paired promotion all-or-nothing, in words', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    // Reserve 2 is the PAIRED entry.
    result.reserves[0]!.status = 'DECLINED'
    result.reserves[1]!.status = 'CALLED'
    result.reserves[1]!.replacesSelectionOrder = 1
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await reserveTab()

    await userEvent.click(await screen.findByRole('button', { name: 'Record acceptance' }))
    const dialog = await screen.findByRole('alertdialog')

    expect(within(dialog).getByText(/both pilgrims become Hajj winners together/)).toBeInTheDocument()
    expect(within(dialog).getByText(/cannot be promoted in part/)).toBeInTheDocument()
  })

  it('requires an explanation to record a refusal', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    result.reserves[0]!.status = 'CALLED'
    result.reserves[0]!.replacesSelectionOrder = 1
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await reserveTab()

    await userEvent.click(await screen.findByRole('button', { name: 'Record refusal' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record refusal' }))

    expect(within(dialog).getByText('An explanation is required.')).toBeInTheDocument()
    expect(requestLog.some((entry) => entry.url.includes('/decline'))).toBe(false)

    expect(within(dialog).getByText(/reopens for the next reserve/)).toBeInTheDocument()
    expect(within(dialog).getByText(/not asked again/)).toBeInTheDocument()
  })

  it('gives a scoped administrator no reserve actions at all', async () => {
    await switchLocale('en')
    const result = drawResult()
    result.winners[0]!.outcome = 'ABANDONED'
    result.reserves[0]!.status = 'CALLED'
    stubResult(result)

    renderAdmin(<AdminCommuneDraw />, { ...DRAW_ROUTE, role: 'COMMUNE_ADMIN' })
    const table = await reserveTab()

    // They see their commune's reserve list — that is the whole of their
    // authority here.
    expect(firstColumn(table)).toEqual(['1', '2', '3'])
    expect(screen.queryByRole('button', { name: 'Record acceptance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record refusal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record a withdrawal' })).not.toBeInTheDocument()
  })
})

describe('the selection record', () => {
  it('shows the randomness the server consumed, and generates none', async () => {
    await switchLocale('en')
    stubResult(drawResult())

    renderAdmin(<AdminCommuneDraw />, DRAW_ROUTE)
    await openResult()
    await userEvent.click(await screen.findByRole('tab', { name: 'Selection record' }))

    const table = await screen.findByRole('table', { name: 'Selection record' })
    expect(within(table).getByText('1,904')).toBeInTheDocument()
    expect(within(table).getByText('41')).toBeInTheDocument()

    // Named in the summary and again beside the record: a concluded draw
    // always identifies the implementation it ran under.
    expect(screen.getAllByText('weighted-csprng-v1').length).toBeGreaterThan(0)
    expect(screen.getByText(/A concluded draw always names its own/)).toBeInTheDocument()
  })
})
