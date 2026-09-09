import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import i18n from '../src/i18n'
import { Header } from '../src/components/layout/Header'

import { switchLocale } from './harness'

/**
 * The mobile navigation is a Radix Dialog (via the shared Sheet primitives),
 * not a hand-rolled expanding panel — these tests pin the behaviour that
 * buys: it mounts and unmounts with open state, Escape and a second trigger
 * click both close it, activating a link closes it, and a locale change
 * mid-open never leaves it stuck.
 *
 * While the sheet is open, Radix marks the rest of the page `aria-hidden` —
 * correct modal behaviour, and the same thing the admin sidebar's own Sheet
 * does — so the trigger button is deliberately queried once, up front, and
 * that same element reference is reused afterwards rather than re-querying
 * it by role while it sits under an `aria-hidden` ancestor.
 */

function renderHeader() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/']}>
        <Header />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

describe('mobile navigation', () => {
  it('is closed until the trigger is activated', async () => {
    await switchLocale('en')
    renderHeader()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens on the trigger and exposes correct dialog semantics', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    const trigger = screen.getByRole('button', { name: 'Open menu' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName('Main navigation')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAccessibleName('Close menu')
  })

  it('closes when the trigger is activated again', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    const trigger = screen.getByRole('button', { name: 'Open menu' })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on the Sheet close control', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const dialog = screen.getByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes when a navigation link is activated', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const dialog = screen.getByRole('dialog')

    await user.click(within(dialog).getByRole('link', { name: 'Winners' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not get stuck open across a language change', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      await switchLocale('fr')
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('anchors to the logical start side, not a hard-coded physical one', async () => {
    await switchLocale('en')
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog').className).toMatch(/\bstart-0\b/)
    expect(screen.getByRole('dialog').className).not.toMatch(/\b(left|right)-0\b/)
  })
})
