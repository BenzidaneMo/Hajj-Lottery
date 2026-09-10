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

/**
 * Browser APIs Radix needs that jsdom does not implement.
 *
 * The admin console is built on Radix primitives (through shadcn/ui), and they
 * measure and capture during open/close. jsdom has no layout engine, so these
 * are inert stand-ins that let a dialog or a listbox mount — they are not
 * asserted on, and nothing about the behaviour under test depends on the
 * numbers they return.
 */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

/**
 * jsdom has no `IntersectionObserver` either, and Framer Motion's
 * `whileInView` (the landing page's `Reveal`) needs one to mount at all. An
 * inert stand-in is enough — no test in this suite asserts on the entrance
 * animation itself, only on the content it wraps.
 */
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

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
