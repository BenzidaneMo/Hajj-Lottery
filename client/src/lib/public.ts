import {
  PUBLIC_PAGE_SIZE_MAX,
  type ApplicationStatusLookupRequest,
  type PublicApplicationStatusDto,
  type PublicDrawStatusDto,
  type PublicPageDto,
  type PublicResultDto,
  type PublicResultSummaryDto,
} from '@hajj-lottery/shared'
import { useCallback, useEffect, useState } from 'react'

import { apiGet, apiPost, ApiError } from './api'

/**
 * The client side of `/api/public`.
 *
 * Four endpoints, all of them reads except the status lookup, none of them
 * requiring a session. Two things this module is responsible for beyond issuing
 * the requests:
 *
 * - **Not asking for more than the server will give.** Page sizes are bounded
 *   here as well as clamped there, so a bug in a caller cannot turn a public
 *   listing into a table scan even for the one request the server would have
 *   trimmed anyway.
 * - **Not re-asking.** Every hook here is keyed by the query it represents and
 *   refetches only when that key changes, so switching a tab, opening a row or
 *   re-rendering for any other reason costs nothing. Published results are the
 *   most cacheable responses in the system and the point is to let the browser
 *   and any CDN in front of it actually serve them.
 */

/** What a public listing may be narrowed by. Codes, never internal ids. */
export interface PublicFilters {
  drawYear?: number | undefined
  wilayaCode?: string | undefined
  communeCode?: string | undefined
}

/**
 * The page size every public listing in this app asks for.
 *
 * Well inside the server's cap deliberately. The cap exists to stop abuse; a
 * page a citizen actually reads is smaller than the largest one they are
 * allowed to demand, and asking for the maximum on every screen would make the
 * shared cache hold pages nobody reads to the end.
 */
export const PUBLIC_UI_PAGE_SIZE = 20

/** Never let a caller ask for more than the server would serve. */
function boundedPageSize(pageSize: number): number {
  return Math.min(Math.max(1, Math.trunc(pageSize)), PUBLIC_PAGE_SIZE_MAX)
}

function listingQuery(filters: PublicFilters, page: number, pageSize: number): string {
  const params = new URLSearchParams()
  if (filters.drawYear !== undefined) params.set('drawYear', String(filters.drawYear))
  if (filters.wilayaCode) params.set('wilayaCode', filters.wilayaCode)
  if (filters.communeCode) params.set('communeCode', filters.communeCode)
  params.set('page', String(Math.max(1, Math.trunc(page))))
  params.set('pageSize', String(boundedPageSize(pageSize)))
  return params.toString()
}

/**
 * Checks one application. A POST, and deliberately so.
 *
 * The reference and the mobile number travel in the body rather than in a query
 * string, so neither reaches an access log, a browser history entry, a
 * `Referer` header or a shared cache key. Nothing about the response is stored:
 * no localStorage, no sessionStorage, no cookie. Closing the tab ends it.
 */
export function lookupApplicationStatus(
  request: ApplicationStatusLookupRequest,
): Promise<PublicApplicationStatusDto> {
  return apiPost<PublicApplicationStatusDto>('/api/public/application-status', request)
}

/** Whatever a public request can be answered with, plus how it is going. */
export interface PublicQueryState<T> {
  data: T | undefined
  isLoading: boolean
  error: unknown
  /** Re-runs the request. For a retry button, not for polling. */
  refetch: () => void
}

/**
 * One public GET, fetched when its path changes and not otherwise.
 *
 * The path is the whole identity of the request — it is the query key. Two
 * renders that produce the same path are the same question, and asking it again
 * would only cost the citizen data and the origin a request it has already
 * answered. That is the entire caching story on this side: there is no store,
 * no eviction policy and no global cache, because the server already says how
 * long each of its answers is good for and a second cache sitting in front of
 * that could only disagree with it.
 *
 * `undefined` means "not yet worth asking" and issues no request at all.
 */
function usePublicQuery<T>(path: string | undefined): PublicQueryState<T> {
  const [state, setState] = useState<{ path: string | undefined; data: T | undefined; error: unknown }>({
    path: undefined,
    data: undefined,
    error: undefined,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (path === undefined) return

    let cancelled = false

    apiGet<T>(path)
      .then((data) => {
        if (!cancelled) setState({ path, data, error: undefined })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ path, data: undefined, error })
      })

    return () => {
      cancelled = true
    }
  }, [path, attempt])

  const refetch = useCallback(() => setAttempt((value) => value + 1), [])

  // A settled result belongs to the request it was fetched for. Showing the
  // previous commune's result under a new heading for one frame would be a
  // small lie about whose result it is, which on this surface is not small.
  const isCurrent = state.path === path
  return {
    data: isCurrent ? state.data : undefined,
    isLoading: path !== undefined && !isCurrent,
    error: isCurrent ? state.error : undefined,
    refetch,
  }
}

/** A page of officially published results. */
export function usePublicResults(
  filters: PublicFilters,
  page: number,
  pageSize: number = PUBLIC_UI_PAGE_SIZE,
): PublicQueryState<PublicPageDto<PublicResultSummaryDto>> {
  return usePublicQuery(`/api/public/results?${listingQuery(filters, page, pageSize)}`)
}

/** A page of commune draw states. */
export function usePublicDrawStatus(
  filters: PublicFilters,
  page: number,
  pageSize: number = PUBLIC_UI_PAGE_SIZE,
): PublicQueryState<PublicPageDto<PublicDrawStatusDto>> {
  return usePublicQuery(`/api/public/draw-status?${listingQuery(filters, page, pageSize)}`)
}

function resultPath(drawYear: string, wilayaCode: string, communeCode: string): string {
  return `/api/public/results/${encodeURIComponent(drawYear)}/${encodeURIComponent(wilayaCode)}/${encodeURIComponent(communeCode)}`
}

/**
 * One commune's published result in full, or a 404 that means nothing more than
 * "there is no published result here".
 *
 * `enabled` lets a caller hold the request back until it is worth making — the
 * draw visualiser only asks for a result once the draw status says one has been
 * announced, rather than polling a 404 while it waits.
 */
export function usePublicResult(
  drawYear: string | undefined,
  wilayaCode: string | undefined,
  communeCode: string | undefined,
  enabled = true,
): PublicQueryState<PublicResultDto> {
  const addressable =
    enabled && drawYear !== undefined && wilayaCode !== undefined && communeCode !== undefined
  return usePublicQuery(addressable ? resultPath(drawYear, wilayaCode, communeCode) : undefined)
}

/** True when a failure is the API saying "not here", rather than a real fault. */
export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** True when the caller has been rate limited. */
export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429
}
