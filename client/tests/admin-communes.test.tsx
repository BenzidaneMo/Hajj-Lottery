import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminCommunes } from '../src/pages/admin/AdminCommunes'

import { communeDraw, drawYear, renderAdmin } from './admin-harness'
import { stubApi, switchLocale } from './harness'

/**
 * Freeze All Ready Pools — the batch counterpart to freezing one commune's
 * pool by hand, so "Execute All Validated Draws" has something locked to
 * run without an operator visiting every commune first.
 *
 * The page's own draw-year Select is a Radix combobox, not a native
 * `<select>` — every test here starts with `?drawYearId=dy-1` already in the
 * address instead, which is exactly how the page's own filters read their
 * initial state, so no test needs to drive that combobox to reach the
 * batch actions.
 */

const ROUTE = { path: '/admin?drawYearId=dy-1' }

function listPage(items: unknown[] = [communeDraw()]) {
  return { items, page: 1, pageSize: 25, total: items.length, totalPages: 1 }
}

const PLACE_1 = {
  communeDrawId: 'cd-1',
  commune: { id: 'com-1', code: '2701', nameAr: 'م', nameFr: 'Mostaganem', nameEn: 'Mostaganem' },
  wilaya: { id: 'wil-1', code: '27', nameAr: 'و', nameFr: 'Mostaganem', nameEn: 'Mostaganem' },
  allocatedSpots: 12,
}

const PLACE_2 = {
  communeDrawId: 'cd-2',
  commune: { id: 'com-2', code: '2702', nameAr: 'م2', nameFr: 'Ain Nouissy', nameEn: 'Ain Nouissy' },
  wilaya: { id: 'wil-1', code: '27', nameAr: 'و', nameFr: 'Mostaganem', nameEn: 'Mostaganem' },
  allocatedSpots: 5,
}

describe('the commune draws list', () => {
  it('offers a national administrator both batch actions once a year is chosen', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/draw-years': { body: [drawYear()] },
      '/api/admin/commune-draws': { body: listPage() },
    })

    renderAdmin(<AdminCommunes />, ROUTE)

    expect(await screen.findByRole('button', { name: 'Freeze All Ready Pools' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Execute All Validated Draws' })).toBeEnabled()
  })

  it('hides both batch actions from a scoped administrator', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/draw-years': { body: [drawYear()] },
      '/api/admin/commune-draws': { body: listPage() },
    })

    renderAdmin(<AdminCommunes />, { ...ROUTE, role: 'WILAYA_ADMIN' })

    await screen.findByRole('table', { name: 'Commune draws' })
    expect(screen.queryByRole('button', { name: 'Freeze All Ready Pools' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Execute All Validated Draws' })).not.toBeInTheDocument()
  })

  it('freezes every ready pool and reports what happened, listing every real blocker for the rest', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/draw-years': { body: [drawYear()] },
      '/api/admin/commune-draws': { body: listPage() },
      '/api/admin/commune-draws/batch/freeze/validate': {
        body: {
          drawYearId: 'dy-1',
          ready: [PLACE_1],
          notReady: [{ ...PLACE_2, blockers: ['REGISTRATION_STILL_OPEN'] }],
          alreadyFrozen: [],
          total: 2,
        },
      },
      '/api/admin/commune-draws/batch/freeze/execute': {
        body: {
          drawYearId: 'dy-1',
          targeted: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
          outcomes: [{ ...PLACE_1, status: 'completed' }],
        },
      },
    })

    renderAdmin(<AdminCommunes />, ROUTE)

    await userEvent.click(await screen.findByRole('button', { name: 'Freeze All Ready Pools' }))

    const dialog = await screen.findByRole('dialog', { name: 'Freeze all ready pools' })
    // The one real blocker for the not-ready commune is named, not collapsed
    // into a generic "not ready".
    expect(within(dialog).getByText('Registration is still open')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Freeze 1 pools' }))

    expect(await within(dialog).findByText('No commune failed.')).toBeInTheDocument()
    expect(within(dialog).getByText('Frozen')).toBeInTheDocument()
  })
})
