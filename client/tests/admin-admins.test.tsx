import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { AdminAdmins } from '../src/pages/admin/AdminAdmins'

import { adminUser, renderAdmin, session } from './admin-harness'
import { requestLog, stubApi, switchLocale, WILAYA_LIST } from './harness'

/**
 * Administrator accounts.
 *
 * Every rule tested here is enforced in `AdminAccountService`; what the console
 * adds is that the refusal is visible before somebody runs into it. Where the
 * two could disagree — a stale count, a race — the server wins, and the tests
 * are written so that they check what the console *offers*, never what it
 * permits.
 */

const GEO = {
  '/api/admin/wilayas': { body: WILAYA_LIST },
  '/api/admin/communes': { body: [] },
}

function list(items = [adminUser()]) {
  return { ...GEO, '/api/admin/admins': { body: { items } } }
}

describe('the administrator list', () => {
  it('shows each account with its role and territory', async () => {
    await switchLocale('en')
    stubApi(
      list([
        adminUser(),
        adminUser({ id: 'user-3', username: 'national', role: 'SUPER_ADMIN', wilaya: null }),
      ]),
    )

    renderAdmin(<AdminAdmins />)

    const table = await screen.findByRole('table', { name: 'Administrators' })
    expect(within(table).getByText('oran_admin')).toBeInTheDocument()
    expect(within(table).getByText('Wilaya administrator')).toBeInTheDocument()
    expect(within(table).getByText('Mostaganem')).toBeInTheDocument()
    expect(within(table).getByText('All wilayas')).toBeInTheDocument()
  })

  it('offers no action on your own account', async () => {
    await switchLocale('en')
    stubApi(list([adminUser({ id: 'user-SUPER_ADMIN', username: 'me', role: 'SUPER_ADMIN', wilaya: null })]))

    renderAdmin(<AdminAdmins />, { user: session('SUPER_ADMIN') })

    expect(await screen.findByText('This is you')).toBeInTheDocument()
    // Nobody edits their own role or scope — the fastest way to widen a single
    // compromised session would be to let it.
    expect(screen.queryByRole('button', { name: 'Change role or territory' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
  })

  it('says why the last national administrator cannot be deactivated', async () => {
    await switchLocale('en')
    stubApi(
      list([
        adminUser({ id: 'user-only', username: 'only_national', role: 'SUPER_ADMIN', wilaya: null }),
        adminUser({
          id: 'user-inactive',
          username: 'retired',
          role: 'SUPER_ADMIN',
          wilaya: null,
          isActive: false,
        }),
      ]),
    )

    renderAdmin(<AdminAdmins />, { user: session('SUPER_ADMIN') })

    const table = await screen.findByRole('table', { name: 'Administrators' })
    const row = within(table)
      .getAllByRole('row')
      .find((candidate) => candidate.textContent?.includes('only_national'))!

    expect(within(row).getByText('Last national administrator')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
  })

  it('states the rules the screen cannot bypass', async () => {
    await switchLocale('en')
    stubApi(list())

    renderAdmin(<AdminAdmins />)

    expect(await screen.findByText('Rules this screen cannot bypass')).toBeInTheDocument()
    expect(screen.getByText(/Nobody changes their own role/)).toBeInTheDocument()
    expect(screen.getByText(/Nobody grants reach they do not hold/)).toBeInTheDocument()
    expect(screen.getByText(/There is no password reset here./)).toBeInTheDocument()
  })

  it('offers no password reset and no deletion', async () => {
    await switchLocale('en')
    stubApi(list())

    renderAdmin(<AdminAdmins />)
    await screen.findByRole('table', { name: 'Administrators' })

    for (const button of screen.getAllByRole('button')) {
      // An account is the actor on audit records that must outlive it, and
      // overwriting somebody's credential is a different operation with
      // safeguards that do not exist yet.
      expect(button.textContent ?? '').not.toMatch(/reset|delete|remove/i)
    }
  })
})

describe('creating an administrator', () => {
  it('asks for no territory when the role is national', async () => {
    await switchLocale('en')
    stubApi(list())

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add an administrator' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Role'))
    await userEvent.click(await screen.findByRole('option', { name: 'National administrator' }))

    expect(within(dialog).getByText(/no wilaya or commune/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Wilaya')).not.toBeInTheDocument()
  })

  it('asks for a wilaya but not a commune for a wilaya administrator', async () => {
    await switchLocale('en')
    stubApi(list())

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add an administrator' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Role'))
    await userEvent.click(await screen.findByRole('option', { name: 'Wilaya administrator' }))

    expect(within(dialog).getByLabelText('Wilaya')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Commune')).not.toBeInTheDocument()
  })

  it('keeps the commune choice inside the chosen wilaya', async () => {
    await switchLocale('en')
    stubApi(list())

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add an administrator' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByLabelText('Role'))
    await userEvent.click(await screen.findByRole('option', { name: 'Commune administrator' }))

    // Until a wilaya is picked there is nothing to choose from — the composite
    // foreign key would reject a commune from another wilaya outright, so the
    // mistake is not offered.
    const commune = within(dialog).getByLabelText('Commune')
    expect(commune).toBeDisabled()
  })

  it('will not submit until the account is complete', async () => {
    await switchLocale('en')
    stubApi(list())

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add an administrator' }))

    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', { name: 'Add an administrator' })
    expect(submit).toBeDisabled()

    await userEvent.type(within(dialog).getByLabelText('Username'), 'saida_admin')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'short')
    // Below the server's minimum, so still refused here rather than there.
    expect(submit).toBeDisabled()

    expect(requestLog.every((entry) => entry.method !== 'POST')).toBe(true)
  })

  it('never puts a password in the address or the request log as a query', async () => {
    await switchLocale('en')
    stubApi({
      ...list(),
      '/api/admin/admins': (url) =>
        url.searchParams.size > 0 ? { status: 400, body: {} } : { body: { items: [adminUser()] } },
    })

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add an administrator' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Password'), 'a-long-enough-password')

    for (const entry of requestLog) expect(entry.url).not.toContain('a-long-enough-password')
  })
})

describe('changing a role or territory', () => {
  it('requires a reason, and records the previous assignment', async () => {
    await switchLocale('en')
    stubApi({
      ...list(),
      '/api/admin/admins/user-2/scope': { body: adminUser({ role: 'COMMUNE_ADMIN' }) },
    })

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Change role or territory' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/previous and new assignment are both recorded/)).toBeInTheDocument()
    expect(within(dialog).getByText('Current role')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role or territory' }))
    expect(within(dialog).getByText('An explanation is required.')).toBeInTheDocument()
    expect(requestLog.every((entry) => entry.method !== 'PATCH')).toBe(true)
  })

  it('honours a refusal from the server rather than its own view', async () => {
    await switchLocale('en')
    stubApi({
      ...list(),
      '/api/admin/admins/user-2/scope': {
        status: 403,
        body: { error: 'x', code: 'FORBIDDEN_SCOPE' },
      },
    })

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Change role or territory' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Moving them to another wilaya.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change role or territory' }))

    // The console offered the action; the server refused it, and that is the
    // answer the operator sees.
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    expect(within(dialog).getByText('You do not have permission to do this.')).toBeInTheDocument()
  })
})

describe('deactivating an administrator', () => {
  it('states that the sessions end too, and requires a reason', async () => {
    await switchLocale('en')
    stubApi({
      ...list(),
      '/api/admin/admins/user-2/deactivate': { body: adminUser({ isActive: false }) },
    })

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Any session they currently hold is revoked/)).toBeInTheDocument()
    expect(within(dialog).getByText(/named on audit records that must outlive it/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))
    expect(within(dialog).getByText('An explanation is required.')).toBeInTheDocument()
    expect(requestLog.some((entry) => entry.url.includes('/deactivate'))).toBe(false)
  })

  it('reports the server refusing to remove the last way in', async () => {
    await switchLocale('en')
    stubApi({
      ...list(),
      '/api/admin/admins/user-2/deactivate': {
        status: 409,
        body: { error: 'x', code: 'LAST_SUPER_ADMIN' },
      },
    })

    renderAdmin(<AdminAdmins />)
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Leaving the department.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    // A 409 is reported as a state conflict, in the operator's language —
    // never as the server's own untranslated message.
    expect(await within(dialog).findByText(/already changed/)).toBeInTheDocument()
    expect(within(dialog).getByText('Something went wrong')).toBeInTheDocument()
  })
})
