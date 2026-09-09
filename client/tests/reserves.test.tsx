import type { PublicReserveDto, PublicWinnerDto } from '@hajj-lottery/shared'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PublicResult } from '../src/pages/PublicResult'
import { expectNoPrivateData, FORBIDDEN_VALUES, fullResult, renderAt, stubApi, switchLocale } from './harness'

const RESULT_PATH = '/api/public/results/2027/27/2703'

/**
 * Reserves and withdrawn winners, on the public result page.
 *
 * Two claims run through the whole file, and every test is one of them said
 * precisely.
 *
 * **The original draw is a record and is never rewritten.** A winner who gave up
 * their place stays in the winner list, at the same position, with the same
 * reference — the page says the place was given up and nothing else. A promoted
 * reserve stays in the reserve list, keeping its reserve number, and is never
 * relabelled into a winner position. Nothing moves between the two tables.
 *
 * **The order is the server's.** The reserve list is the second half of one
 * continuous draw, and the page renders it in the order the API sent it. There
 * is no sort here by weight, by status, by reference or by anything else; a
 * front end that re-ordered this list would be showing a different lottery than
 * the one that ran.
 */

const renderResult = () =>
  renderAt(<PublicResult />, '/results/:drawYear/:wilayaCode/:communeCode', '/results/2027/27/2703')

/** A result whose reserve list carries one of each public status. */
function reserved(overrides: Partial<PublicReserveDto>[] = []) {
  const base: PublicReserveDto[] = [
    {
      reservePosition: 1,
      selectionOrder: 4,
      applicationReference: 'HZ-2027-MES-R51TTA',
      entryType: 'SINGLE',
      participantCount: 1,
      outcome: 'PROMOTED',
    },
    {
      reservePosition: 2,
      selectionOrder: 5,
      applicationReference: 'HZ-2027-MES-B90WQ4',
      entryType: 'PAIRED',
      participantCount: 2,
      outcome: 'DECLINED',
    },
    {
      reservePosition: 3,
      selectionOrder: 6,
      applicationReference: 'HZ-2027-MES-KK4M2C',
      entryType: 'SINGLE',
      participantCount: 1,
      outcome: 'CALLED',
    },
    {
      reservePosition: 4,
      selectionOrder: 7,
      applicationReference: 'HZ-2027-MES-77PZ1D',
      entryType: 'SINGLE',
      participantCount: 1,
      outcome: 'WAITING',
    },
  ]

  return base.map((reserve, index) => ({ ...reserve, ...overrides[index] }))
}

/** The winner list with the entry at `index` recorded as having withdrawn. */
function withdrawnAt(index: number): PublicWinnerDto[] {
  return fullResult().winners.map((winner, position) =>
    position === index ? { ...winner, outcome: 'WITHDRAWN' as const } : winner,
  )
}

const winnerTable = () => screen.findByRole('table', { name: 'Original winners' })
const reserveTable = () => screen.findByRole('table', { name: 'Reserve list' })

/** A table's body rows, as arrays of cell text. */
function bodyRows(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => (cell.textContent ?? '').trim()),
    )
}

describe('original winners on a published result', () => {
  it('shows an active winner as holding the place', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult() } })
    renderResult()

    const rows = bodyRows(await winnerTable())
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.at(-1)).toBe('Holds the place')
    expect(screen.queryByText('Gave up the place')).not.toBeInTheDocument()
  })

  it('shows a withdrawn winner as having given up the place', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ winners: withdrawnAt(1) }) } })
    renderResult()

    const rows = bodyRows(await winnerTable())
    expect(rows[1]?.at(-1)).toBe('Gave up the place')
    // The status is a word, not only a colour: a reader who cannot tell emerald
    // from stone, or who is listening to the page, gets the same answer.
    expect(await screen.findByText('Gave up the place')).toBeInTheDocument()
  })

  it('leaves a withdrawn winner exactly where the draw put them', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ winners: withdrawnAt(1) }) } })
    renderResult()

    const rows = bodyRows(await winnerTable())

    // Still a winner of this draw: still in the winner list, still second, still
    // the same reference. Not moved, not removed, not renumbered, and — the
    // thing that would be worst — not shown as not-selected or as a reserve.
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row[0])).toEqual(['1', '2', '3'])
    expect(rows[1]?.[1]).toBe('HZ-2027-MES-QQ19ZP')
    expect(within(await winnerTable()).queryByText('Not selected')).not.toBeInTheDocument()
    expect(within(await winnerTable()).queryByText(/Reserve|Waiting|Promoted/)).not.toBeInTheDocument()

    // And the page explains what the status means rather than leaving a reader
    // to guess that a withdrawn winner was never a winner.
    expect(
      screen.getByText(/still an original winner of this draw.*position in the order drawn is unchanged/i),
    ).toBeInTheDocument()
  })

  it('says nothing about why a place was given up', async () => {
    await switchLocale('en')
    stubApi({
      [RESULT_PATH]: {
        body: {
          ...fullResult({ winners: withdrawnAt(0) }),
          // None of this is in the public DTO. The server does not select the
          // columns it would come from — this asserts the page would not render
          // it even if something upstream started sending it.
          winners: withdrawnAt(0).map((winner, index) =>
            index === 0
              ? {
                  ...winner,
                  abandonment: {
                    reason: 'MEDICAL',
                    explanation: 'Unfit to travel; certificate filed at the health directorate.',
                    recordedBy: { id: 'ckuser0000001', username: 'admin.mostaganem' },
                    recordedAt: '2027-06-01T09:00:00.000Z',
                  },
                }
              : winner,
          ),
        },
      },
    })
    renderResult()

    await winnerTable()
    const text = document.body.textContent ?? ''
    for (const secret of [
      'MEDICAL',
      'Unfit to travel',
      'certificate',
      'health directorate',
      'admin.mostaganem',
      'ckuser0000001',
    ]) {
      expect(text).not.toContain(secret)
    }
    expect(document.body.innerHTML.toLowerCase()).not.toContain('explanation')
    expect(document.body.innerHTML.toLowerCase()).not.toContain('recordedby')
  })
})

describe('the reserve list on a published result', () => {
  it('renders as its own section, separate from the winners', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult() } })
    renderResult()

    expect(await screen.findByRole('heading', { name: 'Original winners' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reserve list' })).toBeInTheDocument()
    expect(await reserveTable()).toBeInTheDocument()

    // Two lists, and the page says in words why they are two: a reserve is not
    // a winner, and presenting them together would imply otherwise.
    expect(screen.getByText(/A reserve is not a winner/i)).toBeInTheDocument()
  })

  it('renders reserve positions in the order the API sent them', async () => {
    await switchLocale('en')
    // Deliberately hostile ordering: positions descending, statuses mixed, and
    // the alphabetically-first reference last. Any sort at all changes this.
    const shuffled = [...reserved()].reverse()
    stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: shuffled }) } })
    renderResult()

    const rows = bodyRows(await reserveTable())

    expect(rows.map((row) => row[0])).toEqual(['4', '3', '2', '1'])
    expect(rows.map((row) => row[1])).toEqual(shuffled.map((reserve) => reserve.applicationReference))
    expect(rows.map((row) => row.at(-1))).toEqual(['Waiting', 'Called', 'Declined', 'Promoted to winner'])
  })

  it('renders every reserve status with readable text', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: reserved() }) } })
    renderResult()

    const table = await reserveTable()
    for (const label of ['Promoted to winner', 'Declined', 'Called', 'Waiting']) {
      expect(within(table).getByText(label)).toBeInTheDocument()
    }
  })

  it('does not relabel a promoted reserve as an original winner', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: reserved() }) } })
    renderResult()

    const winners = bodyRows(await winnerTable())
    const reserves = bodyRows(await reserveTable())

    // The promoted reserve is reserve #1, and stays reserve #1. It has not been
    // appended to the winner list, and the winner list has not grown a fourth
    // row to accommodate it — the original draw selected three winners and
    // still says so.
    expect(winners).toHaveLength(3)
    expect(winners.map((row) => row[1])).not.toContain('HZ-2027-MES-R51TTA')
    expect(reserves[0]?.[0]).toBe('1')
    expect(reserves[0]?.[1]).toBe('HZ-2027-MES-R51TTA')
    expect(reserves[0]?.at(-1)).toBe('Promoted to winner')

    // Both facts remain readable: the draw made them reserve #1, and the
    // lifecycle afterwards made them a winner.
    expect(screen.getByText(/A promoted reserve keeps its reserve number/i)).toBeInTheDocument()
  })

  it('publishes exactly five reserve columns, and no name among them', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: reserved() }) } })
    renderResult()

    const headers = within(await reserveTable())
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)

    expect(headers).toEqual(['Reserve', 'Application reference', 'Type', 'Pilgrims', 'Status'])
  })

  it('renders nothing identifying, whatever the API sends with a reserve', async () => {
    await switchLocale('en')
    stubApi({
      [RESULT_PATH]: {
        body: fullResult({
          reserves: reserved().map((reserve, index) =>
            index === 0
              ? ({
                  ...reserve,
                  fullName: FORBIDDEN_VALUES.fullName,
                  nationalId: FORBIDDEN_VALUES.nationalId,
                  phoneNumber: FORBIDDEN_VALUES.phoneNumber,
                  dob: FORBIDDEN_VALUES.dob,
                  participantId: FORBIDDEN_VALUES.participantId,
                  selectedWeight: 17,
                  replacesSelectionOrder: 2,
                } as PublicReserveDto)
              : reserve,
          ),
        }),
      },
    })
    renderResult()

    await reserveTable()
    expectNoPrivateData(document.body)
    // Which winner a reserve replaced is not part of the public contract, and
    // rendering it would publish a link between two identifiable households.
    expect(document.body.innerHTML.toLowerCase()).not.toContain('replaces')
  })

  it('shows an empty state rather than an empty table body', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: [] }) } })
    renderResult()

    await winnerTable()
    expect(screen.getByText('No reserve positions to show.')).toBeInTheDocument()
  })

  it('counts reserve positions separately from places', async () => {
    await switchLocale('en')
    stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: reserved() }) } })
    renderResult()

    await reserveTable()

    // Four reserve positions beside twelve places: a reserve does not occupy
    // one, so the two figures are reported apart rather than summed.
    const figure = screen.getByText('Reserve positions').closest('div')
    expect(figure?.textContent).toContain('4')
    expect(screen.getByText('Places').closest('div')?.textContent).toContain('12')
  })

  it('renders the reserve section in Arabic, French and English', async () => {
    for (const [locale, heading, promoted] of [
      ['ar', 'قائمة الاحتياط', 'تمت ترقيته إلى فائز'],
      ['fr', 'Liste d’attente', 'Devenu lauréat'],
      ['en', 'Reserve list', 'Promoted to winner'],
    ] as const) {
      await switchLocale(locale)
      stubApi({ [RESULT_PATH]: { body: fullResult({ reserves: reserved() }) } })
      const view = renderResult()

      expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
      expect(screen.getByText(promoted)).toBeInTheDocument()
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr')
      view.unmount()
    }
  })

  it('translates the withdrawn-winner status in all three languages', async () => {
    for (const [locale, withdrawn] of [
      ['ar', 'تخلّى عن المقعد'],
      ['fr', 'A renoncé à la place'],
      ['en', 'Gave up the place'],
    ] as const) {
      await switchLocale(locale)
      stubApi({ [RESULT_PATH]: { body: fullResult({ winners: withdrawnAt(0) }) } })
      const view = renderResult()

      expect(await screen.findByText(withdrawn)).toBeInTheDocument()
      view.unmount()
    }
  })
})
