import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminApprovals } from '../src/pages/admin/AdminApprovals'
import { AdminAudit } from '../src/pages/admin/AdminAudit'
import { AdminHistory } from '../src/pages/admin/AdminHistory'
import { AdminImportDetail } from '../src/pages/admin/AdminImportDetail'
import { AdminImports } from '../src/pages/admin/AdminImports'

import {
  approvalRequest,
  auditLog,
  historyRecord,
  importBatch,
  importSummary,
  renderAdmin,
  session,
} from './admin-harness'
import { requestLog, requestedPaths, stubApi, switchLocale } from './harness'

/**
 * The ledger, the import pipeline, the approval workflow and the trail.
 *
 * What these have in common is that nobody may quietly decide their own case,
 * and nothing here repairs a conflict on the operator's behalf. Each of those
 * is enforced on the server; the tests check that the console says so rather
 * than presenting an action the server will refuse.
 */

const HISTORY_ROUTE = { pattern: '/admin/history', path: '/admin/history?participantId=p-1' }
const IMPORT_ROUTE = { pattern: '/admin/imports/:id', path: '/admin/imports/ib-1' }

describe('the participation ledger', () => {
  it('shows the records the server returned', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants/p-1/history': {
        body: { records: [historyRecord(), historyRecord({ id: 'ph-2', drawYear: 2024 })], streak: null },
      },
    })

    renderAdmin(<AdminHistory />, HISTORY_ROUTE)

    const table = await screen.findByRole('table', { name: 'Historical records' })
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('2025')).toBeInTheDocument()
  })

  it('states that the streak is withheld from a scoped administrator', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants/p-1/history': { body: { records: [historyRecord()], streak: null } },
    })

    renderAdmin(<AdminHistory />, { ...HISTORY_ROUTE, role: 'COMMUNE_ADMIN' })

    // Not a blank row: the absence is explained, because the streak spans
    // communes and summarising it would summarise another territory.
    expect(await screen.findByText(/streak is withheld/)).toBeInTheDocument()
  })

  it('shows the streak to a national administrator', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants/p-1/history': {
        body: {
          records: [historyRecord()],
          streak: {
            participantId: 'p-1',
            targetDrawYear: 2027,
            consecutiveNonWinningYears: 4,
            stoppedAt: 2022,
            stoppedBecause: 'WON',
          },
        },
      },
    })

    renderAdmin(<AdminHistory />, HISTORY_ROUTE)

    expect(await screen.findByText('Consecutive non-winning years')).toBeInTheDocument()
    expect(screen.getByText('Won that year')).toBeInTheDocument()
  })

  it('lets a scoped administrator request a correction, not make one', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants/p-1/history': { body: { records: [historyRecord()], streak: null } },
      '/api/admin/history/ph-1/correction-requests': { status: 201, body: approvalRequest() },
    })

    renderAdmin(<AdminHistory />, { ...HISTORY_ROUTE, role: 'COMMUNE_ADMIN' })
    await userEvent.click(await screen.findByRole('button', { name: 'Request correction' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/A national administrator decides/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByLabelText('Won'))
    await userEvent.click(await screen.findByRole('option', { name: 'Yes' }))
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'The register shows a win.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request correction' }))

    // The request route, never the direct PATCH.
    expect(requestedPaths()).toContain('/api/admin/history/ph-1/correction-requests')
    expect(requestLog.every((entry) => entry.method !== 'PATCH')).toBe(true)
  })

  it('will not submit a correction that changes nothing', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/participants/p-1/history': { body: { records: [historyRecord()], streak: null } },
    })

    renderAdmin(<AdminHistory />, HISTORY_ROUTE)
    await userEvent.click(await screen.findByRole('button', { name: 'Correct' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Choose at least one field to change.')).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Just because.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Correct' }))

    // A form that re-asserted its current values would silently restate facts
    // nobody meant to touch.
    expect(requestLog.every((entry) => !entry.url.includes('/history/ph-1'))).toBe(true)
  })
})

describe('the import pipeline', () => {
  it('says plainly that uploading writes nothing authoritative', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/imports': { body: { items: [importBatch()] } } })

    renderAdmin(<AdminImports />)

    expect(await screen.findByText('Uploading writes nothing authoritative')).toBeInTheDocument()
    expect(screen.getByText('mostaganem-2019.csv')).toBeInTheDocument()
    expect(screen.getByText('Ready for review')).toBeInTheDocument()
  })

  it('blocks approval while conflicts remain, and says why', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/imports/ib-1/summary': { body: importSummary({ importable: false, conflicts: 6 }) },
      '/api/admin/imports/ib-1/conflicts': {
        body: { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 },
      },
    })

    renderAdmin(<AdminImportDetail />, IMPORT_ROUTE)

    expect(await screen.findByText('This batch cannot be imported')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText('Resolve the conflicts first.')).toBeInTheDocument()

    // Nothing offers to resolve a conflict here — the row is the evidence.
    expect(screen.queryByRole('button', { name: /resolve|ignore|override|force/i })).not.toBeInTheDocument()
  })

  it('does not offer the uploader a decision on their own batch', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/imports/ib-1/summary': {
        body: importSummary({
          importable: true,
          batch: importBatch({ uploadedBy: { id: 'user-SUPER_ADMIN', username: 'super_admin' } }),
        }),
      },
      '/api/admin/imports/ib-1/conflicts': {
        body: { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 },
      },
    })

    renderAdmin(<AdminImportDetail />, { ...IMPORT_ROUTE, user: session('SUPER_ADMIN') })

    expect(await screen.findByText(/somebody else must decide it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('warns that an import cannot be undone before executing it', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/imports/ib-1/summary': {
        body: importSummary({ importable: true, batch: importBatch({ status: 'APPROVED' }) }),
      },
      '/api/admin/imports/ib-1/conflicts': {
        body: { items: [], page: 1, pageSize: 50, total: 0, totalPages: 1 },
      },
    })

    renderAdmin(<AdminImportDetail />, IMPORT_ROUTE)
    await userEvent.click(await screen.findByRole('button', { name: 'Import now' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/excluded from every future draw for life/)).toBeInTheDocument()
    expect(within(dialog).getByText(/no un-import/)).toBeInTheDocument()
  })

  it('shows only the last four digits of a national ID on a staged row', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/imports/ib-1/summary': { body: importSummary() },
      '/api/admin/imports/ib-1/conflicts': {
        body: {
          items: [
            {
              id: 'row-1',
              rowNumber: 42,
              status: 'CONFLICT',
              nationalIdSuffix: '7391',
              firstNameAr: 'أمينة',
              lastNameAr: 'بلقاسم',
              firstNameLatin: 'Amina',
              lastNameLatin: 'Belkacem',
              communeCode: '2703',
              drawYear: 2019,
              participated: true,
              won: true,
              issues: [{ code: 'ALREADY_A_WINNER', column: null, detail: null }],
            },
          ],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      },
    })

    renderAdmin(<AdminImportDetail />, IMPORT_ROUTE)

    expect(await screen.findByText('••••7391')).toBeInTheDocument()
    expect(screen.getByText('Would be a second lifetime win')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d{18}/)
  })
})

describe('approval requests', () => {
  it('hides the decision from the author of the request', async () => {
    await switchLocale('en')
    stubApi({ '/api/admin/approvals': { body: { items: [approvalRequest()] } } })

    // The requester is a SUPER_ADMIN here, so role is not what withholds the
    // action — authorship is. Self-review is refused by the service and by a
    // CHECK constraint either way.
    renderAdmin(<AdminApprovals />, {
      user: session('SUPER_ADMIN', { id: 'user-COMMUNE_ADMIN' }),
    })

    await screen.findByRole('table', { name: 'Approval requests' })
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    // They may withdraw their own, which is not a decision.
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
  })

  it('offers the decision to somebody else, with a mandatory reason', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/approvals': { body: { items: [approvalRequest()] } },
      '/api/admin/approvals/ar-1/approve': { body: approvalRequest({ status: 'APPROVED' }) },
    })

    renderAdmin(<AdminApprovals />)
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/applies the change in the same transaction/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(within(dialog).getByText('An explanation is required.')).toBeInTheDocument()
    expect(requestLog.some((entry) => entry.url.includes('/approve'))).toBe(false)
  })

  it('shows a decided request without offering to change the decision', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/approvals': {
        body: {
          items: [
            approvalRequest({
              status: 'APPROVED',
              reviewedBy: { id: 'user-SUPER_ADMIN', username: 'super_admin' },
              reviewReason: 'Register confirms it.',
              reviewedAt: '2027-02-21T09:00:00.000Z',
            }),
          ],
        },
      },
    })

    renderAdmin(<AdminApprovals />)
    await screen.findByRole('table', { name: 'Approval requests' })

    // Decided once, by trigger. A changed mind is a new request.
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })
})

describe('the audit trail', () => {
  it('lists records and offers nothing that would change one', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/audit-logs': {
        body: { items: [auditLog()], page: 1, pageSize: 50, total: 1, totalPages: 1 },
      },
    })

    renderAdmin(<AdminAudit />)

    const table = await screen.findByRole('table', { name: 'Audit records' })
    expect(within(table).getByText('Draw pool frozen')).toBeInTheDocument()
    expect(screen.getByText('This record cannot be changed')).toBeInTheDocument()

    // Nothing in the table acts on a record beyond reading it. ("Clear
    // filters", outside the table, resets the query and touches no record.)
    for (const button of within(table).queryAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/delete|remove|edit|clear|redact/i)
    }
    expect(
      within(table)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['View'])
  })

  it('sends filters and paging to the server', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/audit-logs': {
        body: { items: [auditLog()], page: 1, pageSize: 50, total: 120, totalPages: 3 },
      },
    })

    renderAdmin(<AdminAudit />)
    await screen.findByRole('table', { name: 'Audit records' })

    await userEvent.click(screen.getByLabelText('Action'))
    await userEvent.click(await screen.findByRole('option', { name: 'Result published' }))
    expect(requestedPaths().at(-1)).toContain('action=DRAW_RESULT_PUBLISHED')

    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(requestedPaths().at(-1)).toContain('page=2')
  })

  it('opens a record detail with its recorded snapshots', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/audit-logs': {
        body: {
          items: [auditLog({ reason: 'Register confirms it.', before: { won: false } })],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      },
    })

    renderAdmin(<AdminAudit />)
    await userEvent.click(await screen.findByRole('button', { name: 'View' }))

    const panel = await screen.findByRole('dialog')
    expect(within(panel).getByText('Register confirms it.')).toBeInTheDocument()
    expect(within(panel).getByText('Before')).toBeInTheDocument()
    expect(within(panel).getByText('After')).toBeInTheDocument()
  })

  it('names a null actor rather than leaving the cell blank', async () => {
    await switchLocale('en')
    stubApi({
      '/api/admin/audit-logs': {
        body: {
          items: [
            auditLog({ action: 'AUTH_LOGIN_FAILURE', actor: null, targetType: 'USER', targetId: null }),
          ],
          page: 1,
          pageSize: 50,
          total: 1,
          totalPages: 1,
        },
      },
    })

    renderAdmin(<AdminAudit />)

    // A failed login records nothing about the attempt — no username, no
    // account, no address. The absent actor is the point, not missing data.
    expect(await screen.findByText('No signed-in actor')).toBeInTheDocument()
  })
})
