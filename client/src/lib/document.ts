import { useEffect, useState } from 'react'

/**
 * Small document-level effects the public pages need.
 *
 * Kept together and kept tiny. None of this belongs in a page component: a page
 * should say *that* it must not be indexed, not how a `<meta>` element is
 * managed.
 */

/**
 * Keeps a page out of search results for as long as it is mounted.
 *
 * The application-status page is a lookup form whose answer belongs to one
 * person. There is nothing at its URL for a crawler to index — the reference and
 * the number are posted, never in the address — but a page whose whole purpose
 * is "type your details here" should not be a search result somebody arrives at
 * from outside either, and the same tag keeps any future crawler from following
 * the form. Removed on unmount so the results pages, which *should* be
 * indexable, are not caught by a tag left behind.
 */
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)

    return () => {
      meta.remove()
    }
  }, [])
}

/** Sets the document title, restoring the previous one when the page leaves. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title

    return () => {
      document.title = previous
    }
  }, [title])
}

/**
 * Whether this visitor has asked for less motion.
 *
 * Watched rather than read once: somebody who turns the preference on partway
 * through a draw should see the animation stop, not have to reload. Falls back
 * to "reduce" wherever `matchMedia` is unavailable, because a missing answer is
 * not a request for animation.
 */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(() => queryReducedMotion())

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    // Subscribe only. The initial value came from the same query in the state
    // initialiser above, so reading it again here would be a synchronous
    // setState in an effect body — a cascading render for a value already held.
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = (event: MediaQueryListEvent) => setPrefersReduced(event.matches)
    query.addEventListener('change', update)

    return () => {
      query.removeEventListener('change', update)
    }
  }, [])

  return prefersReduced
}

function queryReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
