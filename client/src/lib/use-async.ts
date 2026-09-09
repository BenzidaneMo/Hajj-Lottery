import { useCallback, useEffect, useState } from 'react'

/**
 * Loading a server value, and running a server action.
 *
 * Small on purpose. The console has no client-side store and no cache: every
 * screen states what it needs, asks for it, and renders one of three outcomes.
 * A cache would have to be invalidated after every mutation on a system where a
 * single action rewrites several tables — and a stale count on an operations
 * screen is worse than a second request.
 */

export type AsyncState<T> =
  { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ready'; data: T }

export interface AsyncResult<T> {
  state: AsyncState<T>
  /** Re-runs the loader — after a mutation, or from a retry button. */
  reload: () => void
}

/**
 * Runs `load` whenever it changes, and again on `reload()`.
 *
 * The loader itself is the dependency, so callers wrap theirs in `useCallback`
 * with the filters it closes over. That keeps the list of things a request
 * depends on next to the request, instead of in a second array here that could
 * silently fall out of step with it.
 *
 * The reset to `loading` happens during render rather than in the effect —
 * React's documented way to adjust state when an input changes. Doing it in the
 * effect would render one frame of the *previous* result under the new filter,
 * which on a scoped console means briefly showing one territory's rows under
 * another's label.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [source, setSource] = useState({ load, attempt })

  if (source.load !== load || source.attempt !== attempt) {
    setSource({ load, attempt })
    setState({ status: 'loading' })
  }

  useEffect(() => {
    // A response that arrives after its request was superseded is dropped:
    // filters typed quickly enough overlap, and without this the slower of the
    // two would win and show results for a filter already moved past.
    let active = true

    load()
      .then((data) => {
        if (active) setState({ status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', error })
      })

    return () => {
      active = false
    }
  }, [load, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { state, reload }
}

/**
 * Reshapes a ready value, passing loading and error through untouched.
 *
 * Lets a page hand `DataTable` the `items` of a paged response without either
 * of them having to know about the other's envelope.
 */
export function mapAsync<A, B>(state: AsyncState<A>, map: (value: A) => B): AsyncState<B> {
  return state.status === 'ready' ? { status: 'ready', data: map(state.data) } : state
}

export interface ActionResult<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>
  pending: boolean
  error: unknown
  reset: () => void
}

/**
 * Runs a mutation, tracking whether it is in flight and what it failed with.
 *
 * `run` resolves to `undefined` on failure rather than rejecting, so a caller
 * can write `if (await run(...))` without a try/catch around every button. The
 * error is still available for the form to render.
 */
export function useAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): ActionResult<TArgs, TResult> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(undefined)

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setPending(true)
      setError(undefined)
      try {
        return await action(...args)
      } catch (caught) {
        setError(caught)
        return undefined
      } finally {
        setPending(false)
      }
    },
    [action],
  )

  const reset = useCallback(() => setError(undefined), [])

  return { run, pending, error, reset }
}

/**
 * A value that settles after the operator stops typing.
 *
 * Search boxes here hit the database, so a request per keystroke would be a
 * request storm from one impatient hand.
 */
export function useDebounced<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
