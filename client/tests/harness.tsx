import type {
  CommuneDto,
  PublicApplicationStatusDto,
  PublicDrawStatusDto,
  PublicPageDto,
  PublicResultDto,
  PublicResultSummaryDto,
  WilayaDto,
} from '@hajj-lottery/shared'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, vi } from 'vitest'

import i18n from '../src/i18n'

/**
 * Fixtures and a fake origin for the public page tests.
 *
 * The API is stubbed at `fetch` rather than at the module boundary on purpose:
 * these tests are as much about which requests a page makes as about what it
 * renders. Several of them assert that a request was *not* sent — that no
 * public page reaches an admin or participant endpoint, that a page size is
 * bounded, that a settled draw stops polling — and those only mean anything if
 * the assertion is made over the real request the browser would have issued.
 */

const ORIGIN = 'http://localhost:4000'

export interface StubResponse {
  status?: number
  body?: unknown
}

export type StubTable = Record<
  string,
  StubResponse | ((url: URL, init: RequestInit | undefined) => StubResponse)
>

/** Every request the stub has seen, in order, as absolute URLs. */
export const requestLog: { url: string; method: string; body: string | undefined }[] = []

/**
 * Answers requests by path, ignoring the query string.
 *
 * Matching on pathname alone keeps the tests readable while leaving the whole
 * URL — filters, page, page size — in `requestLog` for the assertions that care
 * about it.
 */
export function stubApi(table: StubTable): void {
  requestLog.length = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const url = new URL(raw, ORIGIN)
      const method = init?.method ?? 'GET'
      requestLog.push({ url: raw, method, body: typeof init?.body === 'string' ? init.body : undefined })

      const handler = table[url.pathname]
      if (!handler) throw new TypeError(`Unstubbed fetch: ${method} ${url.pathname}`)

      const { status = 200, body = {} } = typeof handler === 'function' ? handler(url, init) : handler

      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      } as Response
    }),
  )
}

/** A request that never resolves — for asserting a loading state. */
export function stubNeverResolves(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
}

/** Every request this test issued, as pathname + search. */
export function requestedPaths(): string[] {
  return requestLog.map((entry) => new URL(entry.url, ORIGIN).pathname + new URL(entry.url, ORIGIN).search)
}

/** Renders a page at `path`, with `pattern` as its route. */
export function renderAt(element: ReactElement, pattern: string, path: string): RenderResult {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

/** Renders a page that takes no route parameters. */
export function renderPage(element: ReactElement): RenderResult {
  return renderAt(element, '/', '/')
}

/** Switches the UI language, and the document direction with it. */
export async function switchLocale(locale: 'ar' | 'fr' | 'en'): Promise<void> {
  await i18n.changeLanguage(locale)
}

export function forceReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  )
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

export const WILAYA = { code: '27', nameAr: 'مستغانم', nameFr: 'Mostaganem', nameEn: 'Mostaganem' }
// Deliberately not the wilaya's own name: a commune and its wilaya sharing a
// label would let an assertion about one pass on the other.
export const COMMUNE = {
  code: '2703',
  nameAr: 'حاسي ماماش',
  nameFr: 'Hassi Mameche',
  nameEn: 'Hassi Mameche',
}

export const WILAYA_LIST: WilayaDto[] = [{ id: 'wil-1', ...WILAYA }]
export const COMMUNE_LIST: CommuneDto[] = [{ id: 'com-1', wilayaId: 'wil-1', ...COMMUNE }]

export function applicationStatus(
  overrides: Partial<PublicApplicationStatusDto> = {},
): PublicApplicationStatusDto {
  return {
    applicationReference: 'HZ-2027-MES-8F42K1',
    drawYear: 2027,
    wilaya: WILAYA,
    commune: COMMUNE,
    entryType: 'SINGLE',
    applicantCount: 1,
    status: 'IN_DRAW',
    drawPhase: 'ACCEPTING',
    resultsPublished: false,
    submittedAt: '2026-03-04T09:15:00.000Z',
    ...overrides,
  }
}

export function resultSummary(overrides: Partial<PublicResultSummaryDto> = {}): PublicResultSummaryDto {
  return {
    drawYear: 2027,
    wilaya: WILAYA,
    commune: COMMUNE,
    allocatedSpots: 12,
    winnerCount: 12,
    winningParticipantCount: 14,
    publishedAt: '2027-05-02T10:00:00.000Z',
    ...overrides,
  }
}

export function fullResult(overrides: Partial<PublicResultDto> = {}): PublicResultDto {
  return {
    ...resultSummary(),
    entryCount: 843,
    poolHash: 'a'.repeat(64),
    algorithmVersion: 'weighted-csprng-v1',
    drawnAt: '2027-04-28T08:30:00.000Z',
    winners: [
      {
        selectionOrder: 1,
        applicationReference: 'HZ-2027-MES-8F42K1',
        entryType: 'SINGLE',
        participantCount: 1,
        outcome: 'ACTIVE',
      },
      {
        selectionOrder: 2,
        applicationReference: 'HZ-2027-MES-QQ19ZP',
        entryType: 'PAIRED',
        participantCount: 2,
        outcome: 'ACTIVE',
      },
      {
        selectionOrder: 3,
        applicationReference: 'HZ-2027-MES-3KD7VB',
        entryType: 'SINGLE',
        participantCount: 1,
        outcome: 'ACTIVE',
      },
    ],
    // The second half of the same draw — selections 4 and 5 here, straight after
    // the three winners. Two of them, so a test can assert the rendered order is
    // the API's rather than something a single row would satisfy by accident.
    reserves: [
      {
        reservePosition: 1,
        selectionOrder: 4,
        applicationReference: 'HZ-2027-MES-R51TTA',
        entryType: 'SINGLE',
        participantCount: 1,
        outcome: 'WAITING',
      },
      {
        reservePosition: 2,
        selectionOrder: 5,
        applicationReference: 'HZ-2027-MES-B90WQ4',
        entryType: 'PAIRED',
        participantCount: 2,
        outcome: 'WAITING',
      },
    ],
    ...overrides,
  }
}

export function drawStatus(overrides: Partial<PublicDrawStatusDto> = {}): PublicDrawStatusDto {
  return {
    drawYear: 2027,
    registrationOpen: true,
    wilaya: WILAYA,
    commune: COMMUNE,
    allocatedSpots: 12,
    phase: 'ACCEPTING',
    resultsPublished: false,
    winnerCount: null,
    ...overrides,
  }
}

export function page<T>(items: T[], overrides: Partial<PublicPageDto<T>> = {}): PublicPageDto<T> {
  return {
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
    totalPages: Math.max(1, Math.ceil(items.length / 20)),
    ...overrides,
  }
}

/* -------------------------------------------------------------------------- */
/* Shared privacy assertions                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Values that must never reach a public page, whatever the API sends.
 *
 * Deliberately checked against the rendered document rather than against the
 * DTO types: a type says what the server promises, and this says what a citizen
 * can actually read off the screen.
 */
export const FORBIDDEN_VALUES = {
  nationalId: '109876543210987654',
  phoneNumber: '+213555123456',
  dob: '1971-08-14',
  firstNameAr: 'أمينة',
  lastNameAr: 'بلقاسم',
  firstNameLatin: 'Amina',
  lastNameLatin: 'Belkacem',
  participantId: 'ckparticipant000001',
  applicationId: 'ckapplication000001',
  weight: 'SEVENTEEN_WEIGHT',
  randomValue: '918273645',
}

/** Asserts that none of the values above, and no weight label, is on screen. */
export function expectNoPrivateData(container: HTMLElement): void {
  const text = container.textContent ?? ''
  const html = container.innerHTML

  for (const value of Object.values(FORBIDDEN_VALUES)) {
    expect(text).not.toContain(value)
    expect(html).not.toContain(value)
  }

  // Field names too: an empty or placeholder weight column would still be a
  // weight column, and the policy is that there is no such column.
  //
  // The names rather than a bare "weight" substring — `weighted-csprng-v1` is
  // the published algorithm identifier and is meant to be on the page. A
  // substring check would fail on it and teach nothing.
  for (const label of [
    'selectedWeight',
    'calculatedWeight',
    'totalWeight',
    'activeTotalWeight',
    'nationalId',
    'national id',
    'dateOfBirth',
    'randomValue',
    'participationHistory',
  ]) {
    expect(html.toLowerCase()).not.toContain(label.toLowerCase())
  }
}
