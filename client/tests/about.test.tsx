import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { About } from '../src/pages/About'
import { DEVELOPER, SOCIAL_LINKS } from '../src/config/site'
import { expectNoPrivateData, renderPage, switchLocale } from './harness'

const SOCIAL_LABELS: Record<(typeof SOCIAL_LINKS)[number]['id'], string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  x: 'X (Twitter)',
  facebook: 'Facebook',
  portfolio: 'Portfolio',
}

describe('the About page', () => {
  it('renders the project introduction', async () => {
    await switchLocale('en')
    renderPage(<About />)

    expect(screen.getByRole('heading', { level: 1, name: 'About the platform' })).toBeInTheDocument()
    expect(screen.getByText('What this platform is')).toBeInTheDocument()
    expect(screen.getByText(/registration, per-commune weighted draws/i)).toBeInTheDocument()
  })

  it('explains the lottery lifecycle without implying reserves are extra places', async () => {
    await switchLocale('en')
    renderPage(<About />)

    expect(screen.getByText('Registration')).toBeInTheDocument()
    expect(screen.getByText('Commune draw')).toBeInTheDocument()
    expect(screen.getByText(/is not an additional Hajj place/i)).toBeInTheDocument()
  })

  it('attributes the project to the developer', async () => {
    await switchLocale('en')
    renderPage(<About />)

    expect(screen.getByText(DEVELOPER.name)).toBeInTheDocument()
    expect(screen.getByText(`@${DEVELOPER.handle}`)).toBeInTheDocument()
  })

  it('renders every social link with its expected URL, opening safely in a new tab', async () => {
    await switchLocale('en')
    renderPage(<About />)

    for (const { id, href } of SOCIAL_LINKS) {
      const link = screen.getByRole('link', { name: SOCIAL_LABELS[id] })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
      expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    }
  })

  it('never links to the administrative console', async () => {
    await switchLocale('en')
    renderPage(<About />)

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/admin/)
    }
  })

  it('renders in French', async () => {
    await switchLocale('fr')
    renderPage(<About />)

    expect(await screen.findByText('Comment fonctionne la loterie')).toBeInTheDocument()
  })

  it('renders in Arabic, right to left', async () => {
    await switchLocale('ar')
    renderPage(<About />)

    expect(await screen.findByText('كيف تعمل القرعة')).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('renders no sensitive or private information', async () => {
    await switchLocale('en')
    const { container } = renderPage(<About />)

    expectNoPrivateData(container)
  })
})
