import type { PublicDrawStatusDto, PublicPageDto } from '@hajj-lottery/shared'
import { useCallback, useEffect, useState } from 'react'

import { apiGet } from './api'

/**
 * Watching one commune's draw, from the outside.
 *
 * **The transport is polling, and that is a decision rather than a shortcut.**
 * The server has no public real-time surface: a draw is one database
 * transaction that either commits whole or unwinds whole, and a national
 * administrator publishes the result as a separate, later, deliberate act.
 * There is no stream of per-selection events to subscribe to, because there is
 * no moment at which a partially-drawn commune is a real, observable state.
 * Opening a WebSocket or an SSE channel over that would be a channel carrying
 * exactly the same information as a GET, at the cost of one held connection per
 * viewer on a page whose whole problem is that a great many people open it at
 * once — and it would advertise a liveness the system does not have.
 *
 * So this polls `/api/public/draw-status`, which is:
 *
 * - **the same bytes for every viewer**, so a CDN can serve a hundred thousand
 *   watchers from one origin request, and `stale-while-revalidate` keeps doing
 *   so while it refreshes;
 * - **cheap**, one indexed row;
 * - **the authoritative state**, not a projection of one.
 *
 * The intervals below are the other half of that. A page left open on a commune
 * that is still taking applications must not cost a request a second; the
 * interval widens the further the draw is from happening, narrows to the one
 * transition actually worth waiting for — a result being announced — and then
 * **stops entirely**, because a published result never changes and there is
 * nothing left to ask about.
 *
 * Nothing here can start, influence or observe a draw. The client sends one
 * GET with three filter values in it; there is no request this module can make
 * that writes anything, and the endpoint it calls has no write path behind it.
 */

/** How long to wait before asking again, by what the last answer said. */
const INTERVALS = {
  /** Intake is open. Nothing changes minute to minute. */
  accepting: 120_000,
  /** Entries are closed; the draw could be run today. */
  entriesClosed: 60_000,
  /** Drawn, awaiting the announcement — the one transition worth watching for. */
  awaitingPublication: 20_000,
} as const

/** Backoff after a failure: start here, double, stop widening here. */
const RETRY_MIN = 15_000
const RETRY_MAX = 120_000

export type DrawWatchPhase = 'WAITING' | 'DRAWING' | 'COMPLETED' | 'UNAVAILABLE'

export interface DrawWatchState {
  /** The visualiser's state machine, derived from the server's own vocabulary. */
  phase: DrawWatchPhase
  /** The authoritative status row, once one has been read. */
  status: PublicDrawStatusDto | undefined
  isLoading: boolean
  error: unknown
  /** True while the watcher intends to ask again. False once it has stopped. */
  isPolling: boolean
  refetch: () => void
}

/**
 * Maps the public draw vocabulary onto the four states the visualiser shows.
 *
 * Read straight off the server's own `phase` and `resultsPublished`. There is
 * no arithmetic and no inference: in particular `DRAWING` means "the draw has
 * been held and the official result has not been announced", which is a real
 * state the API reports, and not a guess that a selection is happening at this
 * instant. The system does not expose per-selection progress and this must not
 * pretend otherwise.
 */
export function toWatchPhase(status: PublicDrawStatusDto | undefined): DrawWatchPhase {
  if (!status) return 'UNAVAILABLE'

  switch (status.phase) {
    case 'ACCEPTING':
    case 'ENTRIES_CLOSED':
      return 'WAITING'
    case 'DRAWN':
      return status.resultsPublished ? 'COMPLETED' : 'DRAWING'
    case 'CANCELLED':
      return 'UNAVAILABLE'
  }
}

/** How long to wait after a successful read, or null to stop asking. */
function nextInterval(status: PublicDrawStatusDto | undefined): number | null {
  if (!status) return null

  switch (status.phase) {
    case 'ACCEPTING':
      return INTERVALS.accepting
    case 'ENTRIES_CLOSED':
      return INTERVALS.entriesClosed
    case 'DRAWN':
      // Published is terminal. The result is immutable by database trigger and
      // there is no retraction path anywhere in the system, so asking again
      // could only ever get the same answer.
      return status.resultsPublished ? null : INTERVALS.awaitingPublication
    case 'CANCELLED':
      return null
  }
}

interface WatchAddress {
  drawYear: string
  wilayaCode: string
  communeCode: string
}

/**
 * Polls one commune's public draw status until there is nothing left to watch.
 *
 * The timer is only ever armed from inside a completed request, never on a bare
 * interval, so a slow origin cannot accumulate overlapping requests — which is
 * precisely the failure mode that turns a busy page into a stampede.
 *
 * Polling also stops while the tab is hidden. Draw day means a great many
 * people leave this open in a background tab, and a background tab asking every
 * twenty seconds for an hour is load nobody is watching.
 */
export function useDrawWatch(address: WatchAddress | undefined): DrawWatchState {
  const [status, setStatus] = useState<PublicDrawStatusDto | undefined>(undefined)
  const [error, setError] = useState<unknown>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [isPolling, setIsPolling] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const key = address ? `${address.drawYear}/${address.wilayaCode}/${address.communeCode}` : undefined

  useEffect(() => {
    if (!address || !key) return

    let cancelled = false
    let timer: number | undefined
    let backoff = RETRY_MIN

    // pageSize=1: this watches exactly one commune, and asking for a page of
    // twenty rows to read one of them would be a hundred thousand viewers'
    // worth of bytes nobody reads.
    const query = new URLSearchParams({
      drawYear: address.drawYear,
      wilayaCode: address.wilayaCode,
      communeCode: address.communeCode,
      page: '1',
      pageSize: '1',
    })
    const path = `/api/public/draw-status?${query.toString()}`

    const schedule = (delay: number | null) => {
      if (cancelled) return
      if (delay === null) {
        setIsPolling(false)
        return
      }
      setIsPolling(true)
      timer = window.setTimeout(poll, delay)
    }

    const poll = async () => {
      timer = undefined

      // Nobody is looking. Arm no timer at all and let the visibility listener
      // restart the watch — a background tab asking every twenty seconds for an
      // hour is load without a reader, and on draw day there are a great many
      // background tabs.
      if (document.hidden) {
        setIsPolling(false)
        return
      }

      try {
        const page = await apiGet<PublicPageDto<PublicDrawStatusDto>>(path)
        if (cancelled) return

        const row = page.items[0]
        setStatus(row)
        setError(undefined)
        setIsLoading(false)
        backoff = RETRY_MIN
        // An empty page is a commune with no configured draw for that year. It
        // is a settled answer rather than a failure, and nothing about it will
        // change on a timescale worth polling on.
        schedule(nextInterval(row))
      } catch (caught) {
        if (cancelled) return
        setError(caught)
        setIsLoading(false)
        // Back off rather than hammer: if the origin is struggling, a page full
        // of watchers retrying on a fixed interval is what keeps it struggling.
        schedule(backoff)
        backoff = Math.min(backoff * 2, RETRY_MAX)
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden && timer === undefined) void poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    void poll()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // `address` is destructured into the request inside the effect; `key` is
    // its identity, so a re-render with the same commune does not restart the
    // watch and lose its place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const refetch = useCallback(() => {
    setIsLoading(true)
    setAttempt((value) => value + 1)
  }, [])

  return {
    phase: toWatchPhase(status),
    status,
    isLoading,
    error,
    isPolling,
    refetch,
  }
}
