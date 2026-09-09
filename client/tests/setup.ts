import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import i18n, { applyDocumentDirection } from '../src/i18n'

/**
 * One clean document, one clean network, one clean language per test.
 *
 * `fetch` is replaced rather than intercepted so that a test which forgets to
 * stub a call fails loudly instead of reaching a real server: an unstubbed
 * request rejects with a message naming the URL. Several of the assertions in
 * this suite are about requests *not* being made — that no public page touches
 * an internal endpoint, that a finished draw stops polling — and those are only
 * meaningful if every request goes through here.
 */

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      throw new Error(`Unstubbed fetch: ${String(input)}`)
    }),
  )

  // matchMedia is absent in jsdom. Default to "motion is fine" so the paced
  // reveal is exercised; the reduced-motion tests override it.
  vi.stubGlobal('matchMedia', undefined)
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()

  // Back to the default locale, and back to RTL, so a test that switched
  // language does not leave the document pointing the wrong way for the next.
  if (i18n.language !== 'ar') await i18n.changeLanguage('ar')
  applyDocumentDirection('ar')
})
